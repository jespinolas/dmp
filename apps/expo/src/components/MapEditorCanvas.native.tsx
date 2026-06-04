import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, {
  Callout,
  Circle,
  Marker,
  Polygon,
  Polyline,
  type LongPressEvent,
  type MapPressEvent,
  type Region
} from "react-native-maps";

import type { GenerationSettings } from "../services/generator";
import type {
  DrawMode,
  MapEditorHandle,
  MapEditorState,
  WaypointData
} from "./MapEditorCanvas";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function normalizeActionForServer(action: string): string {
  switch (action) {
    case "take-picture": return "takePicture";
    case "start-recording": return "startRecording";
    case "stop-recording": return "stopRecording";
    default: return "noAction";
  }
}

// ─── Native marker data ──────────────────────────────────────────────────────

type NativeMarker = {
  wmId: number;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  angle: number;
  heading: number;
  action: string;
  turnMode: string;
  useStraightLine: number;
  waypointTurnDampingDist: number;
};

function markerToWaypointData(m: NativeMarker): WaypointData {
  return {
    id: m.wmId,
    lat: m.lat,
    lng: m.lng,
    altitude: m.altitude,
    speed: m.speed,
    angle: m.angle,
    heading: m.heading,
    action: m.action,
    turnMode: m.turnMode,
    useStraightLine: m.useStraightLine,
    waypointTurnDampingDist: m.waypointTurnDampingDist,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  apiKey: string;
  apiBaseUrl?: string;
  generationSettings: GenerationSettings;
  onStateChange(state: MapEditorState): void;
  onSelectedWaypointChange(wp: WaypointData | null): void;
  onWaypointUpdated(wp: WaypointData): void;
  onCursorMove?(ll: { lat: number; lng: number } | null): void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const MapEditorCanvas = forwardRef<MapEditorHandle, Props>(
  function MapEditorCanvas(props, ref) {
    const propsRef = useRef(props);
    propsRef.current = props;

    const mapRef = useRef<MapView>(null);

    // ── State ─────────────────────────────────────────────────────────────────
    const [region, setRegion] = useState<Region>({
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
    const [drawMode, setDrawMode] = useState<DrawMode>(null);
    const [polygonPts, setPolygonPts] = useState<Array<{ lat: number; lng: number }>>([]);
    const [polygons, setPolygons] = useState<Array<Array<{ lat: number; lng: number }>>>([]);
    const [circles, setCircles] = useState<Array<{ center: { lat: number; lng: number }; radius: number }>>([]);
    const [markers, setMarkers] = useState<NativeMarker[]>([]);
    const [flagCount, setFlagCount] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [selectedMarker, setSelectedMarker] = useState<NativeMarker | null>(null);

    const undoStackRef = useRef<Array<() => void>>([]);
    const redoStackRef = useRef<Array<() => void>>([]);

    // ── Publish state ─────────────────────────────────────────────────────────
    const publishState = useCallback(() => {
      const hasShapes = polygons.length + circles.length > 0;
      let etaSec = 0;
      const sorted = [...markers].sort((a, b) => a.wmId - b.wmId);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        const dist = haversineM(a, b);
        const spd = (a.speed + b.speed) / 2 || 1;
        etaSec += dist / spd;
      }
      etaSec += markers.length * 0.8;

      propsRef.current.onStateChange({
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
        hasShapes,
        hasWaypoints: markers.length > 0,
        waypointCount: markers.length,
        selectionCount: 0,
        eta: fmtTime(etaSec),
        etaSeconds: etaSec,
        isGenerating,
        generationError,
        photoCadenceWarning: false,
        overlayCount: 0,
        overlays: [],
        isSettingStale: false,
        timedShotsNote: markers.length > 0 && markers.every((m) => m.action === "noAction"),
        headingTransformAngle: null,
        geoTransformMode: null,
      });
    }, [polygons, circles, markers, isGenerating, generationError]);

    useEffect(() => { publishState(); }, [publishState]);

    // ── Undo/Redo ────────────────────────────────────────────────────────────
    function pushUndo(undo: () => void, redo: () => void) {
      undoStackRef.current.push(undo);
      redoStackRef.current = [];
    }

    function undo() {
      const act = undoStackRef.current.pop();
      if (act) { act(); redoStackRef.current.push(act); publishState(); }
    }

    function redo() {
      const act = redoStackRef.current.pop();
      if (act) { act(); undoStackRef.current.push(act); publishState(); }
    }

    function reset() {
      setPolygons([]); setCircles([]); setMarkers([]); setFlagCount(1);
      setSelectedMarker(null); setGenerationError(null); setIsGenerating(false);
      setDrawMode(null); setPolygonPts([]);
      undoStackRef.current = []; redoStackRef.current = [];
    }

    // ── Draw mode ────────────────────────────────────────────────────────────
    function setDrawModeInternal(mode: DrawMode) {
      setDrawMode(mode);
      if (mode !== "polygon") setPolygonPts([]);
    }

    // ── Map press ────────────────────────────────────────────────────────────
    function handleMapPress(e: MapPressEvent) {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      if (drawMode === "marker") { addMarker(latitude, longitude); return; }
      if (drawMode === "polygon") {
        const pt = { lat: latitude, lng: longitude };
        if (polygonPts.length >= 3 && haversineM(polygonPts[0], pt) < 15) {
          finishPolygon(); return;
        }
        setPolygonPts((prev) => [...prev, pt]);
        return;
      }
    }

    function handleLongPress(_e: LongPressEvent) {
      if (drawMode === "polygon" && polygonPts.length >= 3) finishPolygon();
    }

    function finishPolygon() {
      if (polygonPts.length < 3) { setPolygonPts([]); return; }
      const closed = [...polygonPts, polygonPts[0]];
      setPolygons((prev) => [...prev, closed]);
      setPolygonPts([]);
      setDrawMode(null);
    }

    function addMarker(lat: number, lng: number, wpProps?: Partial<WaypointData>) {
      const settings = propsRef.current.generationSettings;
      const m: NativeMarker = {
        wmId: flagCount, lat, lng,
        altitude: wpProps?.altitude ?? settings.altitude,
        speed: wpProps?.speed ?? settings.speed,
        angle: wpProps?.angle ?? settings.gimbalAngle,
        heading: wpProps?.heading ?? 0,
        action: wpProps?.action ?? (settings.generateAllPoints ? normalizeActionForServer(settings.allPointsAction) : "noAction"),
        turnMode: wpProps?.turnMode ?? "coordinateTurn",
        useStraightLine: wpProps?.useStraightLine ?? 0,
        waypointTurnDampingDist: wpProps?.waypointTurnDampingDist ?? 20,
      };
      setFlagCount((c) => c + 1);
      setMarkers((prev) => [...prev, m]);
      pushUndo(
        () => setMarkers((prev) => prev.filter((x) => x !== m)),
        () => setMarkers((prev) => [...prev, m])
      );
    }

    // ── Generate ─────────────────────────────────────────────────────────────
    async function generateAllShapes() {
      if (isGenerating) return;
      if (!polygons.length && !circles.length) return;
      setIsGenerating(true);
      setGenerationError(null);
      const allShapes = [
        ...polygons.map((p) => ({ boundsStr: polygonToBounds(p), typeStr: "polygon" as const })),
        ...circles.map((c) => ({ boundsStr: `${c.radius};(${c.center.lat},${c.center.lng})`, typeStr: "circle" as const })),
      ];
      const settings = propsRef.current.generationSettings;
      const apiBase = propsRef.current.apiBaseUrl ?? "http://localhost:8088";
      const created: NativeMarker[] = [];
      try {
        for (const { boundsStr, typeStr } of allShapes) {
          const params = buildParams(boundsStr, typeStr, settings, flagCount + created.length);
          const res = await fetch(`${apiBase}/Home/GeneratePoints`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: params,
          });
          if (!res.ok) throw new Error(`GeneratePoints failed: ${res.status}`);
          const pts: any[] = await res.json();
          for (const p of pts) {
            created.push({
              wmId: flagCount + created.length, lat: p.Latitude, lng: p.Longitude,
              altitude: p.altitude ?? settings.altitude, speed: p.speed ?? settings.speed,
              angle: p.gimbalAngle ?? settings.gimbalAngle, heading: p.heading ?? 0,
              action: p.action ?? "noAction", turnMode: p.turnMode ?? "coordinateTurn",
              useStraightLine: p.useStraightLine ?? 0, waypointTurnDampingDist: p.waypointTurnDampingDist ?? 20,
            });
          }
        }
        if (created.length) {
          setMarkers((prev) => [...prev, ...created]);
          setFlagCount((c) => c + created.length);
          setPolygons([]); setCircles([]);
        }
      } catch (err: any) {
        setGenerationError(err.message ?? "Generation failed");
      } finally { setIsGenerating(false); }
    }

    function polygonToBounds(p: Array<{ lat: number; lng: number }>): string {
      return p.map((pt) => `${pt.lat},${pt.lng}`).join(";") + ";";
    }

    function buildParams(boundsStr: string, typeStr: string, settings: GenerationSettings, startIdx: number): string {
      let sendMode = settings.lineAngleMode, sendOrientation = "0";
      if (settings.lineAngleMode === "presetNS") { sendMode = "preset"; sendOrientation = "1"; }
      else if (settings.lineAngleMode === "preset") { sendMode = "preset"; sendOrientation = "0"; }
      const derivedTurnMode = settings.straightenLines ? "toPointAndStopWithDiscontinuityCurvature" : settings.turnMode;
      const p = new URLSearchParams();
      p.set("bounds", boundsStr); p.set("boundsType", typeStr);
      p.set("in_startingIndex", String(startIdx)); p.set("in_units", settings.units);
      p.set("altitude", String(settings.altitude)); p.set("speed", String(settings.speed));
      p.set("in_distance", String(settings.distance)); p.set("in_overlap", String(settings.overlap));
      p.set("in_interval", String(settings.interval)); p.set("angle", String(settings.gimbalAngle));
      p.set("in_lineAngleMode", sendMode); p.set("in_lineOrientation", sendOrientation);
      p.set("in_lineAngleDegrees", String(settings.lineAngleDegrees));
      p.set("in_turnMode", derivedTurnMode);
      p.set("in_straightenLines", settings.straightenLines ? "true" : "false");
      p.set("in_generateAllPoints", settings.generateAllPoints ? "true" : "false");
      p.set("in_allPointsAction", normalizeActionForServer(settings.allPointsAction));
      p.set("maintainAlt", settings.maintainAlt ? "true" : "false");
      p.set("in_flipPath", settings.flipPath ? "true" : "false");
      p.set("pass", settings.pass);
      return p.toString();
    }

    // ── Search / geocode ─────────────────────────────────────────────────────
    async function search(query: string) {
      if (!query.trim()) return;
      const ll = parseLatLng(query);
      if (ll) {
        mapRef.current?.animateToRegion({ latitude: ll.lat, longitude: ll.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
        return;
      }
      try {
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${propsRef.current.apiKey}`);
        const data = await res.json();
        if (data.results?.[0]?.geometry?.location) {
          const loc = data.results[0].geometry.location;
          mapRef.current?.animateToRegion({ latitude: loc.lat, longitude: loc.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
        }
      } catch {}
    }

    function parseLatLng(text: string): { lat: number; lng: number } | null {
      const s = text.trim().replace(/\s+/g, " ").replace(/[°′'"]/g, "");
      const parts = s.includes(",") ? s.split(",") : s.split(" ");
      if (parts.length < 2) return null;
      const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    }

    // ── Imperative ref ──────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      undo, redo, reset,
      setDrawMode: setDrawModeInternal,
      generateAll: generateAllShapes,
      getWaypoints: () => markers.map(markerToWaypointData),
      search,
      importWaypoints(wps: WaypointData[]) {
        const imported: NativeMarker[] = wps.map((wp, i) => ({
          wmId: flagCount + i, lat: wp.lat, lng: wp.lng,
          altitude: wp.altitude, speed: wp.speed, angle: wp.angle, heading: wp.heading,
          action: wp.action, turnMode: wp.turnMode,
          useStraightLine: wp.useStraightLine, waypointTurnDampingDist: wp.waypointTurnDampingDist,
        }));
        setMarkers((prev) => [...prev, ...imported]);
        setFlagCount((c) => c + imported.length);
        if (wps.length > 0 && mapRef.current) {
          mapRef.current.fitToCoordinates(
            wps.map((w) => ({ latitude: w.lat, longitude: w.lng })),
            { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
          );
        }
      },
      bulkEdit() {}, getSelectionCount: () => 0, selectAll() {}, copySelection() {}, paste() {},
      addKmlOverlay() {}, clearOverlays() {}, removeOverlay() {},
      convertAllUnits() {}, rotateHeadings() {}, setHeadingAngle() {},
      beginRotate() {}, beginScale() {},
      setWindOverlay() {}, clearWindOverlay() {},
      setWindBarbGrid() {}, setFlightPathCrosswind() {},
    }));

    // ── Geolocation ──────────────────────────────────────────────────────────
    useEffect(() => {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }),
          () => {}
        );
      }
    }, []);

    return (
      <View style={styles.wrapper}>
        <MapView
          ref={mapRef} style={styles.map} region={region} onRegionChangeComplete={setRegion}
          mapType="hybrid" showsUserLocation showsCompass
          onPress={handleMapPress} onLongPress={handleLongPress}
          rotateEnabled={false} pitchEnabled={false}
        >
          {polygons.map((pts, i) => (
            <Polygon
              key={`poly-${i}`}
              coordinates={pts.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor="#0d6efd" strokeWidth={2} fillColor="rgba(13,110,253,0.08)"
              tappable
              onPress={() => generateAllShapes()}
            />
          ))}
          {polygonPts.length > 0 && (
            <Polyline
              coordinates={polygonPts.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor="#0d6efd" strokeWidth={2}
            />
          )}
          {circles.map((c, i) => (
            <Circle
              key={`circ-${i}`}
              center={{ latitude: c.center.lat, longitude: c.center.lng }}
              radius={c.radius} strokeColor="#0d6efd" strokeWidth={2} fillColor="rgba(13,110,253,0.08)"
            />
          ))}
          {markers.length >= 2 && (
            <Polyline
              coordinates={[...markers].sort((a, b) => a.wmId - b.wmId).map((m) => ({ latitude: m.lat, longitude: m.lng }))}
              strokeColor="#0d6efd" strokeWidth={2}
            />
          )}
          {markers.map((m) => {
            const sorted = [...markers].sort((a, b) => a.wmId - b.wmId);
            const pos = sorted.findIndex((x) => x.wmId === m.wmId);
            const isStart = sorted.length > 1 && pos === 0;
            const isEnd = sorted.length > 1 && pos === sorted.length - 1;
            const color = isStart ? "#198754" : isEnd ? "#dc3545" : "#1565c0";
            const label = sorted.length === 1 ? "1" : isStart ? "S" : isEnd ? "E" : String(pos + 1);
            return (
              <Marker
                key={`wp-${m.wmId}`}
                coordinate={{ latitude: m.lat, longitude: m.lng }}
                pinColor={color} title={`WP #${m.wmId}`}
                draggable
                onPress={() => { setSelectedMarker(m); propsRef.current.onSelectedWaypointChange(markerToWaypointData(m)); }}
                onDragEnd={(e) => {
                  setMarkers((prev) => prev.map((x) => x.wmId === m.wmId ? { ...x, lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude } : x));
                }}
              >
                <View style={[styles.markerDot, { backgroundColor: color }]}>
                  <Text style={styles.markerLabel}>{label}</Text>
                </View>
                <Callout>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>Waypoint #{m.wmId}</Text>
                    <Text style={styles.calloutRow}>{m.lat.toFixed(7)}, {m.lng.toFixed(7)}</Text>
                    <Text style={styles.calloutRow}>Alt: {m.altitude}m · Speed: {m.speed}m/s</Text>
                    <Text style={styles.calloutRow}>Action: {m.action}</Text>
                  </View>
                </Callout>
              </Marker>
            );
          })}
        </MapView>
        {drawMode === "polygon" && (
          <View style={styles.hint}><Text style={styles.hintText}>Tap to add points · Long-press or tap near start to finish</Text></View>
        )}
        {drawMode === "marker" && (
          <View style={styles.hint}><Text style={styles.hintText}>Tap to place a waypoint</Text></View>
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  map: { flex: 1 },
  markerDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  markerLabel: { color: "#fff", fontSize: 10, fontWeight: "700" },
  callout: { padding: 8, minWidth: 140 },
  calloutTitle: { fontSize: 13, fontWeight: "700", color: "#212529", marginBottom: 4 },
  calloutRow: { fontSize: 12, color: "#495057", marginBottom: 2 },
  hint: { position: "absolute", bottom: 12, left: 12, right: 12, backgroundColor: "rgba(13,110,253,0.85)", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  hintText: { color: "#fff", fontSize: 12, fontWeight: "500", textAlign: "center" },
});
