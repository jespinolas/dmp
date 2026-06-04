import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";

import type { GenerationSettings } from "../services/generator";
import {
  type DjiUploadSettings,
  getDefaultDjiDir,
  getDjiDirPresets,
  loadDjiSettings,
  saveDjiSettings,
  uploadKmzToDji
} from "../services/djiUpload";
import {
  type WindReport,
  type WindLevel,
  type CrosswindResult,
  WIND_ALTITUDE_LABELS,
  analyzeMissionWind,
  fetchWindReport,
  windBgColor,
  windColor,
  windDirLabel,
  windLabel,
  windWarning
} from "../services/weather";
import { type AuthState, apiCall, clearAuth, loadAuth, saveAuth } from "../services/auth";
import type {
  DrawMode,
  MapEditorHandle,
  MapEditorState,
  WaypointData
} from "./MapEditorCanvas";
import { MapEditorCanvas } from "./MapEditorCanvas";

// ─── Config ──────────────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in your .env file
const MAPS_API_KEY =
  (typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) ||
  "";

const API_BASE_URL =
  (typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL) ||
  "http://localhost:8088";

// ─── Types ────────────────────────────────────────────────────────────────────
type WorkflowTab = "simple" | "advanced" | "download" | "saved";
type FinalAction = 0 | 1; // 0=hover, 1=return to home

const ACTIONS: Array<{ key: string; label: string }> = [
  { key: "none", label: "No Action" },
  { key: "take-picture", label: "Take Picture" },
  { key: "start-recording", label: "Start Recording" },
  { key: "stop-recording", label: "Stop Recording" },
];

const DRAW_TOOLS: Array<{ key: DrawMode; label: string; icon: string }> = [
  { key: "polygon", label: "Polygon", icon: "⬠" },
  { key: "rectangle", label: "Rectangle", icon: "▭" },
  { key: "circle", label: "Circle", icon: "○" },
  { key: "marker", label: "Waypoint", icon: "⊕" },
  { key: "select", label: "Select", icon: "⊞" },
];

// ─── Camera auto-calc helpers ─────────────────────────────────────────────────
const CAM_TAN = Math.tan(41.05 * Math.PI / 180); // ≈ 0.8728
function overlapToDistance(overlapPct: number, altM: number): number {
  return Math.max(1, altM * CAM_TAN * (1 - overlapPct / 100));
}
function distanceToOverlap(distM: number, altM: number): number {
  if (altM <= 0) return 80;
  return Math.round(Math.max(25, Math.min(95, (1 - distM / (altM * CAM_TAN)) * 100)));
}

