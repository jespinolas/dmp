export type WindLevel = 10 | 80 | 120 | 180;

export type WindPoint = {
  speed: number;       // m/s
  direction: number;   // degrees meteorological (0=N, 90=E)
  gusts: number;       // m/s
};

export type HourlyForecast = {
  time: string;        // ISO timestamp
  speed10m: number;
  direction10m: number;
  gusts10m: number;
};

export type WindReport = {
  lat: number;
  lng: number;
  timestamp: string;
  levels: Record<WindLevel, WindPoint>;
  hourly: HourlyForecast[];  // next 6 hours
};

/**
 * Fetch multi-height wind data from Open-Meteo (free, no API key).
 */
export async function fetchWindReport(lat: number, lng: number): Promise<WindReport | null> {
  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,wind_speed_120m,wind_direction_120m,wind_speed_180m,wind_direction_180m",
      hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      timezone: "auto",
      forecast_hours: "6",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.current;
    if (!c) return null;

    const levels: Record<number, WindPoint> = {};
    levels[10] = { speed: c.wind_speed_10m ?? 0, direction: c.wind_direction_10m ?? 0, gusts: c.wind_gusts_10m ?? 0 };
    if (c.wind_speed_80m != null) levels[80] = { speed: c.wind_speed_80m, direction: c.wind_direction_80m ?? 0, gusts: 0 };
    if (c.wind_speed_120m != null) levels[120] = { speed: c.wind_speed_120m, direction: c.wind_direction_120m ?? 0, gusts: 0 };
    if (c.wind_speed_180m != null) levels[180] = { speed: c.wind_speed_180m, direction: c.wind_direction_180m ?? 0, gusts: 0 };

    const hourly: HourlyForecast[] = [];
    const h = data?.hourly;
    if (h?.time) {
      for (let i = 0; i < h.time.length; i++) {
        hourly.push({
          time: h.time[i],
          speed10m: h.wind_speed_10m?.[i] ?? 0,
          direction10m: h.wind_direction_10m?.[i] ?? 0,
          gusts10m: h.wind_gusts_10m?.[i] ?? 0,
        });
      }
    }

    return { lat, lng, timestamp: c.time ?? new Date().toISOString(), levels: levels as Record<WindLevel, WindPoint>, hourly };
  } catch {
    return null;
  }
}

// ─── Direction helpers ──────────────────────────────────────────────────────

export function windDirLabel(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}

export function windDirDegToCompass(deg: number): number {
  // Convert meteorological degrees (0=from N) to compass bearing (0=to N)
  return ((deg + 180) % 360 + 360) % 360;
}

// ─── Warning level ──────────────────────────────────────────────────────────

export type WindLevel2 = "ok" | "caution" | "danger";

export function windWarning(speedMs: number, maxSpeedMs = 8): WindLevel2 {
  if (speedMs > maxSpeedMs) return "danger";
  if (speedMs > maxSpeedMs * 0.65) return "caution";
  return "ok";
}

export function windLabel(level: WindLevel2): string {
  switch (level) { case "danger": return "Unsafe — do not fly"; case "caution": return "Windy — fly with caution"; default: return "Calm — ideal"; }
}

export function windColor(level: WindLevel2): string {
  switch (level) { case "danger": return "#dc3545"; case "caution": return "#e67e22"; default: return "#198754"; }
}

export function windBgColor(level: WindLevel2): string {
  switch (level) { case "danger": return "rgba(220,53,69,0.1)"; case "caution": return "rgba(230,126,34,0.08)"; default: return "rgba(25,135,84,0.06)"; }
}

// ─── Crosswind calculation ──────────────────────────────────────────────────

export type CrosswindResult = {
  headwind: number;     // m/s — positive = headwind, negative = tailwind
  crosswind: number;    // m/s — absolute crosswind component
  crosswindAngle: number; // 0 = pure head/tail, 90 = pure cross
  risk: WindLevel2;
};

/**
 * Compute crosswind/headwind components given wind and flight path direction.
 * windDir: meteorological direction (where wind comes FROM)
 * flightHeading: degrees (where drone is heading TO)
 */
export function computeCrosswind(windSpeed: number, windDir: number, flightHeading: number, maxSafe: number = 8): CrosswindResult {
  // Wind TO direction = wind FROM + 180
  const windTo = ((windDir + 180) % 360 + 360) % 360;
  // Angle between wind-to and flight heading
  let angleDiff = Math.abs(windTo - flightHeading) % 360;
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const angleRad = (angleDiff * Math.PI) / 180;
  const headwind = windSpeed * Math.cos(angleRad);   // positive = against drone
  const crosswind = windSpeed * Math.sin(angleRad);    // absolute lateral

  const risk = crosswind > maxSafe * 0.6 ? "danger" : crosswind > maxSafe * 0.35 ? "caution" : "ok";
  return { headwind, crosswind, crosswindAngle: angleDiff, risk };
}

/**
 * Compute worst-case crosswind across all flight segments.
 */
export function analyzeMissionWind(
  waypoints: Array<{ lat: number; lng: number }>,
  windSpeed: number,
  windDir: number,
  maxSafe = 8
): { worst: CrosswindResult; segments: Array<CrosswindResult> } {
  const segments: CrosswindResult[] = [];
  let worst: CrosswindResult = { headwind: 0, crosswind: 0, crosswindAngle: 0, risk: "ok" };

  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const heading = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    const cw = computeCrosswind(windSpeed, windDir, heading, maxSafe);
    segments.push(cw);
    if (cw.crosswind > worst.crosswind) worst = cw;
  }
  return { worst, segments };
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const y = Math.sin(toRad(lng2) - toRad(lng1)) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(toRad(lng2) - toRad(lng1));
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ─── Wind barb SVG path generation ──────────────────────────────────────────

/**
 * Generate a wind barb SVG path for a Google Maps symbol.
 * Staff points FROM wind direction (meteorological convention).
 * Returns path string that can be used as a google.maps.Symbol path.
 */
export function windBarbPath(speedKts: number): string {
  // Scale: 1 pixel per knot, capped
  const kts = Math.min(speedKts, 65);
  const staffLen = 30;  // staff length in px
  const featherSpacing = 5;
  const longFeather = 10;
  const shortFeather = 5;
  const pennant = 12;

  let path = `M 0,0 L 0,${staffLen} `;  // staff from 0,0 downward

  let remaining = Math.round(kts / 5); // in 5-kt increments
  let y = staffLen - 2;

  if (remaining >= 10) {
    // Pennant for 50 kt
    path += `M 0,${y} L ${pennant},${y - 6} L 0,${y - 12} Z `;
    remaining -= 10;
    y -= 14;
  }

  while (remaining > 0 && y > 4) {
    if (remaining >= 2) {
      path += `M 0,${y} L ${longFeather},${y - 4} `;
      remaining -= 2;
    } else {
      path += `M 0,${y} L ${shortFeather},${y - 2} `;
      remaining -= 1;
    }
    y -= featherSpacing;
  }

  return path;
}

// ─── Altitude labels ────────────────────────────────────────────────────────

export const WIND_ALTITUDE_LABELS: Record<WindLevel, string> = {
  10: "10m (surface)",
  80: "80m",
  120: "120m",
  180: "180m",
};