// ─── Component ────────────────────────────────────────────────────────────────
export function EditorScreen() {
  const mapRef = useRef<MapEditorHandle>(null);

  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>("simple");
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [search, setSearch] = useState("");
  const [mapState, setMapState] = useState<MapEditorState>({
    canUndo: false,
    canRedo: false,
    hasShapes: false,
    hasWaypoints: false,
    waypointCount: 0,
    selectionCount: 0,
    eta: "—",
    etaSeconds: 0,
    isGenerating: false,
    generationError: null,
    photoCadenceWarning: false,
    overlayCount: 0,
    overlays: [],
    isSettingStale: false,
    timedShotsNote: false,
    headingTransformAngle: null,
    geoTransformMode: null,
  });
  const [selectedWaypoint, setSelectedWaypoint] = useState<WaypointData | null>(null);
  const [finalAction, setFinalAction] = useState<FinalAction>(0);
  const [missionName, setMissionName] = useState("WaypointMap Mission");
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(() => {
    const defaults: GenerationSettings = {
      allPointsAction: "take-picture",
      altitude: 60,
      boundsType: "polygon",
      distance: 25,
      generateAllPoints: false,
      gimbalAngle: -45,
      interval: 0,
      lineAngleDegrees: 0,
      lineAngleMode: "preset",
      lineOrientation: "0",
      maintainAlt: false,
      overlap: 80,
      pass: "",
      flipPath: false,
      speed: 3.5,
      straightenLines: false,
      turnMode: "coordinateTurn",
      units: "0",
    };
    try {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("wm_settings_v1") : null;
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {}
    return defaults;
  });

  // Keep a ref of settings to send into the map without re-mounting
  const settingsRef = useRef(generationSettings);
  settingsRef.current = generationSettings;

  // Skip auto-calc flag to prevent feedback loops
  const skipAutoCalc = useRef(false);

  // Session banner state
  const [sessionBanner, setSessionBanner] = useState<null | Array<any>>(null);

  // Split mission state (feature I)
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMode, setSplitMode] = useState<"battery" | "waypoints">("battery");
  const [batteryMinutes, setBatteryMinutes] = useState(20);
  const [maxWaypoints, setMaxWaypoints] = useState(99);
  const [rthResume, setRthResume] = useState(false);

  // DJI auto-upload state (Android only)
  const [djiSettings, setDjiSettings] = useState<DjiUploadSettings>(loadDjiSettings);
  const [djiUploadStatus, setDjiUploadStatus] = useState<string | null>(null);

  // Phone download state
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const phoneKmzUrl = API_BASE_URL.replace(/localhost|127\.0\.0\.1/, "YOUR_LAPTOP_IP") + "/api/kmz/latest";
  const phonePageUrl = API_BASE_URL.replace(/localhost|127\.0\.0\.1/, "YOUR_LAPTOP_IP") + "/download";
  const qrImageUrl = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(phonePageUrl);

  // Auth state
  const [auth, setAuth] = useState<AuthState | null>(loadAuth);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [savedMissions, setSavedMissions] = useState<Array<{ id: number; name: string; finalAction: string; waypointCount: number; updatedAt: string }>>([]);
  const [savedMissionsLoading, setSavedMissionsLoading] = useState(false);

  // ── Auth actions ──
  const handleAuth = useCallback(async () => {
    setAuthError(null);
    try {
      const data = await apiCall(API_BASE_URL, `/auth/${authMode}`, "POST", {
        email: authEmail,
        password: authPassword,
      });
      const newAuth: AuthState = { token: data.token, email: data.email, userId: data.userId };
      setAuth(newAuth);
      saveAuth(newAuth);
      setAuthEmail("");
      setAuthPassword("");
    } catch (err: any) {
      setAuthError(err.message);
    }
  }, [authMode, authEmail, authPassword]);

  const handleLogout = useCallback(() => {
    setAuth(null);
    clearAuth();
    setSavedMissions([]);
  }, []);

  const loadSavedMissions = useCallback(async () => {
    if (!auth) return;
    setSavedMissionsLoading(true);
    try {
      const data = await apiCall(API_BASE_URL, "/api/missions", "GET", undefined, auth.token);
      setSavedMissions(data);
    } catch { /* ignore */ }
    setSavedMissionsLoading(false);
  }, [auth]);

  const handleSaveMission = useCallback(async () => {
    if (!auth) return;
    const waypoints = mapRef.current?.getWaypoints() ?? [];
    if (!waypoints.length) return;
    try {
      const payload = waypoints.map((w) => ({
        id: w.id,
        Latitude: w.lat,
        Longitude: w.lng,
        altitude: w.altitude,
        speed: w.speed,
        gimbalAngle: w.angle,
        heading: w.heading,
        action: w.action,
        turnMode: w.turnMode,
        useStraightLine: w.useStraightLine,
        waypointTurnDampingDist: w.waypointTurnDampingDist,
      }));
      await apiCall(API_BASE_URL, "/api/missions", "POST", {
        name: missionName,
        finalAction: finalAction === 0 ? "hover" : "goHome",
        waypoints: payload,
      }, auth.token);
      loadSavedMissions();
    } catch (err: any) {
      alert(err.message);
    }
  }, [auth, missionName, finalAction, loadSavedMissions]);

  const handleLoadMission = useCallback(async (id: number) => {
    if (!auth) return;
    try {
      const data = await apiCall(API_BASE_URL, `/api/missions/${id}`, "GET", undefined, auth.token);
      let wps;
      if (typeof data.waypoints === "string") {
        wps = JSON.parse(data.waypoints);
      } else {
        wps = data.waypoints;
      }
      const converted = wps.map((w: any) => ({
        id: w.id ?? 0,
        lat: w.Latitude ?? w.latitude ?? 0,
        lng: w.Longitude ?? w.longitude ?? 0,
        altitude: w.altitude ?? 60,
        speed: w.speed ?? 3.5,
        angle: w.gimbalAngle ?? w.angle ?? -45,
        heading: w.heading ?? 0,
        action: w.action ?? "noAction",
        turnMode: w.turnMode ?? "coordinateTurn",
        useStraightLine: w.useStraightLine ?? 0,
        waypointTurnDampingDist: w.waypointTurnDampingDist ?? 20,
      }));
      mapRef.current?.importWaypoints(converted);
      if (data.name) setMissionName(data.name);
    } catch (err: any) {
      alert(err.message);
    }
  }, [auth]);

  const handleDeleteMission = useCallback(async (id: number) => {
    if (!auth) return;
    try {
      await apiCall(API_BASE_URL, `/api/missions/${id}`, "DELETE", undefined, auth.token);
      setSavedMissions((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  }, [auth]);

  // Load saved missions when auth changes or tab switches to saved
  useEffect(() => {
    if (auth && workflowTab === "saved") {
      loadSavedMissions();
    }
  }, [auth, workflowTab, loadSavedMissions]);

  // Feature 4: cursor coordinates state
  const [cursorLL, setCursorLL] = useState<{ lat: number; lng: number } | null>(null);

  // Wind/weather state
  const [windReport, setWindReport] = useState<WindReport | null>(null);
  const [windEnabled, setWindEnabled] = useState(true);
  const [windMaxSpeed, setWindMaxSpeed] = useState(8);
  const [windAltitude, setWindAltitude] = useState<WindLevel>(10);
  const [windLoading, setWindLoading] = useState(false);

  // ── Wind fetch ──
  const refreshWind = useCallback(async () => {
    const waypoints = mapRef.current?.getWaypoints();
    let lat: number, lng: number;
    if (waypoints && waypoints.length > 0) {
      const sums = waypoints.reduce((a, w) => ({ lat: a.lat + w.lat, lng: a.lng + w.lng }), { lat: 0, lng: 0 });
      lat = sums.lat / waypoints.length;
      lng = sums.lng / waypoints.length;
    } else if (cursorLL) {
      lat = cursorLL.lat;
      lng = cursorLL.lng;
    } else {
      return;
    }
    setWindLoading(true);
    const report = await fetchWindReport(lat, lng);
    setWindReport(report);
    setWindLoading(false);

    if (report && mapRef.current) {
      const wp = report.levels[windAltitude] ?? report.levels[10];
      const level = windWarning(wp.speed, windMaxSpeed);
      mapRef.current.setWindOverlay(wp.speed, wp.direction, level);
      mapRef.current.setWindBarbGrid({ lat: report.lat, lng: report.lng, speed: wp.speed, direction: wp.direction, gusts: wp.gusts, level });
      // Crosswind analysis on flight path
      if (waypoints && waypoints.length > 1) {
        const analysis = analyzeMissionWind(waypoints, wp.speed, wp.direction, windMaxSpeed);
        mapRef.current.setFlightPathCrosswind(analysis.segments);
      }
    }
  }, [cursorLL, windMaxSpeed, windAltitude]);

  // Auto-refresh wind when waypoints are generated or altitude changes
  useEffect(() => {
    if (windEnabled && mapState.hasWaypoints && !mapState.isGenerating) {
      refreshWind();
    }
  }, [mapState.waypointCount, mapState.isGenerating, windEnabled, refreshWind, windAltitude]);

  // Clear wind overlay when disabled
  useEffect(() => {
    if (!windEnabled) {
      mapRef.current?.clearWindOverlay();
      setWindReport(null);
    }
  }, [windEnabled]);

  // ── Auto-calc: overlap+altitude → distance (feature G) ──
  useEffect(() => {
    if (skipAutoCalc.current) return;
    const newDist = parseFloat(overlapToDistance(generationSettings.overlap, generationSettings.altitude).toFixed(1));
    skipAutoCalc.current = true;
    setGenerationSettings((c) => ({ ...c, distance: newDist }));
    setTimeout(() => { skipAutoCalc.current = false; }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationSettings.overlap, generationSettings.altitude]);

  // ── Auto-calc: distance+speed → interval (feature G) ──
  useEffect(() => {
    if (skipAutoCalc.current) return;
    const spd = generationSettings.speed;
    if (spd > 0) {
      const newInterval = parseFloat((generationSettings.distance / spd).toFixed(1));
      skipAutoCalc.current = true;
      setGenerationSettings((c) => ({ ...c, interval: newInterval }));
      setTimeout(() => { skipAutoCalc.current = false; }, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationSettings.distance, generationSettings.speed]);

  // ── Auto-save settings (feature J) ──
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("wm_settings_v1", JSON.stringify(generationSettings));
      }
    } catch {}
  }, [generationSettings]);

  // ── Session waypoint save/restore (feature J) ──
  useEffect(() => {
    if (mapState.waypointCount > 0) {
      try {
        const wps = mapRef.current?.getWaypoints();
        if (wps && wps.length > 0 && typeof localStorage !== "undefined") {
          localStorage.setItem("wm_session_wps", JSON.stringify(wps));
        }
      } catch {}
    }
  }, [mapState.waypointCount]);

  // ── On mount: check for saved session (feature J) ──
  useEffect(() => {
    try {
      const saved = typeof localStorage !== "undefined" ? localStorage.getItem("wm_session_wps") : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessionBanner(parsed);
        }
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── On mount: apply default preset ──
  useEffect(() => {
    if (!defaultPreset || presets.length === 0) return;
    const dp = presets.find((p) => p.name === defaultPreset);
    if (dp) setGenerationSettings(dp.values);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feature 5: Mission name → page title (web only)
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.title = missionName ? `${missionName} — WaypointMap` : "WaypointMap Editor";
    }
  }, [missionName]);

  // ── Presets (localStorage) ──
  const PRESETS_KEY = "wm_presets_v1";
  type Preset = { name: string; values: GenerationSettings };
  const [presets, setPresets] = useState<Preset[]>(() => {
    try { return JSON.parse(typeof localStorage !== "undefined" ? localStorage.getItem(PRESETS_KEY) ?? "[]" : "[]"); }
    catch { return []; }
  });
  const [presetName, setPresetName] = useState("");
  const [defaultPreset, setDefaultPreset] = useState<string | null>(() => {
    try { return typeof localStorage !== "undefined" ? localStorage.getItem("wm_preset_default") : null; }
    catch { return null; }
  });

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const updated = [...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { name, values: generationSettings }];
    setPresets(updated);
    if (typeof localStorage !== "undefined") localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    setPresetName("");
  }
  function loadPreset(p: Preset) { setGenerationSettings(p.values); }
  function deletePreset(name: string) {
    const updated = presets.filter((p) => p.name !== name);
    setPresets(updated);
    if (typeof localStorage !== "undefined") localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
    if (defaultPreset === name) {
      setDefaultPreset(null);
      if (typeof localStorage !== "undefined") localStorage.removeItem("wm_preset_default");
    }
  }
  function toggleDefaultPreset(name: string) {
    if (defaultPreset === name) {
      setDefaultPreset(null);
      if (typeof localStorage !== "undefined") localStorage.removeItem("wm_preset_default");
    } else {
      setDefaultPreset(name);
      if (typeof localStorage !== "undefined") localStorage.setItem("wm_preset_default", name);
    }
  }

  // ── Onboarding ──
  const [onboardStep, setOnboardStep] = useState<0 | 1 | 2 | 3>(() => {
    try { return localStorage.getItem("wm_onboard_done") === "1" ? 0 : 1; }
    catch { return 1; }
  });
  function onboardNext() {
    const next = (onboardStep + 1) as 0 | 1 | 2 | 3;
    if (next > 3) finishOnboard();
    else setOnboardStep(next);
  }
  function finishOnboard() {
    setOnboardStep(0);
    try { localStorage.setItem("wm_onboard_done", "1"); } catch {}
  }

  function setMode(mode: DrawMode) {
    const next = drawMode === mode ? null : mode;
    setDrawMode(next);
    mapRef.current?.setDrawMode(next);
  }

  function handleTabClick(tab: WorkflowTab) {
    if (tab !== workflowTab) {
      setWorkflowTab(tab);
      // Cancel drawing when user clicks a tab
      setDrawMode(null);
      mapRef.current?.setDrawMode(null);
    }
  }

  // P3: useCallback for stable handlers
  const handleStateChange = useCallback((state: MapEditorState) => {
    setMapState(state);
    // Auto-switch to download when waypoints appear after generation
    if (
      state.hasWaypoints &&
      !state.isGenerating &&
      !state.hasShapes
    ) {
      setWorkflowTab("download");
    }
  }, []);

  const handleWaypointUpdated = useCallback((_wp: WaypointData) => {
    // Could update local preview; map manages truth
  }, []);

  const handleDownloadKmz = useCallback(async () => {
    const waypoints = mapRef.current?.getWaypoints() ?? [];
    if (!waypoints.length) return;
    const payload = waypoints.map((w) => ({
      id: w.id,
      Latitude: w.lat,
      Longitude: w.lng,
      altitude: w.altitude,
      speed: w.speed,
      gimbalAngle: w.angle,
      heading: w.heading,
      action: w.action,
      turnMode: w.turnMode,
      useStraightLine: w.useStraightLine,
      waypointTurnDampingDist: w.waypointTurnDampingDist,
    }));
    const params = new URLSearchParams();
    params.set("missionName", missionName);
    params.set("finalAction", String(finalAction));
    params.set("waypoints", JSON.stringify(payload));
    try {
      const res = await fetch(`${API_BASE_URL}/Download`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${missionName.replace(/\s+/g, "_")}.kmz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // DJI auto-upload (Android only)
      if (djiSettings.enabled && Platform.OS === "android") {
        setDjiUploadStatus("Uploading to DJI…");
        const dst = await uploadKmzToDji(blob, missionName, djiSettings);
        setDjiUploadStatus(dst ? `Saved: ${dst}` : "Upload failed — check folder");
        setTimeout(() => setDjiUploadStatus(null), 6000);
      }

      setHasDownloaded(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    }
  }, [missionName, finalAction, djiSettings]);

  // ── Download Split (feature I) ──
  const handleDownloadSplit = useCallback(async () => {
    const waypoints = mapRef.current?.getWaypoints() ?? [];
    if (!waypoints.length) return;
    const payload = waypoints.map((w) => ({
      id: w.id,
      Latitude: w.lat,
      Longitude: w.lng,
      altitude: w.altitude,
      speed: w.speed,
      gimbalAngle: w.angle,
      heading: w.heading,
      action: w.action,
      turnMode: w.turnMode,
      useStraightLine: w.useStraightLine,
      waypointTurnDampingDist: w.waypointTurnDampingDist,
    }));
    const params = new URLSearchParams();
    params.set("missionName", missionName);
    params.set("finalAction", String(finalAction));
    params.set("waypoints", JSON.stringify(payload));
    params.set("splitMode", splitMode);
    params.set("batteryMinutes", String(batteryMinutes));
    params.set("maxWaypoints", String(maxWaypoints));
    params.set("rthResume", rthResume ? "true" : "false");
    try {
      const res = await fetch(`${API_BASE_URL}/Home/DownloadSplit`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mission_split.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // DJI auto-upload — note: split ZIP contains multiple KMZs,
      // we upload the ZIP filename; user can extract on-device
      if (djiSettings.enabled && Platform.OS === "android") {
        setDjiUploadStatus("Uploading split ZIP to DJI…");
        const dst = await uploadKmzToDji(blob, missionName + "_split", { ...djiSettings, fixedFilename: null });
        setDjiUploadStatus(dst ? `Saved: ${dst}` : "Upload failed — check folder");
        setTimeout(() => setDjiUploadStatus(null), 6000);
      }

      setHasDownloaded(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    }
  }, [missionName, finalAction, splitMode, batteryMinutes, maxWaypoints, rthResume, djiSettings]);

  // ── Import KMZ ──
  async function handleImportKmz(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_BASE_URL}/Home/ImportKmzSmart`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      const data = await res.json();
      const wps: WaypointData[] = (data.waypoints ?? []).map((w: any) => ({
        id: w.id ?? 0,
        lat: w.Latitude ?? w.latitude ?? 0,
        lng: w.Longitude ?? w.longitude ?? 0,
        altitude: w.altitude ?? generationSettings.altitude,
        speed: w.speed ?? generationSettings.speed,
        angle: w.gimbalAngle ?? generationSettings.gimbalAngle,
        heading: w.heading ?? 0,
        action: w.action ?? "noAction",
        turnMode: w.turnMode ?? "coordinateTurn",
        useStraightLine: w.useStraightLine ?? 0,
        waypointTurnDampingDist: w.waypointTurnDampingDist ?? 0.2,
      }));
      if (wps.length) {
        mapRef.current?.importWaypoints(wps);
        if (data.missionName) setMissionName(data.missionName);
      } else {
        alert("No waypoints found in this file.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    }
  }

  const openFilePicker = useCallback(() => {
    if (Platform.OS !== "web") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".kmz,.kml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleImportKmz(file);
    };
    input.click();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noApiKey = !MAPS_API_KEY;
  const canGenerate = mapState.hasShapes && !mapState.isGenerating;
  const canDownload = mapState.hasWaypoints;
  const overLimit = mapState.waypointCount > 99;

  return (
    <View style={styles.page}>
      {/* ── Session restore banner (feature J) ── */}
      {sessionBanner && (
        <View style={{ backgroundColor: "#e8f4fd", borderBottomWidth: 1, borderBottomColor: "#bee3f8", padding: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ flex: 1, fontSize: 13, color: "#1a5276" }}>Restore last session? ({sessionBanner.length} waypoints)</Text>
          <Pressable
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => { mapRef.current?.importWaypoints(sessionBanner); setSessionBanner(null); }}
            style={{ backgroundColor: "#0d6efd", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>Yes</Text>
          </Pressable>
          <Pressable
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setSessionBanner(null)}
            style={{ borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#adb5bd" }}
          >
            <Text style={{ color: "#6c757d", fontSize: 13 }}>No</Text>
          </Pressable>
        </View>
      )}

      {/* Feature 1: Stale settings banner */}
      {mapState.isSettingStale && mapState.hasWaypoints && (
        <View style={styles.staleBanner}>
          <Text style={styles.staleBannerText}>⚠️ Settings changed — regenerate for updated waypoints.</Text>
          <Pressable
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => mapRef.current?.generateAll()}
            style={styles.staleBannerBtn}
          >
            <Text style={styles.staleBannerBtnText}>Regenerate</Text>
          </Pressable>
        </View>
      )}

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search location or coordinates…"
          placeholderTextColor="#6c757d"
          style={styles.searchInput}
          onSubmitEditing={() => {
            if (search.trim()) mapRef.current?.search(search.trim());
          }}
          returnKeyType="search"
        />

        {/* Draw toolbar */}
        <View style={styles.drawTools}>
          {DRAW_TOOLS.map((tool) => (
            <Pressable
              key={tool.key}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setMode(tool.key)}
              style={[
                styles.drawBtn,
                drawMode === tool.key && styles.drawBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.drawBtnIcon,
                  drawMode === tool.key && styles.drawBtnIconActive,
                ]}
              >
                {tool.icon}
              </Text>
              <Text
                style={[
                  styles.drawBtnLabel,
                  drawMode === tool.key && styles.drawBtnLabelActive,
                ]}
              >
                {tool.label}
              </Text>
            </Pressable>
          ))}
          {drawMode && (
            <Pressable
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setMode(null)}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelBtnText}>✕ Cancel</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.topActions}>
          <ToolbarButton
            label="Undo"
            disabled={!mapState.canUndo}
            subtle
            onPress={() => mapRef.current?.undo()}
          />
          <ToolbarButton
            label="Redo"
            disabled={!mapState.canRedo}
            subtle
            onPress={() => mapRef.current?.redo()}
          />
          <ToolbarButton
            label="Import KMZ"
            subtle
            onPress={openFilePicker}
          />
          {mapState.hasWaypoints && (
            <>
              <ToolbarButton label="Select All" subtle onPress={() => mapRef.current?.selectAll()} />
              <ToolbarButton label="Copy" subtle disabled={!mapState.hasWaypoints} onPress={() => mapRef.current?.copySelection()} />
              <ToolbarButton label="Paste" subtle onPress={() => mapRef.current?.paste()} />
            </>
          )}
          <ToolbarButton
            label="Reset"
            disabled={!mapState.hasShapes && !mapState.hasWaypoints}
            danger
            onPress={() => mapRef.current?.reset()}
          />
        </View>
      </View>

      {/* ── Main content ── */}
      <View style={styles.contentRow}>
        {/* Map */}
        <View style={styles.mapArea}>
          {noApiKey ? (
            <View style={styles.noKeyOverlay}>
              <Text style={styles.noKeyTitle}>Google Maps API Key Required</Text>
              <Text style={styles.noKeyBody}>
                Set{" "}
                <Text style={styles.noKeyCode}>
                  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
                </Text>{" "}
                in your{" "}
                <Text style={styles.noKeyCode}>.env</Text> file, then restart
                the dev server.
              </Text>
            </View>
          ) : (
            <MapEditorCanvas
              ref={mapRef}
              apiKey={MAPS_API_KEY}
              apiBaseUrl={API_BASE_URL}
              generationSettings={generationSettings}
              onStateChange={handleStateChange}
              onSelectedWaypointChange={setSelectedWaypoint}
              onWaypointUpdated={handleWaypointUpdated}
              onCursorMove={setCursorLL}
            />
          )}

          {/* ETA badge */}
          {mapState.hasWaypoints && (
            <View style={[styles.etaBadge, overLimit && styles.etaBadgeWarn]}>
              <Text style={styles.etaText}>
                {mapState.waypointCount} WP · {mapState.eta}
                {overLimit ? " ⚠️ >99 limit" : ""}
              </Text>
            </View>
          )}

          {/* Feature 4: Live cursor coordinates overlay */}
          {cursorLL && (
            <View style={styles.cursorCoords}>
              <Text style={styles.cursorCoordsText}>
                {cursorLL.lat.toFixed(6)}, {cursorLL.lng.toFixed(6)}
              </Text>
            </View>
          )}

          {/* Start/End legend */}
          {mapState.hasWaypoints && (
            <View style={styles.seLegend}>
              <View style={styles.seLegendItem}>
                <View style={[styles.seLegendDot, { backgroundColor: "#198754" }]} />
                <Text style={styles.seLegendText}>S — Home</Text>
              </View>
              {mapState.waypointCount > 1 && (
                <View style={styles.seLegendItem}>
                  <View style={[styles.seLegendDot, { backgroundColor: "#dc3545" }]} />
                  <Text style={styles.seLegendText}>E — End</Text>
                </View>
              )}
            </View>
          )}

          {/* Photo cadence warning */}
          {mapState.photoCadenceWarning && (
            <View style={styles.cadenceWarn}>
              <Text style={styles.cadenceWarnText}>⚠️ Some consecutive Take Photo waypoints are &lt;5s apart — camera may miss shots.</Text>
            </View>
          )}

          {/* Draw hint */}
          {drawMode && (
            <View style={styles.drawHint}>
              <Text style={styles.drawHintText}>
                {drawMode === "polygon"
                  ? "Click to add points · Double-click or click near start to finish"
                  : drawMode === "rectangle"
                  ? "Click and drag to draw a rectangle"
                  : drawMode === "circle"
                  ? "Click and drag to draw a circle"
                  : "Click anywhere on the map to place a waypoint"}
              </Text>
            </View>
          )}

          {/* Feature 3: Heading transform overlay */}
          {mapState.headingTransformAngle !== null && (
            <View style={styles.transformPanel}>
              <Text style={styles.transformPanelTitle}>Heading offset: {mapState.headingTransformAngle}°</Text>
              <View style={styles.transformPanelRow}>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => mapRef.current?.rotateHeadings(-5)}
                  style={styles.transformBtn}
                >
                  <Text style={styles.transformBtnText}>←</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => mapRef.current?.rotateHeadings(5)}
                  style={styles.transformBtn}
                >
                  <Text style={styles.transformBtnText}>→</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    // commit via Enter key proxy — call setHeadingAngle with current angle to trigger commit
                    // We simulate commit by pressing Enter; since we can't from here, use the ref method
                    // The best approach: expose commitHeadings or use keyboard Enter
                    // For now, rotate by 0 to trigger no change, then trust user presses Enter
                    // Actually expose commit via a dedicated call — using setHeadingAngle as proxy is wrong
                    // We'll just dispatch a synthetic keyboard event
                    if (typeof document !== "undefined") {
                      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                    }
                  }}
                  style={[styles.transformBtn, styles.transformBtnCommit]}
                >
                  <Text style={[styles.transformBtnText, { color: "#fff" }]}>Commit</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    if (typeof document !== "undefined") {
                      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                    }
                  }}
                  style={styles.transformBtn}
                >
                  <Text style={styles.transformBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Feature 6: Geo transform overlay */}
          {mapState.geoTransformMode && (
            <View style={styles.transformPanel}>
              <Text style={styles.transformPanelTitle}>
                {mapState.geoTransformMode === "rotate" ? "🔄 Rotating" : "↔ Scaling"}
              </Text>
              <Text style={styles.transformPanelHint}>
                {mapState.geoTransformMode === "rotate"
                  ? "← → arrows or buttons to rotate ±5°"
                  : "↑ ↓ arrows or buttons to scale ×1.05 / ×0.95"}
              </Text>
              <View style={styles.transformPanelRow}>
                {mapState.geoTransformMode === "rotate" ? (
                  <>
                    <Pressable
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => {
                        if (typeof document !== "undefined") {
                          document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
                        }
                      }}
                      style={styles.transformBtn}
                    >
                      <Text style={styles.transformBtnText}>←</Text>
                    </Pressable>
                    <Pressable
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => {
                        if (typeof document !== "undefined") {
                          document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
                        }
                      }}
                      style={styles.transformBtn}
                    >
                      <Text style={styles.transformBtnText}>→</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => {
                        if (typeof document !== "undefined") {
                          document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
                        }
                      }}
                      style={styles.transformBtn}
                    >
                      <Text style={styles.transformBtnText}>↑</Text>
                    </Pressable>
                    <Pressable
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => {
                        if (typeof document !== "undefined") {
                          document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
                        }
                      }}
                      style={styles.transformBtn}
                    >
                      <Text style={styles.transformBtnText}>↓</Text>
                    </Pressable>
                  </>
                )}
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    if (typeof document !== "undefined") {
                      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                    }
                  }}
                  style={[styles.transformBtn, styles.transformBtnCommit]}
                >
                  <Text style={[styles.transformBtnText, { color: "#fff" }]}>Commit</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => {
                    if (typeof document !== "undefined") {
                      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                    }
                  }}
                  style={styles.transformBtn}
                >
                  <Text style={styles.transformBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── Side panel ── */}
        <View style={styles.sidePanel}>
          {/* Overlay chips */}
          {mapState.overlays.length > 0 && (
            <View style={styles.overlayChipsBar}>
              <Text style={styles.overlayChipsLabel}>Overlays:</Text>
              <View style={styles.chipRow}>
                {mapState.overlays.map((o) => (
                  <View key={o.id} style={styles.overlayChip}>
                    <Text style={styles.overlayChipText}>
                      {o.name} ({o.type})
                    </Text>
                    <Pressable
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      onPress={() => mapRef.current?.removeOverlay(o.id)}
                    >
                      <Text style={styles.overlayChipDel}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
              <Pressable
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                onPress={() => mapRef.current?.clearOverlays()}
              >
                <Text style={styles.overlayClearText}>Clear all</Text>
              </Pressable>
            </View>
          )}

          {/* Wind/weather panel */}
          <SwitchRow
            label="Wind overlay"
            value={windEnabled}
            onChange={setWindEnabled}
          />
          {windEnabled && (
            <View style={weatherStyles.panel}>
              {!windReport && (
                <Pressable onPress={refreshWind} style={weatherStyles.fetchBtn} disabled={windLoading}>
                  <Text style={weatherStyles.fetchText}>{windLoading ? "Fetching wind data…" : "Check wind conditions"}</Text>
                </Pressable>
              )}
              {windReport && (() => {
                const wp = windReport.levels[windAltitude] ?? windReport.levels[10];
                const level = windWarning(wp.speed, windMaxSpeed);
                const waypoints = mapRef.current?.getWaypoints();
                let crosswindInfo: CrosswindResult | null = null;
                if (waypoints && waypoints.length > 1) {
                  crosswindInfo = analyzeMissionWind(waypoints, wp.speed, wp.direction, windMaxSpeed).worst;
                }
                return (
                  <>
                    {/* Status banner */}
                    <View style={[weatherStyles.banner, { backgroundColor: windBgColor(level), borderLeftColor: windColor(level) }]}>
                      <Text style={[weatherStyles.bannerTitle, { color: windColor(level) }]}>{windLabel(level)}</Text>
                      <Text style={weatherStyles.bannerMeta}>
                        {wp.speed.toFixed(1)} m/s from {windDirLabel(wp.direction)} · gusts {wp.gusts.toFixed(1)} m/s
                      </Text>
                    </View>

                    {/* Altitude selector */}
                    <Text style={weatherStyles.sectionLabel}>Wind at altitude</Text>
                    <View style={weatherStyles.chipRow}>
                      {([10, 80, 120, 180] as WindLevel[]).filter((a) => windReport.levels[a]).map((a) => {
                        const ap = windReport.levels[a]!;
                        const al = windWarning(ap.speed, windMaxSpeed);
                        return (
                          <Pressable
                            key={a}
                            style={[weatherStyles.chip, windAltitude === a && { borderColor: windColor(al), backgroundColor: windBgColor(al) }]}
                            onPress={() => setWindAltitude(a)}
                          >
                            <Text style={[weatherStyles.chipText, windAltitude === a && { color: windColor(al), fontWeight: "700" }]}>
                              {WIND_ALTITUDE_LABELS[a]} — {ap.speed.toFixed(1)} m/s
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Wind compass */}
                    <View style={weatherStyles.compass}>
                      <Text style={weatherStyles.sectionLabel}>Wind direction</Text>
                      <View style={weatherStyles.compassRing}>
                        {["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((d, i) => (
                          <Text key={d} style={[weatherStyles.compassDir, { transform: [{ rotate: `${i * 45}deg` }] }]}>{d}</Text>
                        ))}
                        <View style={[weatherStyles.compassArrow, { transform: [{ rotate: `${wp.direction - 90}deg` }] }]}>
                          <Text style={weatherStyles.compassArrowText}>▼</Text>
                        </View>
                        <Text style={weatherStyles.compassLabel}>{windDirLabel(wp.direction)} {wp.direction}°</Text>
                      </View>
                    </View>

                    {/* Crosswind analysis */}
                    {crosswindInfo && (
                      <View style={[weatherStyles.xwindBox, { borderLeftColor: windColor(crosswindInfo.risk) }]}>
                        <Text style={weatherStyles.sectionLabel}>Crosswind on flight path</Text>
                        <View style={weatherStyles.xwindRow}>
                          <View style={weatherStyles.xwindCol}>
                            <Text style={weatherStyles.xwindVal}>{crosswindInfo.crosswind.toFixed(1)}</Text>
                            <Text style={weatherStyles.xwindUnit}>m/s cross</Text>
                          </View>
                          <View style={weatherStyles.xwindCol}>
                            <Text style={weatherStyles.xwindVal}>{crosswindInfo.headwind > 0 ? "+" : ""}{crosswindInfo.headwind.toFixed(1)}</Text>
                            <Text style={weatherStyles.xwindUnit}>m/s {crosswindInfo.headwind >= 0 ? "headwind" : "tailwind"}</Text>
                          </View>
                          <View style={weatherStyles.xwindCol}>
                            <Text style={[weatherStyles.xwindVal, { color: windColor(crosswindInfo.risk) }]}>
                              {crosswindInfo.crosswindAngle.toFixed(0)}°
                            </Text>
                            <Text style={weatherStyles.xwindUnit}>angle</Text>
                          </View>
                        </View>
                        {crosswindInfo.risk !== "ok" && (
                          <Text style={[weatherStyles.xwindWarn, { color: windColor(crosswindInfo.risk) }]}>
                            ⚠ {crosswindInfo.risk === "danger" ? "Severe crosswind — may exceed drone limits" : "Moderate crosswind — reduced efficiency"}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Hourly forecast */}
                    {windReport.hourly.length > 0 && (
                      <View>
                        <Text style={weatherStyles.sectionLabel}>Hourly forecast</Text>
                        <View style={weatherStyles.forecastRow}>
                          {windReport.hourly.slice(0, 6).map((h, i) => {
                            const hl = windWarning(h.speed10m, windMaxSpeed);
                            const time = new Date(h.time);
                            return (
                              <View key={i} style={[weatherStyles.forecastItem, { borderTopColor: windColor(hl) }]}>
                                <Text style={weatherStyles.forecastTime}>
                                  {time.getHours().toString().padStart(2, "0")}h
                                </Text>
                                <Text style={[weatherStyles.forecastSpeed, { color: windColor(hl) }]}>
                                  {h.speed10m.toFixed(0)}
                                </Text>
                                <Text style={weatherStyles.forecastDir}>{windDirLabel(h.direction10m)}</Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Footer actions */}
                    <View style={weatherStyles.footer}>
                      <Pressable onPress={refreshWind} style={weatherStyles.refreshBtn} disabled={windLoading}>
                        <Text style={weatherStyles.refreshText}>{windLoading ? "…" : "Refresh"}</Text>
                      </Pressable>
                      <Text style={weatherStyles.timestamp}>
                        {new Date(windReport.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
          )}

          {/* Tabs */}
          <View style={styles.tabsRow}>
            {(["simple", "advanced", "download", "saved"] as WorkflowTab[]).map(
              (tab) => (
                <Pressable
                  key={tab}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => handleTabClick(tab)}
                  style={[
                    styles.tab,
                    workflowTab === tab && styles.tabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      workflowTab === tab && styles.tabTextActive,
                    ]}
                  >
                    {tab === "simple"
                      ? "Simple"
                      : tab === "advanced"
                      ? "Advanced"
                      : tab === "download"
                      ? "Download"
                      : "Saved"}
                  </Text>
                </Pressable>
              )
            )}
          </View>

          <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
            {/* ── SIMPLE TAB ── */}
            {workflowTab === "simple" && (
              <View style={styles.panelBody}>
                <Text style={styles.sectionLabel}>Quality / Overlap</Text>
                {/* Native HTML range slider on web */}
                {Platform.OS === "web" ? (
                  <View style={styles.sliderRow}>
                    <Text style={styles.sliderEndLabel}>Speed</Text>
                    {/* @ts-ignore — web-only input */}
                    <input
                      type="range"
                      min={25}
                      max={95}
                      step={1}
                      value={generationSettings.overlap}
                      onChange={(e: any) => {
                        setGenerationSettings((c) => ({ ...c, overlap: Number(e.target.value) }));
                      }}
                      style={{ flex: 1, accentColor: "#0d6efd", cursor: "pointer" }}
                    />
                    <Text style={styles.sliderEndLabel}>Quality</Text>
                  </View>
                ) : (
                  <View style={styles.sliderRow}>
                    <Text style={styles.sliderEndLabel}>Speed</Text>
                    <View style={styles.sliderTrack}>
                      <View style={[styles.sliderFill, { width: `${generationSettings.overlap}%` }]} />
                    </View>
                    <Text style={styles.sliderEndLabel}>Quality</Text>
                  </View>
                )}
                <View style={styles.sliderInputRow}>
                  <Text style={styles.legendText}>Overlap</Text>
                  <TextInput
                    value={String(generationSettings.overlap)}
                    onChangeText={(v) => {
                      const n = Math.min(95, Math.max(25, parseInt(v) || 80));
                      setGenerationSettings((c) => ({ ...c, overlap: n }));
                    }}
                    keyboardType="numeric"
                    style={styles.overlapInput}
                  />
                  <Text style={styles.legendText}>%</Text>
                </View>

                <EditRow
                  label="Line spacing (m)"
                  value={String(generationSettings.distance)}
                  onChange={(v) => setGenerationSettings((c) => ({ ...c, distance: Number(v) || 25 }))}
                />
                <EditRow
                  label="Altitude (m)"
                  value={String(generationSettings.altitude)}
                  onChange={(v) => setGenerationSettings((c) => ({ ...c, altitude: Number(v) || 60 }))}
                />
                <EditRow
                  label="Speed (m/s)"
                  value={String(generationSettings.speed)}
                  onChange={(v) => setGenerationSettings((c) => ({ ...c, speed: Number(v) || 3.5 }))}
                />

                <Pressable
                  onPress={() => mapRef.current?.generateAll()}
                  disabled={!canGenerate}
                  style={[styles.genBtn, !canGenerate && styles.genBtnDisabled]}
                >
                  <Text style={styles.genBtnText}>
                    {mapState.isGenerating ? "Generating…" : "Generate"}
                  </Text>
                </Pressable>

                {mapState.generationError && (
                  <Text style={styles.errorText}>{mapState.generationError}</Text>
                )}
                {overLimit && (
                  <Text style={styles.warnText}>
                    ⚠️ {mapState.waypointCount} waypoints exceeds the DJI 99-point limit. Reduce line spacing.
                  </Text>
                )}
                <Text style={styles.helpText}>
                  {!mapState.hasShapes && !mapState.hasWaypoints
                    ? "Draw a polygon, rectangle, or circle on the map to unlock generation."
                    : mapState.hasShapes
                    ? "Shapes drawn. Click Generate to create waypoints."
                    : "Generation complete — switch to Download to export."}
                </Text>
              </View>
            )}

            {/* ── ADVANCED TAB ── */}
            {workflowTab === "advanced" && (
              <View style={styles.panelBody}>
                {selectedWaypoint ? (
                  /* ── Per-waypoint editor ── */
                  <>
                    <SectionTitle
                      title={`Waypoint #${selectedWaypoint.id}`}
                      onBack={() => setSelectedWaypoint(null)}
                    />
                    <EditRow
                      label="Latitude"
                      value={String(selectedWaypoint.lat.toFixed(7))}
                    />
                    <EditRow
                      label="Longitude"
                      value={String(selectedWaypoint.lng.toFixed(7))}
                    />
                    <EditRow
                      label="Altitude"
                      suffix={generationSettings.units === "0" ? "m" : "ft"}
                      value={String(selectedWaypoint.altitude)}
                    />
                    <EditRow
                      label="Speed"
                      suffix={generationSettings.units === "0" ? "m/s" : "ft/s"}
                      value={String(selectedWaypoint.speed)}
                    />
                    <EditRow
                      label="Gimbal"
                      suffix="°"
                      value={String(selectedWaypoint.angle)}
                    />
                    <EditRow
                      label="Heading"
                      suffix="°"
                      value={String(selectedWaypoint.heading)}
                    />
                    <Text style={styles.helpText}>
                      Click the waypoint on the map to open the full editor.
                    </Text>
                  </>
                ) : mapState.selectionCount > 1 ? (
                  /* ── Bulk edit ── */
                  <BulkEditPanel
                    count={mapState.selectionCount}
                    units={generationSettings.units}
                    onApply={(fields) => mapRef.current?.bulkEdit(fields)}
                  />
                ) : (
                  /* ── Generation settings ── */
                  <>
                    <SectionTitle title="Basics" />
                    <EditRow
                      label="Altitude"
                      suffix={generationSettings.units === "0" ? "m" : "ft"}
                      value={String(generationSettings.altitude)}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          altitude: Number(v) || 0,
                        }))
                      }
                    />
                    <EditRow
                      label="Speed"
                      suffix={generationSettings.units === "0" ? "m/s" : "ft/s"}
                      value={String(generationSettings.speed)}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          speed: Number(v) || 0,
                        }))
                      }
                    />

                    <SectionTitle title="Coverage" />
                    <EditRow
                      label="Overlap"
                      suffix="%"
                      value={String(generationSettings.overlap)}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          overlap: Math.min(95, Math.max(25, Number(v) || 80)),
                        }))
                      }
                    />
                    <EditRow
                      label="Distance"
                      suffix={generationSettings.units === "0" ? "m" : "ft"}
                      value={String(generationSettings.distance)}
                      onChange={(v) => {
                        const distM = Number(v) || 0;
                        const newOverlap = distanceToOverlap(distM, generationSettings.altitude);
                        skipAutoCalc.current = true;
                        setGenerationSettings((c) => ({ ...c, distance: distM, overlap: newOverlap }));
                        setTimeout(() => { skipAutoCalc.current = false; }, 0);
                      }}
                    />
                    <EditRow
                      label="Interval"
                      suffix="s"
                      value={String(generationSettings.interval)}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          interval: Number(v) || 0,
                        }))
                      }
                    />

                    <SectionTitle title="Camera" />
                    <EditRow
                      label="Gimbal angle"
                      suffix="°"
                      value={String(generationSettings.gimbalAngle)}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          gimbalAngle: Number(v) || 0,
                        }))
                      }
                    />

                    <SectionTitle title="Line" />
                    <ChipGroup
                      label="Line mode"
                      options={[
                        { label: "Preset E-W", value: "preset" },
                        { label: "Preset N-S", value: "presetNS" },
                        { label: "Manual", value: "manual" },
                      ]}
                      value={generationSettings.lineAngleMode}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          lineAngleMode: v as GenerationSettings["lineAngleMode"],
                        }))
                      }
                    />
                    {generationSettings.lineAngleMode === "manual" && (
                      <EditRow
                        label="Angle"
                        suffix="°"
                        value={String(generationSettings.lineAngleDegrees)}
                        onChange={(v) =>
                          setGenerationSettings((c) => ({
                            ...c,
                            lineAngleDegrees: Number(v) || 0,
                          }))
                        }
                      />
                    )}
                    <SwitchRow
                      label="Flip path"
                      value={generationSettings.flipPath}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({ ...c, flipPath: v }))
                      }
                    />

                    <SectionTitle title="Advanced" />
                    <ChipGroup
                      label="Units"
                      options={[
                        { label: "Metric", value: "0" },
                        { label: "Imperial", value: "1" },
                      ]}
                      value={generationSettings.units}
                      onChange={(v) => {
                        const oldUnits = generationSettings.units;
                        if (v !== oldUnits) {
                          const factor = v === "1" ? 3.28084 : 1 / 3.28084;
                          skipAutoCalc.current = true;
                          setGenerationSettings((c) => ({
                            ...c,
                            units: v as GenerationSettings["units"],
                            altitude: parseFloat((c.altitude * factor).toFixed(2)),
                            speed: parseFloat((c.speed * factor).toFixed(2)),
                            distance: parseFloat((c.distance * factor).toFixed(2)),
                          }));
                          setTimeout(() => { skipAutoCalc.current = false; }, 0);
                          mapRef.current?.convertAllUnits(factor);
                        }
                      }}
                    />
                    <ChipGroup
                      label="Turn mode"
                      options={[
                        { label: "Curved", value: "coordinateTurn" },
                        { label: "Pass Through", value: "toPointAndPassWithContinuityCurvature" },
                        { label: "Stop & Turn", value: "toPointAndStopWithDiscontinuityCurvature" },
                      ]}
                      value={generationSettings.turnMode}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({ ...c, turnMode: v }))
                      }
                    />
                    <SwitchRow
                      label="Straighten lines"
                      value={generationSettings.straightenLines}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          straightenLines: v,
                        }))
                      }
                    />
                    <SwitchRow
                      label="Maintain altitude"
                      value={generationSettings.maintainAlt}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          maintainAlt: v,
                        }))
                      }
                    />
                    <SwitchRow
                      label="Generate all points action"
                      value={generationSettings.generateAllPoints}
                      onChange={(v) =>
                        setGenerationSettings((c) => ({
                          ...c,
                          generateAllPoints: v,
                        }))
                      }
                    />
                    {generationSettings.generateAllPoints && (
                      <View style={styles.chipGroup}>
                        <Text style={styles.chipGroupLabel}>All-point action</Text>
                        <View style={styles.chipRow}>
                          {ACTIONS.map((a) => (
                            <Pressable
                              key={a.key}
                              style={[
                                styles.chip,
                                generationSettings.allPointsAction === a.key &&
                                  styles.chipActive,
                              ]}
                              onPress={() =>
                                setGenerationSettings((c) => ({
                                  ...c,
                                  allPointsAction: a.key as GenerationSettings["allPointsAction"],
                                }))
                              }
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  generationSettings.allPointsAction === a.key &&
                                    styles.chipTextActive,
                                ]}
                              >
                                {a.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    )}

                    <Pressable
                      onPress={() => mapRef.current?.generateAll()}
                      disabled={!canGenerate}
                      style={[
                        styles.genBtn,
                        !canGenerate && styles.genBtnDisabled,
                        { marginTop: 16 },
                      ]}
                    >
                      <Text style={styles.genBtnText}>
                        {mapState.isGenerating ? "Generating…" : "Generate"}
                      </Text>
                    </Pressable>

                    {mapState.generationError && (
                      <Text style={styles.errorText}>
                        {mapState.generationError}
                      </Text>
                    )}

                    {/* ── Presets ── */}
                    <SectionTitle title="Presets" />
                    {presets.length > 0 && (
                      <View style={styles.chipRow}>
                        {presets.map((p) => (
                          <View key={p.name} style={presetStyles.row}>
                            <Pressable style={[presetStyles.starBtn, defaultPreset === p.name && presetStyles.starBtnActive]} onPress={() => toggleDefaultPreset(p.name)}>
                              <Text style={presetStyles.starBtnText}>{defaultPreset === p.name ? "★" : "☆"}</Text>
                            </Pressable>
                            <Pressable style={presetStyles.loadBtn} onPress={() => loadPreset(p)}>
                              <Text style={presetStyles.loadBtnText}>{p.name}</Text>
                            </Pressable>
                            <Pressable style={presetStyles.delBtn} onPress={() => deletePreset(p.name)}>
                              <Text style={presetStyles.delBtnText}>✕</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={presetStyles.saveRow}>
                      <TextInput
                        value={presetName}
                        onChangeText={setPresetName}
                        placeholder="Preset name…"
                        placeholderTextColor="#adb5bd"
                        style={presetStyles.nameInput}
                      />
                      <Pressable style={presetStyles.saveBtn} onPress={savePreset}>
                        <Text style={presetStyles.saveBtnText}>Save</Text>
                      </Pressable>
                    </View>

                    {/* ── Keyboard shortcuts ── */}
                    <SectionTitle title="Keyboard Shortcuts" />
                    <KeyboardShortcuts />
                  </>
                )}
              </View>
            )}

            {/* ── DOWNLOAD TAB ── */}
            {workflowTab === "download" && (
              <View style={styles.panelBody}>
                <Text style={styles.sectionLabel}>On completion</Text>
                <View style={styles.chipRow}>
                  {[
                    { label: "Hover", value: 0 },
                    { label: "Return to home", value: 1 },
                  ].map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[
                        styles.chip,
                        finalAction === opt.value && styles.chipActive,
                      ]}
                      onPress={() => setFinalAction(opt.value as FinalAction)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          finalAction === opt.value && styles.chipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.statsRow}>
                  <Text style={styles.statText}>
                    Waypoints: {mapState.waypointCount}
                  </Text>
                  <Text style={styles.statText}>ETA: {mapState.eta}</Text>
                </View>

                <TextInput
                  value={missionName}
                  onChangeText={setMissionName}
                  placeholder="Mission name"
                  placeholderTextColor="#adb5bd"
                  style={styles.missionNameInput}
                />

                {/* Feature 2: Timed shots note */}
                {mapState.timedShotsNote && (
                  <View style={styles.timedShotsNote}>
                    <Text style={styles.timedShotsNoteText}>
                      📷 No waypoint actions set — camera will use timed/interval shooting based on your interval setting.
                    </Text>
                  </View>
                )}

                {/* DJI Auto-Upload (Android) */}
                {Platform.OS === "android" && (
                  <View style={{ gap: 8 }}>
                    <SectionTitle title="DJI Upload" />
                    <SwitchRow
                      label="Auto-save to DJI folder"
                      value={djiSettings.enabled}
                      onChange={(v) => {
                        const next = { ...djiSettings, enabled: v };
                        setDjiSettings(next);
                        saveDjiSettings(next);
                      }}
                    />
                    {djiSettings.enabled && (
                      <>
                        <ChipGroup
                          label="DJI folder"
                          options={getDjiDirPresets()}
                          value={djiSettings.djiDir}
                          onChange={(v) => {
                            const next = { ...djiSettings, djiDir: v };
                            setDjiSettings(next);
                            saveDjiSettings(next);
                          }}
                        />
                        <EditRow
                          label="Custom path"
                          value={djiSettings.djiDir}
                          onChange={(v) => {
                            const next = { ...djiSettings, djiDir: v || getDefaultDjiDir() };
                            setDjiSettings(next);
                            saveDjiSettings(next);
                          }}
                        />
                        <SwitchRow
                          label="Fixed filename (overwrite)"
                          value={djiSettings.fixedFilename !== null}
                          onChange={(v) => {
                            const next = { ...djiSettings, fixedFilename: v ? `${missionName.replace(/\s+/g, "_")}.kmz` : null };
                            setDjiSettings(next);
                            saveDjiSettings(next);
                          }}
                        />
                        {djiSettings.fixedFilename !== null && (
                          <EditRow
                            label="Override filename"
                            value={djiSettings.fixedFilename}
                            onChange={(v) => {
                              const next = { ...djiSettings, fixedFilename: v.endsWith(".kmz") ? v : v + ".kmz" };
                              setDjiSettings(next);
                              saveDjiSettings(next);
                            }}
                          />
                        )}
                        {djiUploadStatus && (
                          <Text style={[styles.helpText, { color: djiUploadStatus.startsWith("Saved") ? "#198754" : "#dc3545" }]}>
                            {djiUploadStatus}
                          </Text>
                        )}
                        <Text style={styles.helpText}>
                          KMZ will be saved to the DJI folder after download. DJI Pilot 2 will auto-detect it on next launch.
                        </Text>
                      </>
                    )}
                  </View>
                )}

                {/* Split into segments (feature I) */}
                <SwitchRow
                  label="Split into segments"
                  value={splitEnabled}
                  onChange={setSplitEnabled}
                />
                {splitEnabled && (
                  <View style={{ gap: 8 }}>
                    <ChipGroup
                      label="Split by"
                      options={[
                        { label: "Battery", value: "battery" },
                        { label: "Waypoints", value: "waypoints" },
                      ]}
                      value={splitMode}
                      onChange={(v) => setSplitMode(v as "battery" | "waypoints")}
                    />
                    {splitMode === "battery" ? (
                      <EditRow
                        label="Battery duration (min)"
                        value={String(batteryMinutes)}
                        onChange={(v) => setBatteryMinutes(Number(v) || 20)}
                      />
                    ) : (
                      <EditRow
                        label="Max waypoints per segment"
                        value={String(maxWaypoints)}
                        onChange={(v) => setMaxWaypoints(Number(v) || 99)}
                      />
                    )}
                    <SwitchRow
                      label="Auto RTH + resume between segments"
                      value={rthResume}
                      onChange={setRthResume}
                    />
                    {rthResume && (
                      <Text style={styles.helpText}>
                        Each segment will end with Return to Home. The next segment starts from the same point — just swap batteries and load the next file.
                      </Text>
                    )}
                    {/* Battery segment preview */}
                    {splitEnabled && mapState.waypointCount > 0 && (
                      <View style={styles.segmentPreview}>
                        <Text style={styles.segmentPreviewText}>
                          {splitMode === "battery"
                            ? `~${Math.max(1, Math.ceil(mapState.etaSeconds / Math.max(1, batteryMinutes * 60)))} segment${Math.ceil(mapState.etaSeconds / Math.max(1, batteryMinutes * 60)) > 1 ? "s" : ""}`
                            : `~${Math.max(1, Math.ceil(mapState.waypointCount / Math.max(1, maxWaypoints)))} segment${Math.ceil(mapState.waypointCount / Math.max(1, maxWaypoints)) > 1 ? "s" : ""}`}
                          {" "}({mapState.waypointCount} waypoints)
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {splitEnabled ? (
                  <Pressable
                    onPress={handleDownloadSplit}
                    disabled={!canDownload}
                    style={[styles.genBtn, !canDownload && styles.genBtnDisabled]}
                  >
                    <Text style={styles.genBtnText}>Download Split ZIP</Text>
                  </Pressable>
                ) : (
                <Pressable
                  onPress={handleDownloadKmz}
                  disabled={!canDownload}
                  style={[
                    styles.genBtn,
                    !canDownload && styles.genBtnDisabled,
                  ]}
                >
                  <Text style={styles.genBtnText}>Download KMZ</Text>
                </Pressable>
                )}

                {overLimit && (
                  <Text style={styles.warnText}>
                    ⚠️ {mapState.waypointCount} waypoints exceeds the DJI 99-point limit. DJI Pilot may reject this mission.
                  </Text>
                )}

                {/* Phone download — QR code + URL */}
                {hasDownloaded && canDownload && (
                  <View style={phoneStyles.card}>
                    <Text style={phoneStyles.title}>Send to your phone</Text>
                    <Text style={phoneStyles.subtitle}>Scan QR or open the URL below</Text>
                    {Platform.OS === "web" ? (
                      <img
                        src={qrImageUrl}
                        alt="QR Code"
                        style={{ width: 160, height: 160, borderRadius: 10, background: "#fff", padding: 8, alignSelf: "center" }}
                      />
                    ) : (
                      <View style={{ width: 160, height: 160, borderRadius: 10, backgroundColor: "#fff", alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 11, color: "#6c757d" }}>QR unavailable</Text>
                      </View>
                    )}
                    <View style={phoneStyles.urlRow}>
                      <Text style={phoneStyles.url} numberOfLines={2}>{phonePageUrl}</Text>
                    </View>
                    <View style={phoneStyles.btnRow}>
                      <Pressable
                        style={phoneStyles.copyBtn}
                        onPress={() => {
                          if (typeof navigator !== "undefined") {
                            navigator.clipboard.writeText(phonePageUrl).catch(() => {});
                          }
                        }}
                      >
                        <Text style={phoneStyles.copyBtnText}>Copy URL</Text>
                      </Pressable>
                    </View>
                    <Text style={phoneStyles.hint}>
                      Replace YOUR_LAPTOP_IP with your computer's IP address on the same WiFi.{Platform.OS === "web" ? "\nFind it: open Terminal, type: ifconfig en0 | grep inet" : ""}
                    </Text>
                  </View>
                )}

                <Text style={styles.helpText}>
                  {canDownload
                    ? "Click Download KMZ to save your mission."
                    : "Generate waypoints first, then download here."}
                </Text>
              </View>
            )}

            {/* ── SAVED MISSIONS TAB ── */}
            {workflowTab === "saved" && (
              <View style={styles.panelBody}>
                {!auth ? (
                  /* ── Login / Register ── */
                  <>
                    <Text style={styles.sectionLabel}>{authMode === "login" ? "Log in" : "Create account"}</Text>
                    <TextInput
                      value={authEmail}
                      onChangeText={setAuthEmail}
                      placeholder="Email"
                      placeholderTextColor="#adb5bd"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      style={styles.missionNameInput}
                    />
                    <TextInput
                      value={authPassword}
                      onChangeText={setAuthPassword}
                      placeholder="Password"
                      placeholderTextColor="#adb5bd"
                      secureTextEntry
                      style={styles.missionNameInput}
                    />
                    {authError && (
                      <Text style={styles.errorText}>{authError}</Text>
                    )}
                    <Pressable
                      onPress={handleAuth}
                      style={[styles.genBtn, { backgroundColor: "#0d6efd" }]}
                    >
                      <Text style={styles.genBtnText}>
                        {authMode === "login" ? "Log in" : "Register"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(null); }}
                    >
                      <Text style={[styles.helpText, { textAlign: "center", color: "#0d6efd" }]}>
                        {authMode === "login" ? "Create an account" : "Already have an account? Log in"}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  /* ── Saved missions ── */
                  <>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={styles.sectionLabel}>My Missions</Text>
                      <Pressable onPress={handleLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ fontSize: 12, color: "#dc3545" }}>Log out</Text>
                      </Pressable>
                    </View>
                    <Text style={[styles.helpText, { fontSize: 12 }]}>Logged in as {auth.email}</Text>

                    {mapState.hasWaypoints && (
                      <Pressable
                        onPress={handleSaveMission}
                        style={styles.genBtn}
                      >
                        <Text style={styles.genBtnText}>Save Current Mission</Text>
                      </Pressable>
                    )}

                    {savedMissionsLoading && (
                      <Text style={styles.helpText}>Loading…</Text>
                    )}

                    {savedMissions.length === 0 && !savedMissionsLoading && (
                      <Text style={styles.helpText}>
                        No saved missions yet. Generate waypoints, then click "Save Current Mission".
                      </Text>
                    )}

                    {savedMissions.map((m) => (
                      <View key={m.id} style={savedStyles.row}>
                        <View style={savedStyles.info}>
                          <Text style={savedStyles.name}>{m.name}</Text>
                          <Text style={savedStyles.meta}>{m.waypointCount} WP · {new Date(m.updatedAt).toLocaleDateString()}</Text>
                        </View>
                        <View style={savedStyles.actions}>
                          <Pressable
                            style={savedStyles.loadBtn}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            onPress={() => handleLoadMission(m.id)}
                          >
                            <Text style={savedStyles.loadBtnText}>Load</Text>
                          </Pressable>
                          <Pressable
                            style={savedStyles.delBtn}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            onPress={() => handleDeleteMission(m.id)}
                          >
                            <Text style={savedStyles.delBtnText}>✕</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}

          </ScrollView>
        </View>
      </View>
      {/* Onboarding tour */}
      {onboardStep > 0 && (
        <OnboardingOverlay
          step={onboardStep as 1 | 2 | 3}
          onNext={onboardNext}
          onSkip={finishOnboard}
        />
      )}
    </View>
  );
}

// ─── Sub-components (P2: wrapped in React.memo) ───────────────────────────────

const ToolbarButton = memo(function ToolbarButton(props: {
  label: string;
  disabled?: boolean;
  subtle?: boolean;
  danger?: boolean;
  primary?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[
        styles.toolBtn,
        props.subtle && styles.toolBtnSubtle,
        props.danger && styles.toolBtnDanger,
        props.primary && styles.toolBtnPrimary,
        props.disabled && styles.toolBtnDisabled,
      ]}
    >
      <Text
        style={[
          styles.toolBtnText,
          props.subtle && styles.toolBtnTextSubtle,
          props.danger && styles.toolBtnTextDanger,
          props.primary && styles.toolBtnTextPrimary,
          props.disabled && styles.toolBtnTextDisabled,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
});

const SectionTitle = memo(function SectionTitle(props: { title: string; onBack?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      {props.onBack && (
        <Pressable
          onPress={props.onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.backBtn}
        >
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
      )}
      <Text style={styles.sectionTitleText}>{props.title}</Text>
    </View>
  );
});

const EditRow = memo(function EditRow(props: {
  label: string;
  value: string;
  suffix?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <View style={styles.editRow}>
      <Text style={styles.editLabel}>{props.label}</Text>
      <View style={styles.editFrame}>
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          editable={Boolean(props.onChange)}
          style={[
            styles.editInput,
            !props.onChange && styles.editInputDisabled,
          ]}
          keyboardType="numeric"
        />
        {props.suffix ? (
          <Text style={styles.editSuffix}>{props.suffix}</Text>
        ) : null}
      </View>
    </View>
  );
});

const ChipGroup = memo(function ChipGroup(props: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.chipGroupLabel}>{props.label}</Text>
      <View style={styles.chipRow}>
        {props.options.map((opt) => (
          <Pressable
            key={opt.value}
            style={[styles.chip, props.value === opt.value && styles.chipActive]}
            onPress={() => props.onChange(opt.value)}
          >
            <Text
              style={[
                styles.chipText,
                props.value === opt.value && styles.chipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const BulkEditPanel = memo(function BulkEditPanel(props: {
  count: number;
  units: string;
  onApply: (fields: { altitude?: number; speed?: number; angle?: number }) => void;
}) {
  const [altitude, setAltitude] = useState("");
  const [speed, setSpeed] = useState("");
  const [angle, setAngle] = useState("");
  const unitLen = props.units === "0" ? "m" : "ft";
  const unitSpd = props.units === "0" ? "m/s" : "ft/s";

  function handleApply() {
    const fields: { altitude?: number; speed?: number; angle?: number } = {};
    if (altitude !== "") fields.altitude = parseFloat(altitude);
    if (speed !== "") fields.speed = parseFloat(speed);
    if (angle !== "") fields.angle = parseFloat(angle);
    if (Object.keys(fields).length) props.onApply(fields);
  }

  return (
    <View style={bulkStyles.panel}>
      <View style={bulkStyles.header}>
        <Text style={bulkStyles.title}>Bulk Edit</Text>
        <Text style={bulkStyles.subtitle}>{props.count} waypoints selected</Text>
      </View>
      <Text style={bulkStyles.hint}>Leave blank to keep existing values.</Text>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>Altitude ({unitLen})</Text>
        <View style={styles.editFrame}>
          <TextInput value={altitude} onChangeText={setAltitude} placeholder="e.g. 80" placeholderTextColor="#adb5bd" keyboardType="numeric" style={styles.editInput} />
        </View>
      </View>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>Speed ({unitSpd})</Text>
        <View style={styles.editFrame}>
          <TextInput value={speed} onChangeText={setSpeed} placeholder="e.g. 5" placeholderTextColor="#adb5bd" keyboardType="numeric" style={styles.editInput} />
        </View>
      </View>
      <View style={styles.editRow}>
        <Text style={styles.editLabel}>Gimbal angle (°)</Text>
        <View style={styles.editFrame}>
          <TextInput value={angle} onChangeText={setAngle} placeholder="e.g. -45" placeholderTextColor="#adb5bd" keyboardType="numeric" style={styles.editInput} />
        </View>
      </View>
      <Pressable onPress={handleApply} style={bulkStyles.applyBtn}>
        <Text style={bulkStyles.applyBtnText}>Apply to {props.count} waypoints</Text>
      </Pressable>
      <Text style={styles.helpText}>Ctrl+click markers to add/remove from selection.</Text>
    </View>
  );
});

const ONBOARD_STEPS = [
  { title: "1. Draw a shape", body: "Use the Polygon, Rectangle, or Circle tools in the top bar to draw a survey area on the map." },
  { title: "2. Generate flight path", body: "Click Generate in the Simple tab to create waypoints from your shape." },
  { title: "3. Download KMZ", body: "Open the Download tab and click Download KMZ to save your DJI mission file." },
];

const OnboardingOverlay = memo(function OnboardingOverlay(props: { step: 1 | 2 | 3; onNext(): void; onSkip(): void }) {
  const s = ONBOARD_STEPS[props.step - 1];
  return (
    <View style={obStyles.mask} pointerEvents="box-none">
      <View style={obStyles.card}>
        <Text style={obStyles.step}>{props.step} / 3</Text>
        <Text style={obStyles.title}>{s.title}</Text>
        <Text style={obStyles.body}>{s.body}</Text>
        <View style={obStyles.actions}>
          <Pressable style={obStyles.skipBtn} onPress={props.onSkip}>
            <Text style={obStyles.skipText}>Skip</Text>
          </Pressable>
          <Pressable style={obStyles.nextBtn} onPress={props.onNext}>
            <Text style={obStyles.nextText}>{props.step < 3 ? "Next →" : "Got it!"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const obStyles = StyleSheet.create({
  mask: { position: "absolute", bottom: 60, left: 0, right: 0, alignItems: "center", zIndex: 200 },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 20, maxWidth: 360, width: "90%", shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  step: { fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: "600", textTransform: "uppercase" },
  title: { fontSize: 17, fontWeight: "700", color: "#f1f5f9", marginBottom: 8 },
  body: { fontSize: 13, color: "#cbd5e1", lineHeight: 20, marginBottom: 16 },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  skipText: { color: "#64748b", fontSize: 13 },
  nextBtn: { backgroundColor: "#0d6efd", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 18 },
  nextText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});

const SHORTCUTS = [
  { keys: "Ctrl+Z / ⌘Z", desc: "Undo" },
  { keys: "Ctrl+Y / ⌘⇧Z", desc: "Redo" },
  { keys: "Ctrl+A", desc: "Select all waypoints" },
  { keys: "Ctrl+C", desc: "Copy selection" },
  { keys: "Ctrl+V", desc: "Paste (offset +15m)" },
  { keys: "Del / Backspace", desc: "Delete selected" },
  { keys: "Ctrl+drag", desc: "Group drag selection" },
  { keys: "Ctrl+click", desc: "Add / remove from selection" },
  { keys: "Esc", desc: "Cancel draw / clear selection" },
  { keys: "Dbl-click", desc: "Finish polygon" },
  { keys: "Ctrl+H", desc: "Heading transform mode" },
  { keys: "Ctrl+R", desc: "Rotate selection" },
  { keys: "Ctrl+S", desc: "Scale selection" },
];

const KeyboardShortcuts = memo(function KeyboardShortcuts() {
  return (
    <View style={kbStyles.table}>
      {SHORTCUTS.map((s) => (
        <View key={s.keys} style={kbStyles.row}>
          <Text style={kbStyles.keys}>{s.keys}</Text>
          <Text style={kbStyles.desc}>{s.desc}</Text>
        </View>
      ))}
    </View>
  );
});

const kbStyles = StyleSheet.create({
  table: { gap: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  keys: { fontSize: 11, color: "#0d6efd", fontFamily: "Courier", fontWeight: "600", flex: 1 },
  desc: { fontSize: 12, color: "#495057", flex: 1, textAlign: "right" },
});

const presetStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  starBtn: { padding: 4, borderRadius: 4, borderWidth: 1, borderColor: "#dee2e6" },
  starBtnActive: { borderColor: "#ffc107", backgroundColor: "#fff3cd" },
  starBtnText: { fontSize: 14, color: "#adb5bd" },
  loadBtn: { flex: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#0d6efd", backgroundColor: "#f0f7ff" },
  loadBtnText: { fontSize: 12, color: "#0d6efd", fontWeight: "600" },
  delBtn: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: "#dee2e6" },
  delBtnText: { fontSize: 11, color: "#dc3545" },
  saveRow: { flexDirection: "row", gap: 8 },
  nameInput: { flex: 1, height: 36, borderRadius: 6, borderWidth: 1, borderColor: "#dee2e6", paddingHorizontal: 10, fontSize: 13, color: "#212529" },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: "#0d6efd", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});

const bulkStyles = StyleSheet.create({
  panel: { gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { fontSize: 15, fontWeight: "700", color: "#212529" },
  subtitle: { fontSize: 12, color: "#0d6efd", fontWeight: "600" },
  hint: { fontSize: 12, color: "#6c757d" },
  applyBtn: { height: 42, borderRadius: 6, backgroundColor: "#0d6efd", alignItems: "center", justifyContent: "center" },
  applyBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});

const SwitchRow = memo(function SwitchRow(props: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.editLabel}>{props.label}</Text>
      <Switch value={props.value} onValueChange={props.onChange} />
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },

  // Feature 1: stale settings banner
  staleBanner: {
    backgroundColor: "#fff3cd",
    borderBottomWidth: 1,
    borderBottomColor: "#ffc107",
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  staleBannerText: {
    flex: 1,
    fontSize: 13,
    color: "#856404",
  },
  staleBannerBtn: {
    backgroundColor: "#ffc107",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  staleBannerBtnText: {
    color: "#212529",
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Top bar ──
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    flexWrap: "wrap",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: {
    height: 38,
    width: 220,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ced4da",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#212529",
    backgroundColor: "#fff",
  },
  drawTools: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    flex: 1,
  },
  drawBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dee2e6",
    backgroundColor: "#fff",
  },
  drawBtnActive: {
    backgroundColor: "#0d6efd",
    borderColor: "#0d6efd",
  },
  drawBtnIcon: {
    fontSize: 15,
    color: "#495057",
  },
  drawBtnIconActive: {
    color: "#fff",
  },
  drawBtnLabel: {
    fontSize: 12,
    color: "#495057",
    fontWeight: "600",
  },
  drawBtnLabelActive: {
    color: "#fff",
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dc3545",
    backgroundColor: "#fff",
  },
  cancelBtnText: {
    color: "#dc3545",
    fontSize: 12,
    fontWeight: "600",
  },
  topActions: {
    flexDirection: "row",
    gap: 6,
  },
  toolBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#adb5bd",
  },
  toolBtnSubtle: { borderColor: "#adb5bd" },
  toolBtnDanger: { borderColor: "#dc3545" },
  toolBtnPrimary: { borderColor: "#0d6efd", backgroundColor: "#0d6efd" },
  toolBtnDisabled: { borderColor: "#dee2e6", opacity: 0.5 },
  toolBtnText: { fontSize: 13, color: "#495057" },
  toolBtnTextSubtle: { color: "#6c757d" },
  toolBtnTextDanger: { color: "#dc3545" },
  toolBtnTextPrimary: { color: "#fff" },
  toolBtnTextDisabled: { color: "#adb5bd" },

  // ── Content ──
  contentRow: {
    flex: 1,
    flexDirection: "row",
  },
  mapArea: {
    flex: 1,
    position: "relative",
  },

  // ── No API key overlay ──
  noKeyOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    padding: 32,
  },
  noKeyTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  noKeyBody: {
    color: "#adb5bd",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  noKeyCode: {
    color: "#81c784",
    fontFamily: "Courier",
  },

  // ── Overlays on map ──
  etaBadge: {
    position: "absolute",
    bottom: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  etaBadgeWarn: {
    backgroundColor: "rgba(220,53,69,0.85)",
  },
  etaText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },

  // Feature 4: cursor coordinates overlay
  cursorCoords: {
    position: "absolute",
    bottom: 44,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cursorCoordsText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Courier",
  },

  // Start/End legend
  seLegend: {
    position: "absolute",
    bottom: 76,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  seLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  seLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  seLegendText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },

  cadenceWarn: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    backgroundColor: "rgba(230,126,34,0.92)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    zIndex: 10,
  },
  cadenceWarnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "500",
  },
  drawHint: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 60,
    backgroundColor: "rgba(13,110,253,0.85)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  drawHintText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "500",
  },

  // Feature 3 & 6: transform panel overlay
  transformPanel: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: [{ translateX: -120 }],
    width: 240,
    backgroundColor: "rgba(30,41,59,0.95)",
    borderRadius: 10,
    padding: 12,
    zIndex: 20,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  transformPanelTitle: {
    color: "#f1f5f9",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "center",
  },
  transformPanelHint: {
    color: "#94a3b8",
    fontSize: 11,
    marginBottom: 8,
    textAlign: "center",
  },
  transformPanelRow: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  transformBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#475569",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  transformBtnCommit: {
    backgroundColor: "#0d6efd",
    borderColor: "#0d6efd",
  },
  transformBtnText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "600",
  },

  // ── Side panel ──
  sidePanel: {
    width: 320,
    backgroundColor: "#ffffff",
    borderLeftWidth: 1,
    borderLeftColor: "#e9ecef",
    flexDirection: "column",
  },
  // Overlay chips
  overlayChipsBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    flexWrap: "wrap",
  },
  overlayChipsLabel: {
    fontSize: 11,
    color: "#6c757d",
    fontWeight: "600",
  },
  overlayChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#198754",
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  overlayChipText: {
    fontSize: 11,
    color: "#198754",
    fontWeight: "500",
  },
  overlayChipDel: {
    fontSize: 10,
    color: "#dc3545",
    fontWeight: "700",
  },
  overlayClearText: {
    fontSize: 11,
    color: "#dc3545",
    fontWeight: "600",
  },
  tabsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dee2e6",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#0d6efd",
  },
  tabText: {
    fontSize: 13,
    color: "#6c757d",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#0d6efd",
  },
  panelScroll: {
    flex: 1,
  },
  panelBody: {
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 12,
    color: "#6c757d",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: "600",
  },

  // ── Slider (simple tab) ──
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sliderEndLabel: {
    fontSize: 11,
    color: "#9aa1a8",
    width: 40,
  },
  sliderTrack: {
    flex: 1,
    height: 6,
    backgroundColor: "#e9ecef",
    borderRadius: 999,
    position: "relative",
  },
  sliderFill: {
    height: "100%",
    backgroundColor: "#0d6efd",
    borderRadius: 999,
    opacity: 0.4,
  },
  sliderThumb: {
    position: "absolute",
    top: -7,
    marginLeft: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#0d6efd",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sliderInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  overlapInput: {
    width: 52,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dee2e6",
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: "center",
    color: "#212529",
  },

  // ── Generate button ──
  genBtn: {
    height: 42,
    borderRadius: 6,
    backgroundColor: "#28a745",
    alignItems: "center",
    justifyContent: "center",
  },
  genBtnDisabled: {
    backgroundColor: "#a8d5b5",
  },
  genBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Section title ──
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
    paddingBottom: 2,
  },
  sectionTitleText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#212529",
  },
  backBtn: {
    paddingHorizontal: 4,
  },
  backBtnText: {
    fontSize: 20,
    color: "#0d6efd",
    lineHeight: 22,
  },

  // ── Edit row ──
  editRow: {
    gap: 4,
  },
  editLabel: {
    fontSize: 12,
    color: "#6c757d",
  },
  editFrame: {
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dee2e6",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editInput: {
    flex: 1,
    fontSize: 14,
    color: "#212529",
    paddingVertical: 0,
  },
  editInputDisabled: {
    color: "#6c757d",
  },
  editSuffix: {
    fontSize: 12,
    color: "#adb5bd",
  },

  // ── Chip group ──
  chipGroup: {
    gap: 6,
  },
  chipGroupLabel: {
    fontSize: 12,
    color: "#6c757d",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#dee2e6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: "#0d6efd",
    borderColor: "#0d6efd",
  },
  chipText: {
    fontSize: 12,
    color: "#495057",
    fontWeight: "500",
  },
  chipTextActive: {
    color: "#ffffff",
  },

  // ── Switch row ──
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },

  // ── Download tab ──
  statsRow: {
    flexDirection: "row",
    gap: 16,
  },
  statText: {
    fontSize: 13,
    color: "#495057",
  },
  missionNameInput: {
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#dee2e6",
    paddingHorizontal: 10,
    fontSize: 14,
    color: "#212529",
  },
  segmentPreview: {
    backgroundColor: "#e8f4fd",
    borderRadius: 6,
    padding: 8,
  },
  segmentPreviewText: {
    fontSize: 12,
    color: "#1a5276",
    fontWeight: "600",
  },

  // Feature 2: timed shots note
  timedShotsNote: {
    backgroundColor: "#e8f4fd",
    borderRadius: 6,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#0d6efd",
  },
  timedShotsNoteText: {
    fontSize: 12,
    color: "#1a5276",
    lineHeight: 18,
  },

  // ── Text ──
  legendText: {
    fontSize: 13,
    color: "#6c757d",
  },
  helpText: {
    fontSize: 13,
    color: "#adb5bd",
    lineHeight: 20,
  },
  errorText: {
    fontSize: 12,
    color: "#dc3545",
  },
  warnText: {
    fontSize: 12,
    color: "#e67e22",
    lineHeight: 18,
  },
});

const weatherStyles = StyleSheet.create({
  panel: { gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e9ecef" },
  banner: { borderRadius: 6, padding: 10, borderLeftWidth: 3, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: "700" },
  bannerMeta: { fontSize: 11, color: "#6c757d" },
  sectionLabel: { fontSize: 11, color: "#6c757d", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { borderRadius: 6, borderWidth: 1, borderColor: "#dee2e6", paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11, color: "#495057" },
  compass: { alignItems: "center", gap: 4 },
  compassRing: { width: 110, height: 110, borderRadius: 55, borderWidth: 1.5, borderColor: "#dee2e6", alignItems: "center", justifyContent: "center", position: "relative" },
  compassDir: { position: "absolute", fontSize: 9, color: "#adb5bd", fontWeight: "600" },
  compassArrow: { position: "absolute" },
  compassArrowText: { fontSize: 18, color: "#0d6efd" },
  compassLabel: { fontSize: 12, fontWeight: "700", color: "#212529", marginTop: 4 },
  xwindBox: { borderRadius: 6, borderLeftWidth: 3, padding: 8, backgroundColor: "#f8f9fa", gap: 6 },
  xwindRow: { flexDirection: "row", gap: 8 },
  xwindCol: { flex: 1, alignItems: "center" },
  xwindVal: { fontSize: 16, fontWeight: "700", color: "#212529" },
  xwindUnit: { fontSize: 10, color: "#6c757d" },
  xwindWarn: { fontSize: 11, fontWeight: "600" },
  forecastRow: { flexDirection: "row", gap: 6 },
  forecastItem: { flex: 1, alignItems: "center", borderTopWidth: 2, borderTopColor: "#198754", paddingTop: 4, gap: 2 },
  forecastTime: { fontSize: 10, color: "#6c757d" },
  forecastSpeed: { fontSize: 13, fontWeight: "700" },
  forecastDir: { fontSize: 9, color: "#adb5bd" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fetchBtn: { paddingVertical: 10, alignItems: "center", borderRadius: 6, borderWidth: 1, borderColor: "#0d6efd", marginHorizontal: 16 },
  fetchText: { fontSize: 13, color: "#0d6efd", fontWeight: "600" },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 4, borderWidth: 1, borderColor: "#0d6efd" },
  refreshText: { fontSize: 11, color: "#0d6efd", fontWeight: "600" },
  timestamp: { fontSize: 10, color: "#adb5bd" },
});

const phoneStyles = StyleSheet.create({
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, gap: 10, marginTop: 4 },
  title: { fontSize: 15, fontWeight: "700", color: "#f1f5f9", textAlign: "center" },
  subtitle: { fontSize: 12, color: "#94a3b8", textAlign: "center", marginBottom: 4 },
  urlRow: { backgroundColor: "#0f172a", borderRadius: 8, padding: 10 },
  url: { fontSize: 11, color: "#64748b", textAlign: "center", fontFamily: "Courier" },
  btnRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  copyBtn: { backgroundColor: "#3b82f6", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  copyBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  hint: { fontSize: 11, color: "#475569", textAlign: "center", lineHeight: 16 },
});

const savedStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  info: { flex: 1 },
  name: { fontSize: 13, fontWeight: "600", color: "#212529" },
  meta: { fontSize: 11, color: "#6c757d", marginTop: 2 },
  actions: { flexDirection: "row", gap: 6 },
  loadBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: "#0d6efd" },
  loadBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  delBtn: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: "#dee2e6" },
  delBtnText: { fontSize: 11, color: "#dc3545" },
});
