import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";
import { Platform, StyleSheet, View } from "react-native";

import type { GenerationSettings } from "../services/generator";
import { windBarbPath } from "../services/weather";

// ─── Public types ────────────────────────────────────────────────────────────

export type DrawMode = "polygon" | "rectangle" | "circle" | "marker" | "select" | null;

export type WaypointData = {
  id: number;
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

export type MapEditorState = {
  canUndo: boolean;
  canRedo: boolean;
  hasShapes: boolean;
  hasWaypoints: boolean;
  waypointCount: number;
  selectionCount: number;
  eta: string;
  etaSeconds: number;
  isGenerating: boolean;
  generationError: string | null;
  photoCadenceWarning: boolean;
  overlayCount: number;
  overlays: Array<{ id: number; name: string; type: string }>;
  // Feature 1: stale settings banner
  isSettingStale: boolean;
  // Feature 2: timed shots note
  timedShotsNote: boolean;
  // Feature 3: heading transform
  headingTransformAngle: number | null;
  // Feature 6: geo transform
  geoTransformMode: "rotate" | "scale" | null;
};

export type MapEditorHandle = {
  undo(): void;
  redo(): void;
  reset(): void;
  setDrawMode(mode: DrawMode): void;
  generateAll(): void;
  getWaypoints(): WaypointData[];
  search(query: string): void;
  importWaypoints(wps: WaypointData[]): void;
  bulkEdit(fields: Partial<Pick<WaypointData, "altitude" | "speed" | "angle">>): void;
  getSelectionCount(): number;
  selectAll(): void;
  copySelection(): void;
  paste(): void;
  addKmlOverlay(overlay: { type: string; path: Array<{ lat: number; lng: number }>; name: string }): void;
  clearOverlays(): void;
  removeOverlay(id: number): void;
  convertAllUnits(factor: number): void;
  // Feature 3: heading transform
  rotateHeadings(deltaDeg: number): void;
  setHeadingAngle(deg: number): void;
  // Feature 6: geo transform
  beginRotate(): void;
  beginScale(): void;
  setWindOverlay(speed: number, direction: number, level: "ok" | "caution" | "danger"): void;
  clearWindOverlay(): void;
  setWindBarbGrid(report: { lat: number; lng: number; speed: number; direction: number; gusts: number; level: "ok" | "caution" | "danger" }): void;
  setFlightPathCrosswind(segments: Array<{ risk: "ok" | "caution" | "danger" }>): void;
};

type Props = {
  apiKey: string;
  apiBaseUrl?: string;
  generationSettings: GenerationSettings;
  onStateChange(state: MapEditorState): void;
  onSelectedWaypointChange(wp: WaypointData | null): void;
  onWaypointUpdated(wp: WaypointData): void;
  // Feature 4: cursor coordinates (lightweight, bypasses publishState)
  onCursorMove?(ll: { lat: number; lng: number } | null): void;
};

// ─── Helpers (outside component to avoid closure issues) ─────────────────────

const M2FT = 3.28084;
const IS_MOBILE = Platform.OS !== "web";
const CURVED_PATH_STEP = IS_MOBILE ? 0.25 : 0.125; // fewer points on mobile
const DEBOUNCE_MS = IS_MOBILE ? 250 : 150; // longer debounce on slower devices
const ARROW_REPEAT = IS_MOBILE ? "120px" : "80px"; // sparser arrows on mobile

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const y = Math.sin(toRad(b.lng) - toRad(a.lng)) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(toRad(b.lng) - toRad(a.lng));
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const MapEditorCanvas = forwardRef<MapEditorHandle, Props>(
  function MapEditorCanvas(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    // Keep latest props accessible inside the Google Maps closure without re-running the effect
    const propsRef = useRef(props);
    propsRef.current = props;

    // All map state lives here — never triggers React re-renders
    const stateRef = useRef<{
      map: google.maps.Map | null;
      infoWindow: google.maps.InfoWindow | null;
      polygons: google.maps.Polygon[];
      circles: google.maps.Circle[];
      rectangles: google.maps.Rectangle[];
      flags: WaypointMarker[];
      flagCount: number;
      lines: google.maps.Polyline[];
      curvedLines: google.maps.Polyline[];
      undoStack: Array<{ undo(): void; redo(): void }>;
      redoStack: Array<{ undo(): void; redo(): void }>;
      selection: Set<WaypointMarker>;
      ctrlDown: boolean;
      drawMode: DrawMode;
      isDragging: boolean;
      startLatLng: google.maps.LatLng | null;
      tmpLine: google.maps.Polyline | null;
      tmpRect: google.maps.Rectangle | null;
      tmpCirc: google.maps.Circle | null;
      selectedShape: google.maps.MVCObject | null;
      activeIWMarker: WaypointMarker | null;
      unitMode: number;
      isGenerating: boolean;
      userMarker: google.maps.Marker | null;
      clipboard: WaypointData[] | null;
      groupDrag: {
        ref: WaypointMarker;
        anchor: { lat: number; lng: number };
        originals: Array<{ m: WaypointMarker; lat: number; lng: number }>;
      } | null;
      lastMouseLatLng: google.maps.LatLng | null;
      overlays: Array<{ id: number; shape: google.maps.Polygon | google.maps.Polyline; name: string }>;
      overlayCounter: number;
      selectRect: google.maps.Rectangle | null;
      startEndDecorations: google.maps.Circle[];
      windArrow: google.maps.Marker | null;
      windBarbs: google.maps.Marker[];
      crosswindPolylines: google.maps.Polyline[];
      // Feature 1: stale settings
      lastGenerateSig: string | null;
      // Feature 3: heading transform
      headingTransform: {
        active: boolean;
        originals: WaypointData[];
        angle: number;
      } | null;
      // Feature 6: geo transform
      geoTransform: {
        mode: "rotate" | "scale";
        center: { lat: number; lng: number; cosPhi: number };
        originals: WaypointData[];
        localXY: Array<{ x: number; y: number }>;
        angle: number;
        scale: number;
      } | null;
      // P1: deferred publish timer
      _publishTimer: ReturnType<typeof setTimeout> | null;
    }>({
      map: null,
      infoWindow: null,
      polygons: [],
      circles: [],
      rectangles: [],
      flags: [],
      flagCount: 1,
      lines: [],
      curvedLines: [],
      undoStack: [],
      redoStack: [],
      selection: new Set(),
      ctrlDown: false,
      drawMode: null,
      isDragging: false,
      startLatLng: null,
      tmpLine: null,
      tmpRect: null,
      tmpCirc: null,
      selectedShape: null,
      activeIWMarker: null,
      unitMode: 0,
      isGenerating: false,
      userMarker: null,
      clipboard: null,
      groupDrag: null,
      lastMouseLatLng: null,
      overlays: [],
      overlayCounter: 0,
      selectRect: null,
      startEndDecorations: [],
      windArrow: null,
      windBarbs: [],
      crosswindPolylines: [],
      lastGenerateSig: null,
      headingTransform: null,
      geoTransform: null,
      _publishTimer: null,
    });

    // Imperative ref — parent calls these
    useImperativeHandle(ref, () => ({
      undo() { historyUndo(); },
      redo() { historyRedo(); },
      reset() { doReset(); },
      setDrawMode(mode: DrawMode) { setDrawModeInternal(mode); },
      generateAll() { generateAllShapes(); },
      getWaypoints() { return stateRef.current.flags.map(markerToData); },
      search(query: string) { flyToQuery(query); },
      importWaypoints(wps: WaypointData[]) { doImportWaypoints(wps); },
      bulkEdit(fields) { doBulkEdit(fields); },
      getSelectionCount() { return stateRef.current.selection.size; },
      selectAll() { doSelectAll(); },
      copySelection() { doCopy(); },
      paste() { doPaste(); },
      addKmlOverlay(overlay) { doAddKmlOverlay(overlay); },
      clearOverlays() { doClearOverlays(); },
      removeOverlay(id: number) { doRemoveOverlay(id); },
      convertAllUnits(factor: number) { doConvertAllUnits(factor); },
      rotateHeadings(deltaDeg: number) { doRotateHeadings(deltaDeg); },
      setHeadingAngle(deg: number) { doSetHeadingAngle(deg); },
      beginRotate() { beginGeoTransform("rotate"); },
      beginScale() { beginGeoTransform("scale"); },
      setWindOverlay(speed, direction, level) { doSetWindOverlay(speed, direction, level); },
      clearWindOverlay() { doClearWindOverlay(); },
      setWindBarbGrid(report) { doSetWindBarbGrid(report); },
      setFlightPathCrosswind(segments) { doSetFlightPathCrosswind(segments); },
    }));

    // ── Helpers: generate signature (Feature 1) ─────────────────────────────
    function getGenerateSig(settings: GenerationSettings): string {
      return JSON.stringify({
        altitude: settings.altitude,
        speed: settings.speed,
        gimbalAngle: settings.gimbalAngle,
        distance: settings.distance,
        overlap: settings.overlap,
        lineAngleMode: settings.lineAngleMode,
        lineAngleDegrees: settings.lineAngleDegrees,
        flipPath: settings.flipPath,
        straightenLines: settings.straightenLines,
        generateAllPoints: settings.generateAllPoints,
        allPointsAction: settings.allPointsAction,
        turnMode: settings.turnMode,
      });
    }

    // ── Geo-transform helpers (Feature 6) ───────────────────────────────────
    function latLngToLocal(
      ll: { lat: number; lng: number },
      center: { lat: number; lng: number; cosPhi: number }
    ): { x: number; y: number } {
      return {
        x: (ll.lng - center.lng) * 111320 * center.cosPhi,
        y: (ll.lat - center.lat) * 111320,
      };
    }

    function localToLatLng(
      xy: { x: number; y: number },
      center: { lat: number; lng: number; cosPhi: number }
    ): { lat: number; lng: number } {
      return {
        lat: center.lat + xy.y / 111320,
        lng: center.lng + xy.x / (111320 * center.cosPhi),
      };
    }

    function beginGeoTransform(mode: "rotate" | "scale") {
      const s = stateRef.current;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      if (!targets.length) return;
      // Compute centroid
      const sumLat = targets.reduce((a, m) => a + m.lat, 0) / targets.length;
      const sumLng = targets.reduce((a, m) => a + m.lng, 0) / targets.length;
      const cosPhi = Math.cos((sumLat * Math.PI) / 180);
      const center = { lat: sumLat, lng: sumLng, cosPhi };
      const originals = targets.map(markerToData);
      const localXY = originals.map((wp) => latLngToLocal(wp, center));
      s.geoTransform = { mode, center, originals, localXY, angle: 0, scale: 1 };
      publishStateNow();
    }

    function applyGeoTransform() {
      const s = stateRef.current;
      if (!s.geoTransform) return;
      const { mode, center, originals, localXY, angle, scale } = s.geoTransform;
      const cosA = Math.cos((angle * Math.PI) / 180);
      const sinA = Math.sin((angle * Math.PI) / 180);
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      originals.forEach((orig, i) => {
        const xy = localXY[i];
        let nx = xy.x, ny = xy.y;
        if (mode === "rotate") {
          nx = xy.x * cosA - xy.y * sinA;
          ny = xy.x * sinA + xy.y * cosA;
        } else {
          nx = xy.x * scale;
          ny = xy.y * scale;
        }
        const newLL = localToLatLng({ x: nx, y: ny }, center);
        const marker = targets.find((m) => m.wmId === orig.id);
        if (marker) {
          marker.lat = newLL.lat;
          marker.lng = newLL.lng;
          marker.setPosition({ lat: newLL.lat, lng: newLL.lng });
        }
      });
      redrawFlightPath();
    }

    function commitGeoTransform() {
      const s = stateRef.current;
      if (!s.geoTransform) return;
      const befores = s.geoTransform.originals;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      const afters = targets.map((m) => markerToData(m));
      const capturedTargets = [...targets];
      historyRecord({
        undo: () => capturedTargets.forEach((m, i) => applyMarkerSnapshot(m, befores[i])),
        redo: () => capturedTargets.forEach((m, i) => applyMarkerSnapshot(m, afters[i])),
      });
      s.geoTransform = null;
      publishStateNow();
    }

    function cancelGeoTransform() {
      const s = stateRef.current;
      if (!s.geoTransform) return;
      const befores = s.geoTransform.originals;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      befores.forEach((orig, i) => {
        const marker = targets.find((m) => m.wmId === orig.id);
        if (marker) applyMarkerSnapshot(marker, orig);
      });
      s.geoTransform = null;
      redrawFlightPath();
      publishStateNow();
    }

    // ── Heading transform helpers (Feature 3) ──────────────────────────────
    function beginHeadingTransform() {
      const s = stateRef.current;
      if (s.headingTransform?.active) return;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      if (!targets.length) return;
      s.headingTransform = {
        active: true,
        originals: targets.map(markerToData),
        angle: 0,
      };
      publishStateNow();
    }

    function doRotateHeadings(deltaDeg: number) {
      const s = stateRef.current;
      if (!s.headingTransform) {
        beginHeadingTransform();
        if (!s.headingTransform) return;
      }
      s.headingTransform.angle = (s.headingTransform.angle + deltaDeg + 360) % 360;
      const currentAngle = s.headingTransform.angle;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      s.headingTransform.originals.forEach((orig) => {
        const marker = targets.find((m) => m.wmId === orig.id);
        if (marker) {
          const newHeading = ((orig.heading + currentAngle) % 360 + 360) % 360;
          marker.heading = newHeading;
          refreshMarkerAppearance(marker);
        }
      });
      publishStateNow();
    }

    function doSetHeadingAngle(deg: number) {
      const s = stateRef.current;
      if (!s.headingTransform) {
        beginHeadingTransform();
        if (!s.headingTransform) return;
      }
      const delta = deg - s.headingTransform.angle;
      doRotateHeadings(delta);
    }

    function commitHeadingTransform() {
      const s = stateRef.current;
      if (!s.headingTransform) return;
      const befores = s.headingTransform.originals;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      const afters = targets.map((m) => markerToData(m));
      const capturedTargets = [...targets];
      historyRecord({
        undo: () => capturedTargets.forEach((m, i) => applyMarkerSnapshot(m, befores[i])),
        redo: () => capturedTargets.forEach((m, i) => applyMarkerSnapshot(m, afters[i])),
      });
      s.headingTransform = null;
      publishStateNow();
    }

    function cancelHeadingTransform() {
      const s = stateRef.current;
      if (!s.headingTransform) return;
      const befores = s.headingTransform.originals;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      befores.forEach((orig) => {
        const marker = targets.find((m) => m.wmId === orig.id);
        if (marker) applyMarkerSnapshot(marker, orig);
      });
      s.headingTransform = null;
      publishStateNow();
    }

    // ── Publish state to React ──────────────────────────────────────────────
    function publishStateNow(extra?: Partial<MapEditorState>) {
      const s = stateRef.current;
      const flags = s.flags;
      const hasShapes =
        s.polygons.length + s.circles.length + s.rectangles.length > 0;

      let etaSec = 0;
      const sorted = [...flags].sort((a, b) => a.wmId - b.wmId);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        const dist = haversineM(
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng }
        );
        const spd =
          s.unitMode
            ? ((a.speed + b.speed) / 2) / M2FT
            : (a.speed + b.speed) / 2;
        if (spd > 0) etaSec += dist / spd;
      }
      etaSec += flags.length * 0.8;

      // Photo cadence warning: consecutive takePhoto waypoints < 5s apart
      let photoCadenceWarning = false;
      const sortedForCadence = [...flags].sort((a, b) => a.wmId - b.wmId);
      for (let i = 1; i < sortedForCadence.length; i++) {
        const a = sortedForCadence[i - 1];
        const b = sortedForCadence[i];
        if (a.action === "takePhoto" && b.action === "takePhoto") {
          const d = haversineM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
          const avgSpd = s.unitMode ? ((a.speed + b.speed) / 2) / M2FT : (a.speed + b.speed) / 2;
          if (avgSpd > 0 && d / avgSpd < 5) { photoCadenceWarning = true; break; }
        }
      }

      // Feature 1: stale settings detection
      const currentSig = getGenerateSig(propsRef.current.generationSettings);
      const isSettingStale = s.lastGenerateSig !== null && currentSig !== s.lastGenerateSig;

      // Feature 2: timed shots note — all flags have noAction
      const timedShotsNote =
        flags.length > 0 && flags.every((m) => m.action === "noAction");

      // Feature 3: heading transform angle
      const headingTransformAngle = s.headingTransform?.active
        ? s.headingTransform.angle
        : null;

      // Feature 6: geo transform mode
      const geoTransformMode = s.geoTransform?.mode ?? null;

      propsRef.current.onStateChange({
        canUndo: s.undoStack.length > 0,
        canRedo: s.redoStack.length > 0,
        hasShapes,
        hasWaypoints: flags.length > 0,
        waypointCount: flags.length,
        selectionCount: s.selection.size,
        eta: fmtTime(etaSec),
        etaSeconds: etaSec,
        isGenerating: s.isGenerating,
        generationError: null,
        photoCadenceWarning,
        overlayCount: s.overlays.length,
        overlays: s.overlays.map((o) => ({ id: o.id, name: o.name, type: o.shape instanceof google.maps.Polygon ? "polygon" : "polyline" })),
        isSettingStale,
        timedShotsNote,
        headingTransformAngle,
        geoTransformMode,
        ...extra,
      });
    }

    // P1: deferred publish (150ms debounce for expensive paths)
    function publishStateDeferred(extra?: Partial<MapEditorState>) {
      const s = stateRef.current;
      if (s._publishTimer !== null) {
        clearTimeout(s._publishTimer);
      }
      s._publishTimer = setTimeout(() => {
        s._publishTimer = null;
        publishStateNow(extra);
      }, DEBOUNCE_MS);
    }

    // Legacy alias kept for all call sites that were previously "publishState"
    function publishState(extra?: Partial<MapEditorState>) {
      publishStateNow(extra);
    }

    // ── History ─────────────────────────────────────────────────────────────
    function historyRecord(action: { undo(): void; redo(): void }) {
      stateRef.current.undoStack.push(action);
      stateRef.current.redoStack = [];
      publishState();
    }

    function historyUndo() {
      const action = stateRef.current.undoStack.pop();
      if (!action) return;
      action.undo();
      stateRef.current.redoStack.push(action);
      publishState();
    }

    function historyRedo() {
      const action = stateRef.current.redoStack.pop();
      if (!action) return;
      action.redo();
      stateRef.current.undoStack.push(action);
      publishState();
    }

    // ── Google Maps loader ───────────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;
      loadGoogleMaps(propsRef.current.apiKey, () => {
        if (containerRef.current) {
          bootMap(containerRef.current);
        }
      });
      return () => {
        // Cleanup listeners on unmount
        stateRef.current.flags.forEach((m) => {
          google.maps.event.clearInstanceListeners(m);
        });
        if (stateRef.current.map) {
          google.maps.event.clearInstanceListeners(stateRef.current.map);
        }
        // P10: remove dangling context menus
        document.querySelectorAll(".wm-ctx-menu").forEach((el) => el.remove());
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Feature 1: watch generationSettings changes and re-publish so isSettingStale updates
    useEffect(() => {
      publishStateNow();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.generationSettings]);

    // ── Map boot ─────────────────────────────────────────────────────────────
    function bootMap(container: HTMLDivElement) {
      const map = new google.maps.Map(container, {
        center: { lat: 0, lng: 0 },
        zoom: 2,
        mapTypeId: google.maps.MapTypeId.HYBRID,
        tilt: 0,
        gestureHandling: "cooperative",
        scrollwheel: true,
        clickableIcons: false,
        fullscreenControl: false,
        streetViewControl: false,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.BOTTOM_LEFT,
        },
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_CENTER,
        },
      });

      const iw = new google.maps.InfoWindow();
      stateRef.current.map = map;
      stateRef.current.infoWindow = iw;

      // Geolocation
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const ll = new google.maps.LatLng(
              pos.coords.latitude,
              pos.coords.longitude
            );
            map.setCenter(ll);
            map.setZoom(17);
            if (!stateRef.current.userMarker) {
              stateRef.current.userMarker = new google.maps.Marker({
                map,
                position: ll,
                title: "Current Location",
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: "#0d6efd",
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                },
              });
            }
          },
          () => {}
        );
      }

      // Map click — close IW, clear selection
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (stateRef.current.drawMode) return;
        iw.close();
        stateRef.current.selectedShape = null;
        stateRef.current.activeIWMarker = null;
        clearSelection();
      });

      // Track last mouse position for paste
      map.addListener(
        "mousemove",
        (e: google.maps.MapMouseEvent) => {
          onMapMouseMove(e);
        }
      );
      map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
        onMapMouseDown(e);
      });
      map.addListener("mouseup", (e: google.maps.MapMouseEvent) => {
        onMapMouseUp(e);
      });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        onMapClick(e);
      });
      map.addListener("dblclick", (e: google.maps.MapMouseEvent) => {
        onMapDblClick(e);
      });
      map.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
        onMapRightClick(e);
      });

      // Keyboard shortcuts
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      publishState();
    }

    // ── Places search ────────────────────────────────────────────────────────
    function flyToQuery(query: string) {
      const map = stateRef.current.map;
      if (!map || !query.trim()) return;

      // Try raw lat,lng first
      const ll = parseLatLng(query);
      if (ll) {
        map.setCenter(ll);
        map.setZoom(17);
        dropSearchPin(map, ll, query);
        return;
      }

      // Fall back to Geocoder
      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: query }, (results, status) => {
          if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
            const loc = results[0].geometry.location;
            map.setCenter(loc);
            map.setZoom(15);
            dropSearchPin(map, loc, results[0].formatted_address || query);
          }
        });
      } catch {}
    }

    function parseLatLng(text: string): google.maps.LatLngLiteral | null {
      const s = text.trim().replace(/\s+/g, " ").replace(/[°′'"]/g, "");
      const parts = s.includes(",") ? s.split(",") : s.split(" ");
      if (parts.length < 2) return null;
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng)) return null;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { lat, lng };
    }

    function dropSearchPin(
      map: google.maps.Map,
      pos: google.maps.LatLng | google.maps.LatLngLiteral,
      title: string
    ) {
      const s = stateRef.current;
      if (s.userMarker) s.userMarker.setMap(null);
      s.userMarker = new google.maps.Marker({
        map,
        position: pos,
        title,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#0d6efd",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 20,
      });
    }

    // ── Shape helpers ─────────────────────────────────────────────────────────

    function hasAnyShapes() {
      const s = stateRef.current;
      return s.polygons.length + s.circles.length + s.rectangles.length > 0;
    }

    function polygonToString(poly: google.maps.Polygon): string {
      const path = poly.getPath();
      const parts: string[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        parts.push(`${p.lat()},${p.lng()}`);
      }
      return parts.join(";") + ";";
    }

    function circleToString(circle: google.maps.Circle): string {
      const c = circle.getCenter()!;
      return `${circle.getRadius()};(${c.lat()},${c.lng()})`;
    }

    function rectToPolygonString(rect: google.maps.Rectangle): string {
      const b = rect.getBounds()!;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      const nw = new google.maps.LatLng(ne.lat(), sw.lng());
      const se = new google.maps.LatLng(sw.lat(), ne.lng());
      const pts = [sw, se, ne, nw];
      return pts.map((p) => `${p.lat()},${p.lng()}`).join(";") + ";";
    }

    function addShapeToStore(shape: google.maps.MVCObject & { wmType?: string }) {
      const s = stateRef.current;
      if (!s.map) return;
      const gShape = shape as google.maps.Polygon &
        google.maps.Circle &
        google.maps.Rectangle & { wmType?: string; __wmBound?: boolean };
      if (!gShape.getMap()) gShape.setMap(s.map);
      if (gShape.wmType === "polygon") {
        if (!s.polygons.includes(gShape as google.maps.Polygon))
          s.polygons.push(gShape as google.maps.Polygon);
      } else if (gShape.wmType === "circle") {
        if (!s.circles.includes(gShape as google.maps.Circle))
          s.circles.push(gShape as google.maps.Circle);
      } else if (gShape.wmType === "rectangle") {
        if (!s.rectangles.includes(gShape as google.maps.Rectangle))
          s.rectangles.push(gShape as google.maps.Rectangle);
      }
      if (!gShape.__wmBound) {
        attachShapeClick(gShape as any);
        gShape.__wmBound = true;
      }
      publishState();
    }

    function removeShapeFromStore(
      shape: google.maps.MVCObject & { wmType?: string }
    ) {
      const s = stateRef.current;
      const gShape = shape as google.maps.Polygon &
        google.maps.Circle &
        google.maps.Rectangle & { wmType?: string };
      gShape.setMap(null);
      if (gShape.wmType === "polygon")
        s.polygons = s.polygons.filter((x) => x !== gShape);
      if (gShape.wmType === "circle")
        s.circles = s.circles.filter((x) => x !== (gShape as unknown));
      if (gShape.wmType === "rectangle")
        s.rectangles = s.rectangles.filter((x) => x !== (gShape as unknown));
      publishState();
    }

    function removeAllShapes() {
      const s = stateRef.current;
      s.polygons.forEach((x) => x.setMap(null));
      s.circles.forEach((x) => x.setMap(null));
      s.rectangles.forEach((x) => x.setMap(null));
      s.polygons = [];
      s.circles = [];
      s.rectangles = [];
      publishState();
    }

    function attachShapeClick(
      shape: (google.maps.Polygon | google.maps.Circle | google.maps.Rectangle) & {
        wmType?: string;
      }
    ) {
      const s = stateRef.current;
      google.maps.event.addListener(shape, "click", (e: google.maps.MapMouseEvent) => {
        const iw = s.infoWindow;
        if (!iw || !s.map) return;
        const pos =
          (e as any)?.latLng ||
          (shape as google.maps.Rectangle).getBounds?.()?.getCenter?.() ||
          (shape as google.maps.Circle).getCenter?.();

        const root = document.createElement("div");
        root.className = "wm-shape-iw";
        root.innerHTML = `
          <h6>Generate waypoints for this shape?</h6>
          <button class="wm-btn wm-btn-success" id="shapeGen">Generate</button>
          <button class="wm-btn wm-btn-danger" id="shapeRem" style="background:#fff;border:1px solid #dc3545;color:#dc3545">Remove</button>
          <div class="wm-tip">Draw multiple shapes, then click <b>Generate</b> to process all.</div>`;

        root.querySelector("#shapeGen")!.addEventListener("click", () => {
          iw.close();
          generateAllShapes();
        });
        root.querySelector("#shapeRem")!.addEventListener("click", () => {
          iw.close();
          const ref = shape;
          historyRecord({
            undo: () => addShapeToStore(ref),
            redo: () => removeShapeFromStore(ref),
          });
          removeShapeFromStore(shape);
        });

        iw.setContent(root);
        if (pos) iw.setPosition(pos);
        iw.open({ map: s.map });
        s.selectedShape = shape;
      });
    }

    // ── Waypoint markers ──────────────────────────────────────────────────────

    // The original blue arrow SVG path
    const WAYPOINT_ICON_PATH =
      "M 230 80 A 45 45, 0, 1, 0, 275 125 L 275 80 Z";

    function makeIcon(
      heading: number,
      selected = false,
      fillColor = "#1565c0"
    ): google.maps.Symbol {
      const rot = (((heading || 0) - 45 + 540) % 360) - 180;
      return {
        path: WAYPOINT_ICON_PATH,
        fillOpacity: 0.9,
        fillColor,
        anchor: new google.maps.Point(228, 125),
        strokeWeight: selected ? 2.5 : 2,
        strokeColor: selected ? "#ffeb3b" : "white",
        scale: 0.5,
        rotation: rot,
        labelOrigin: new google.maps.Point(228, 125),
      } as unknown as google.maps.Symbol;
    }

    function getMarkerRole(m: WaypointMarker): "start" | "end" | "normal" {
      const s = stateRef.current;
      if (s.flags.length < 2) return "normal";
      const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);
      if (m === sorted[0]) return "start";
      if (m === sorted[sorted.length - 1]) return "end";
      return "normal";
    }

    function roleColor(role: "start" | "end" | "normal"): string {
      if (role === "start") return "#198754";
      if (role === "end") return "#dc3545";
      return "#1565c0";
    }

    function refreshMarkerAppearance(m: WaypointMarker) {
      const role = getMarkerRole(m);
      m.setIcon(makeIcon(m.heading, m.__selected, roleColor(role)));
    }

    type WaypointMarker = google.maps.Marker & {
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
      __selected: boolean;
      __dragStart?: WaypointData;
    };

    function markerToData(m: WaypointMarker): WaypointData {
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

    function snapMarker(m: WaypointMarker): WaypointData {
      return markerToData(m);
    }

    function applyMarkerSnapshot(m: WaypointMarker, s: WaypointData) {
      m.lat = s.lat;
      m.lng = s.lng;
      m.altitude = s.altitude;
      m.speed = s.speed;
      m.angle = s.angle;
      m.heading = s.heading;
      m.action = s.action;
      m.turnMode = s.turnMode ?? m.turnMode;
      m.useStraightLine = s.useStraightLine ?? m.useStraightLine;
      m.waypointTurnDampingDist =
        s.waypointTurnDampingDist ?? m.waypointTurnDampingDist;
      m.setPosition({ lat: s.lat, lng: s.lng });
      refreshMarkerAppearance(m);
    }

    function renumberLabels() {
      const s = stateRef.current;
      const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);
      sorted.forEach((m, i) => {
        let label: string;
        if (sorted.length === 1) {
          label = "1";
        } else if (i === 0) {
          label = "S";
        } else if (i === sorted.length - 1) {
          label = "E";
        } else {
          label = String(i + 1);
        }
        m.setLabel({ text: label, color: "white", fontSize: "11px", fontWeight: "700" });
        refreshMarkerAppearance(m);
      });
    }

    function addMarkerToStore(m: WaypointMarker) {
      const s = stateRef.current;
      if (!m.getMap()) m.setMap(s.map!);
      if (!s.flags.includes(m)) s.flags.push(m);
      redrawFlightPath();
      renumberLabels();
      publishState();
    }

    function removeMarkerFromStore(m: WaypointMarker) {
      const s = stateRef.current;
      m.setMap(null);
      s.flags = s.flags.filter((x) => x !== m);
      s.selection.delete(m);
      if (s.activeIWMarker === m) {
        s.infoWindow?.close();
        s.activeIWMarker = null;
        propsRef.current.onSelectedWaypointChange(null);
      }
      redrawFlightPath();
      renumberLabels();
      publishState();
    }

    function createWaypointMarker(
      position: { lat: number; lng: number },
      props?: Partial<WaypointData>,
      skipHistory = false
    ): WaypointMarker {
      const s = stateRef.current;
      const settings = propsRef.current.generationSettings;

      const lat =
        typeof (position as any).lat === "function"
          ? (position as any).lat()
          : position.lat;
      const lng =
        typeof (position as any).lng === "function"
          ? (position as any).lng()
          : position.lng;

      const altitude =
        props && Number.isFinite(Number(props.altitude))
          ? Number(props.altitude)
          : settings.altitude;
      const speed =
        props && Number.isFinite(Number(props.speed))
          ? Number(props.speed)
          : settings.speed;
      const angle =
        props && typeof props.angle === "number"
          ? props.angle
          : settings.gimbalAngle;
      const heading =
        props && typeof props.heading === "number" ? props.heading : 0;
      const action =
        props?.action ??
        (settings.generateAllPoints
          ? normalizeActionForServer(settings.allPointsAction)
          : "noAction");
      const turnMode = props?.turnMode ?? "coordinateTurn";
      const useStraightLine =
        props && typeof props.useStraightLine === "number"
          ? props.useStraightLine
          : settings.straightenLines
          ? 1
          : 0;
      const waypointTurnDampingDist =
        props && typeof props.waypointTurnDampingDist === "number"
          ? props.waypointTurnDampingDist
          : settings.straightenLines
          ? 0
          : 20;

      const id = s.flagCount;

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: s.map!,
        label: { text: String(s.flags.length + 1), color: "white", fontSize: "11px", fontWeight: "700" },
        draggable: true,
        icon: makeIcon(heading, false),
        zIndex: 10,
      }) as WaypointMarker;

      marker.wmId = id;
      marker.lat = lat;
      marker.lng = lng;
      marker.altitude = altitude;
      marker.speed = speed;
      marker.angle = angle;
      marker.heading = heading;
      marker.action = action;
      marker.turnMode = turnMode;
      marker.useStraightLine = useStraightLine;
      marker.waypointTurnDampingDist = waypointTurnDampingDist;
      marker.__selected = false;

      // Click
      marker.addListener("click", (e: google.maps.MapMouseEvent) => {
        const dom = (e as any)?.domEvent;
        if (dom && (dom.ctrlKey || dom.metaKey)) {
          toggleSelection(marker);
          return;
        }
        openMarkerInfoWindow(marker);
      });

      // Drag (with group drag support when Ctrl held)
      let dragStart: WaypointData | null = null;
      marker.addListener("dragstart", (e: google.maps.MapMouseEvent) => {
        dragStart = snapMarker(marker);
        const s = stateRef.current;
        const wantGroup = (s.selection.has(marker) && s.selection.size > 1);
        if (wantGroup) {
          s.groupDrag = {
            ref: marker,
            anchor: { lat: marker.lat, lng: marker.lng },
            originals: Array.from(s.selection).map((m) => ({ m, lat: m.lat, lng: m.lng })),
          };
        } else {
          s.groupDrag = null;
        }
      });
      marker.addListener("drag", () => {
        const pos = marker.getPosition()!;
        marker.lat = pos.lat();
        marker.lng = pos.lng();
        const s = stateRef.current;
        if (s.groupDrag && s.groupDrag.ref === marker) {
          const dLat = marker.lat - s.groupDrag.anchor.lat;
          const dLng = marker.lng - s.groupDrag.anchor.lng;
          s.groupDrag.originals.forEach(({ m, lat, lng }) => {
            if (m === marker) return;
            const newLat = lat + dLat;
            const newLng = lng + dLng;
            m.lat = newLat;
            m.lng = newLng;
            m.setPosition({ lat: newLat, lng: newLng });
          });
        }
        redrawFlightPath();
      });
      marker.addListener("dragend", () => {
        const s = stateRef.current;
        if (s.groupDrag) {
          const befores = s.groupDrag.originals.map(({ m }) => snapMarker(m));
          const afters = s.groupDrag.originals.map(({ m }) => snapMarker(m));
          // update anchor offsets
          s.groupDrag.originals.forEach(({ m }) => {
            const pos = m.getPosition()!;
            m.lat = pos.lat();
            m.lng = pos.lng();
          });
          const captured = s.groupDrag.originals.map(({ m }) => m);
          const capturedBefores = [...befores];
          const capturedAfters = captured.map((m) => snapMarker(m));
          historyRecord({
            undo: () => captured.forEach((m, i) => applyMarkerSnapshot(m, capturedBefores[i])),
            redo: () => captured.forEach((m, i) => applyMarkerSnapshot(m, capturedAfters[i])),
          });
          s.groupDrag = null;
        } else {
          const before = dragStart!;
          const after = snapMarker(marker);
          historyRecord({
            undo: () => applyMarkerSnapshot(marker, before),
            redo: () => applyMarkerSnapshot(marker, after),
          });
        }
        redrawFlightPath();
        publishState();
      });

      s.flagCount += 1;
      if (!skipHistory) {
        historyRecord({
          undo: () => removeMarkerFromStore(marker),
          redo: () => addMarkerToStore(marker),
        });
      }
      addMarkerToStore(marker);
      return marker;
    }

    function openMarkerInfoWindow(marker: WaypointMarker) {
      const s = stateRef.current;
      if (!s.infoWindow || !s.map) return;
      s.activeIWMarker = marker;
      propsRef.current.onSelectedWaypointChange(markerToData(marker));

      const unitLen = s.unitMode ? "ft" : "m";
      const unitSpd = s.unitMode ? "ft/s" : "m/s";

      const turnOptions = [
        { v: "coordinateTurn", t: "Curved (coordinated turn)" },
        { v: "toPointAndPassWithContinuityCurvature", t: "Curved (pass through)" },
        { v: "toPointAndStopWithContinuityCurvature", t: "Curved (stop at point)" },
        { v: "toPointAndStopWithDiscontinuityCurvature", t: "Sharp corner (stop)" },
      ];

      const role = getMarkerRole(marker);
      const roleLabel = role === "start" ? "Start · " : role === "end" ? "End · " : "";

      const root = document.createElement("div");
      root.className = "wm-iw";
      root.innerHTML = `
        <div class="wm-iw-header">${roleLabel}Waypoint #${marker.wmId}</div>
        <div class="wm-iw-body">
          <div class="wm-iw-row">
            <div class="wm-iw-field"><div class="wm-iw-label">Lat</div><input class="wm-iw-input" id="iw-lat" type="number" step="0.0000001" value="${marker.lat.toFixed(7)}"></div>
            <div class="wm-iw-field"><div class="wm-iw-label">Lng</div><input class="wm-iw-input" id="iw-lng" type="number" step="0.0000001" value="${marker.lng.toFixed(7)}"></div>
            <button class="wm-iw-copy-btn" id="iw-copy-coords" title="Copy coordinates">📋</button>
          </div>
          <div class="wm-iw-row">
            <div class="wm-iw-field"><div class="wm-iw-label">Alt (${unitLen})</div><input class="wm-iw-input" id="iw-alt" type="number" step="0.25" value="${marker.altitude}"></div>
            <div class="wm-iw-field"><div class="wm-iw-label">Speed (${unitSpd})</div><input class="wm-iw-input" id="iw-speed" type="number" step="0.25" value="${marker.speed}"></div>
          </div>
          <div class="wm-iw-row">
            <div class="wm-iw-field"><div class="wm-iw-label">Gimbal (°)</div><input class="wm-iw-input" id="iw-angle" type="number" step="1" value="${marker.angle}"></div>
            <div class="wm-iw-field"><div class="wm-iw-label">Heading (°)</div><input class="wm-iw-input" id="iw-heading" type="number" step="1" value="${marker.heading}"></div>
          </div>
          <div class="wm-iw-field">
            <div class="wm-iw-label">Action</div>
            <select class="wm-iw-select" id="iw-action">
              <option value="noAction">No Action</option>
              <option value="takePhoto">Take Picture</option>
              <option value="startRecord">Start Recording</option>
              <option value="stopRecord">Stop Recording</option>
            </select>
          </div>
          <div class="wm-iw-field">
            <div class="wm-iw-label">Turn Mode</div>
            <select class="wm-iw-select" id="iw-turn">
              ${turnOptions.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="wm-iw-actions">
          <button class="wm-btn wm-btn-primary" id="iw-save">Save</button>
          <button class="wm-btn wm-btn-danger" id="iw-del">Delete</button>
        </div>`;

      // Set dropdown values after inserting into DOM would need domready, but since
      // we're setting them before open we need to do it after appending
      const iw = s.infoWindow;
      iw.setContent(root);
      iw.open({ map: s.map, anchor: marker });

      google.maps.event.addListenerOnce(iw, "domready", () => {
        const q = (id: string) => root.querySelector<HTMLElement>(`#${id}`);
        (q("iw-action") as HTMLSelectElement).value =
          marker.action || "noAction";
        (q("iw-turn") as HTMLSelectElement).value =
          marker.turnMode || "coordinateTurn";

        const copyBtn = q("iw-copy-coords");
        if (copyBtn) {
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(`${marker.lat.toFixed(7)}, ${marker.lng.toFixed(7)}`).catch(() => {});
          });
        }

        q("iw-save")!.addEventListener("click", () => {
          const before = snapMarker(marker);
          const nl = parseFloat((q("iw-lat") as HTMLInputElement).value);
          const ng = parseFloat((q("iw-lng") as HTMLInputElement).value);
          const na = parseFloat((q("iw-alt") as HTMLInputElement).value);
          const ns = parseFloat((q("iw-speed") as HTMLInputElement).value);
          const nang = parseFloat((q("iw-angle") as HTMLInputElement).value);
          const nh = parseFloat((q("iw-heading") as HTMLInputElement).value);
          const nact = (q("iw-action") as HTMLSelectElement).value;
          const nturn = (q("iw-turn") as HTMLSelectElement).value;

          const after: WaypointData = {
            ...before,
            lat: isNaN(nl) ? marker.lat : nl,
            lng: isNaN(ng) ? marker.lng : ng,
            altitude: isNaN(na) ? marker.altitude : na,
            speed: isNaN(ns) ? marker.speed : ns,
            angle: isNaN(nang) ? marker.angle : nang,
            heading: isNaN(nh) ? marker.heading : nh,
            action: nact || marker.action,
            turnMode: nturn || marker.turnMode,
          };
          applyMarkerSnapshot(marker, after);
          redrawFlightPath();
          propsRef.current.onWaypointUpdated(after);
          historyRecord({
            undo: () => {
              applyMarkerSnapshot(marker, before);
              propsRef.current.onWaypointUpdated(before);
            },
            redo: () => {
              applyMarkerSnapshot(marker, after);
              propsRef.current.onWaypointUpdated(after);
            },
          });
          iw.close();
          s.activeIWMarker = null;
          propsRef.current.onSelectedWaypointChange(null);
        });

        q("iw-del")!.addEventListener("click", () => {
          const ref = marker;
          historyRecord({
            undo: () => addMarkerToStore(ref),
            redo: () => removeMarkerFromStore(ref),
          });
          removeMarkerFromStore(marker);
          iw.close();
          s.activeIWMarker = null;
          propsRef.current.onSelectedWaypointChange(null);
        });
      });
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    function setMarkerSelected(m: WaypointMarker, on: boolean) {
      m.__selected = on;
      refreshMarkerAppearance(m);
    }

    function toggleSelection(m: WaypointMarker) {
      const s = stateRef.current;
      const on = !m.__selected;
      setMarkerSelected(m, on);
      if (on) s.selection.add(m);
      else s.selection.delete(m);
    }

    function clearSelection() {
      const s = stateRef.current;
      s.flags.forEach((m) => setMarkerSelected(m, false));
      s.selection.clear();
    }

    // ── Flight path (curved bezier preview) ──────────────────────────────────

    function llLerp(
      A: { lat: number; lng: number },
      B: { lat: number; lng: number },
      t: number
    ) {
      return { lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
    }

    function quadBezier(
      p0: { lat: number; lng: number },
      p1: { lat: number; lng: number },
      p2: { lat: number; lng: number },
      t: number
    ) {
      return llLerp(llLerp(p0, p1, t), llLerp(p1, p2, t), t);
    }

    function curvedPath(flags: WaypointMarker[]) {
      if (flags.length < 2) return flags.map((m) => ({ lat: m.lat, lng: m.lng }));
      const result: Array<{ lat: number; lng: number }> = [];
      for (let i = 0; i < flags.length; i++) {
        const cur = { lat: flags[i].lat, lng: flags[i].lng };
        if (i === 0 || i === flags.length - 1) { result.push(cur); continue; }
        const prev = { lat: flags[i - 1].lat, lng: flags[i - 1].lng };
        const next = { lat: flags[i + 1].lat, lng: flags[i + 1].lng };
        const sharp = flags[i].turnMode === "toPointAndStopWithDiscontinuityCurvature";
        if (sharp) { result.push(cur); continue; }
        const tC = 0.15;
        const entry = llLerp(prev, cur, 1 - tC);
        const exit  = llLerp(cur, next, tC);
        result.push(entry);
        for (let t = CURVED_PATH_STEP; t < 1.0; t += CURVED_PATH_STEP) result.push(quadBezier(entry, cur, exit, t));
        result.push(exit);
      }
      return result;
    }

    function redrawFlightPath() {
      const s = stateRef.current;
      s.lines.forEach((l) => l.setMap(null));
      s.curvedLines.forEach((l) => l.setMap(null));
      s.startEndDecorations.forEach((c) => c.setMap(null));
      s.lines = [];
      s.curvedLines = [];
      s.startEndDecorations = [];
      if (!s.map) return;

      const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);
      if (sorted.length === 0) return;

      // Start (home) ring — green
      s.startEndDecorations.push(new google.maps.Circle({
        map: s.map,
        center: { lat: sorted[0].lat, lng: sorted[0].lng },
        radius: 12,
        strokeColor: "#198754",
        strokeOpacity: 0.9,
        strokeWeight: 2.5,
        fillColor: "#198754",
        fillOpacity: 0.12,
        zIndex: 3,
        clickable: false,
      }));

      // End (finish) ring — red (only if different from start)
      if (sorted.length > 1) {
        s.startEndDecorations.push(new google.maps.Circle({
          map: s.map,
          center: { lat: sorted[sorted.length - 1].lat, lng: sorted[sorted.length - 1].lng },
          radius: 12,
          strokeColor: "#dc3545",
          strokeOpacity: 0.9,
          strokeWeight: 2.5,
          fillColor: "#dc3545",
          fillOpacity: 0.12,
          zIndex: 3,
          clickable: false,
        }));
      }

      if (sorted.length < 2) return;

      // Faint straight underlay
      s.lines.push(new google.maps.Polyline({
        map: s.map,
        path: sorted.map((m) => ({ lat: m.lat, lng: m.lng })),
        geodesic: false,
        strokeColor: "#6c757d",
        strokeOpacity: 0.35,
        strokeWeight: 1,
        zIndex: 4,
        clickable: false,
      }));

      // Bright curved overlay with direction arrows
      s.curvedLines.push(new google.maps.Polyline({
        map: s.map,
        path: curvedPath(sorted),
        geodesic: false,
        strokeColor: "#0d6efd",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        zIndex: 5,
        clickable: false,
        icons: [{
          icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#0d6efd", strokeWeight: 1.5 },
          offset: "0",
          repeat: ARROW_REPEAT,
        }],
      }));
    }

    // ── Draw mode ─────────────────────────────────────────────────────────────

    function setDrawModeInternal(mode: DrawMode) {
      const s = stateRef.current;
      // cancel any in-progress draw
      cancelDraw();
      s.drawMode = mode;

      const mapDiv = s.map?.getDiv();
      if (!mapDiv) return;
      mapDiv.classList.remove(
        "cursor-poly",
        "cursor-rect",
        "cursor-circ",
        "cursor-mark",
        "cursor-select"
      );
      if (mode === "polygon") mapDiv.classList.add("cursor-poly");
      else if (mode === "rectangle") mapDiv.classList.add("cursor-rect");
      else if (mode === "circle") mapDiv.classList.add("cursor-circ");
      else if (mode === "marker") mapDiv.classList.add("cursor-mark");
      else if (mode === "select") mapDiv.classList.add("cursor-select");

      if (mode === null) {
        s.map?.setOptions({ draggable: true });
      } else if (mode !== "marker" && mode !== "select") {
        s.map?.setOptions({ draggable: false });
      }
    }

    function cancelDraw() {
      const s = stateRef.current;
      s.tmpLine?.setMap(null);
      s.tmpLine = null;
      s.tmpRect?.setMap(null);
      s.tmpRect = null;
      s.tmpCirc?.setMap(null);
      s.tmpCirc = null;
      s.selectRect?.setMap(null);
      s.selectRect = null;
      s.isDragging = false;
      s.startLatLng = null;
      s.map?.setOptions({ draggable: true });
    }

    // ── Map event handlers ────────────────────────────────────────────────────

    function onMapClick(e: google.maps.MapMouseEvent) {
      const s = stateRef.current;
      if (!s.drawMode || !e.latLng) return;

      if (s.drawMode === "marker") {
        const m = createWaypointMarker({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        // Set heading of previous marker to face this one
        const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);
        const idx = sorted.findIndex((f) => f === m);
        if (idx > 0) {
          const prev = sorted[idx - 1];
          const brg = Math.round(
            bearingDeg(
              { lat: prev.lat, lng: prev.lng },
              { lat: m.lat, lng: m.lng }
            )
          );
          prev.heading = brg;
          refreshMarkerAppearance(prev);
        }
        redrawFlightPath();
        return;
      }

      if (s.drawMode === "polygon") {
        let line = s.tmpLine;
        if (!line) {
          line = new google.maps.Polyline({
            map: s.map!,
            strokeColor: "#0d6efd",
            strokeOpacity: 0.95,
            strokeWeight: 2,
            clickable: false,
          });
          s.tmpLine = line;
          s.map?.setOptions({ draggable: false });
        }
        const path = line.getPath();

        // Check if clicking near start to close
        if (path.getLength() >= 3) {
          try {
            const first = path.getAt(0);
            const dist =
              google.maps.geometry.spherical.computeDistanceBetween(
                e.latLng,
                first
              );
            if (dist < 15) {
              path.setAt(path.getLength() - 1, first);
              finishPolygon();
              return;
            }
          } catch {}
        }

        if (path.getLength() === 0) {
          path.push(e.latLng);
          path.push(e.latLng);
        } else {
          path.setAt(path.getLength() - 1, e.latLng);
          path.push(e.latLng);
        }
      }
    }

    function onMapDblClick(e: google.maps.MapMouseEvent) {
      const s = stateRef.current;
      if (s.drawMode === "polygon") {
        try {
          (e as any)?.stop?.();
          (e as any)?.domEvent?.preventDefault?.();
        } catch {}
        if (s.tmpLine) {
          const path = s.tmpLine.getPath();
          if (path.getLength() >= 3)
            path.removeAt(path.getLength() - 1);
        }
        finishPolygon();
      }
    }

    function onMapMouseDown(e: google.maps.MapMouseEvent) {
      const s = stateRef.current;
      if (!s.drawMode || s.drawMode === "polygon" || s.drawMode === "marker")
        return;
      const de = (e as any)?.domEvent;
      if (de && typeof de.button === "number" && de.button !== 0) return;

      // Select mode: rubber-band rectangle
      if (s.drawMode === "select") {
        clearSelection();
        publishStateNow();
        s.isDragging = true;
        s.startLatLng = e.latLng!;
        s.selectRect = new google.maps.Rectangle({
          map: s.map!,
          clickable: false,
          editable: false,
          draggable: false,
          strokeColor: "#0d6efd",
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: "#0d6efd",
          fillOpacity: 0.08,
          bounds: new google.maps.LatLngBounds(e.latLng!, e.latLng!),
        });
        return;
      }

      cancelDraw();
      s.isDragging = true;
      s.startLatLng = e.latLng!;
      s.map?.setOptions({ draggable: false });

      if (s.drawMode === "rectangle") {
        s.tmpRect = new google.maps.Rectangle({
          map: s.map!,
          clickable: false,
          editable: false,
          draggable: false,
          strokeColor: "#0d6efd",
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: "#0d6efd",
          fillOpacity: 0.08,
          bounds: new google.maps.LatLngBounds(e.latLng!, e.latLng!),
        });
      } else if (s.drawMode === "circle") {
        s.tmpCirc = new google.maps.Circle({
          map: s.map!,
          clickable: false,
          editable: false,
          draggable: false,
          strokeColor: "#0d6efd",
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: "#0d6efd",
          fillOpacity: 0.08,
          center: e.latLng!,
          radius: 0,
        });
      }
    }

    function onMapMouseMove(e: google.maps.MapMouseEvent) {
      const s = stateRef.current;
      if (!e.latLng) return;
      s.lastMouseLatLng = e.latLng;

      // Feature 4: lightweight cursor coordinate callback (bypasses publishState)
      if (propsRef.current.onCursorMove) {
        propsRef.current.onCursorMove({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      }

      if (s.drawMode === "polygon" && s.tmpLine) {
        const path = s.tmpLine.getPath();
        if (path.getLength() >= 1) {
          path.setAt(path.getLength() - 1, e.latLng);
        }
        return;
      }

      if (!s.isDragging || !s.startLatLng) return;

      if (s.drawMode === "select" && s.selectRect) {
        const sw = new google.maps.LatLng(
          Math.min(s.startLatLng.lat(), e.latLng.lat()),
          Math.min(s.startLatLng.lng(), e.latLng.lng())
        );
        const ne = new google.maps.LatLng(
          Math.max(s.startLatLng.lat(), e.latLng.lat()),
          Math.max(s.startLatLng.lng(), e.latLng.lng())
        );
        s.selectRect.setBounds(new google.maps.LatLngBounds(sw, ne));
        return;
      }

      if (s.drawMode === "rectangle" && s.tmpRect) {
        const sw = new google.maps.LatLng(
          Math.min(s.startLatLng.lat(), e.latLng.lat()),
          Math.min(s.startLatLng.lng(), e.latLng.lng())
        );
        const ne = new google.maps.LatLng(
          Math.max(s.startLatLng.lat(), e.latLng.lat()),
          Math.max(s.startLatLng.lng(), e.latLng.lng())
        );
        s.tmpRect.setBounds(new google.maps.LatLngBounds(sw, ne));
      }

      if (s.drawMode === "circle" && s.tmpCirc) {
        const r = google.maps.geometry.spherical.computeDistanceBetween(
          s.startLatLng,
          e.latLng
        );
        s.tmpCirc.setRadius(r);
      }
    }

    function onMapMouseUp(_e: google.maps.MapMouseEvent) {
      const s = stateRef.current;
      if (!s.isDragging) return;
      s.isDragging = false;

      if (s.drawMode === "select") {
        if (s.selectRect) {
          const b = s.selectRect.getBounds();
          s.selectRect.setMap(null);
          s.selectRect = null;
          if (b) {
            s.flags.forEach((m) => {
              const inBounds = b.contains({ lat: m.lat, lng: m.lng });
              setMarkerSelected(m, inBounds);
              if (inBounds) s.selection.add(m);
              else s.selection.delete(m);
            });
          }
          publishStateNow();
        }
        return;
      }

      if (s.drawMode === "rectangle") {
        if (s.tmpRect) {
          const b = s.tmpRect.getBounds();
          if (b) {
            const diag = google.maps.geometry.spherical.computeDistanceBetween(
              b.getSouthWest(),
              b.getNorthEast()
            );
            if (diag < 2) {
              s.tmpRect.setMap(null);
              s.tmpRect = null;
              s.map?.setOptions({ draggable: true });
              return;
            }
          }
          finishRectangle();
        }
      }

      if (s.drawMode === "circle") {
        if (s.tmpCirc) {
          if (s.tmpCirc.getRadius() < 1.5) {
            s.tmpCirc.setMap(null);
            s.tmpCirc = null;
            s.map?.setOptions({ draggable: true });
            return;
          }
          finishCircle();
        }
      }
    }

    // ── Finish shape helpers ──────────────────────────────────────────────────

    function finishPolygon() {
      const s = stateRef.current;
      if (!s.tmpLine) return;
      const path = s.tmpLine.getPath();
      if (path.getLength() < 3) {
        cancelDraw();
        return;
      }
      const pts: google.maps.LatLng[] = [];
      for (let i = 0; i < path.getLength(); i++) pts.push(path.getAt(i));

      s.tmpLine.setMap(null);
      s.tmpLine = null;

      const poly = new google.maps.Polygon({
        map: s.map!,
        paths: pts,
        editable: true,
        draggable: true,
        clickable: true,
        strokeColor: "#0d6efd",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: "#0d6efd",
        fillOpacity: 0.08,
      }) as google.maps.Polygon & { wmType?: string; __wmBound?: boolean };

      poly.wmType = "polygon";
      s.polygons.push(poly);
      attachShapeClick(poly);
      poly.__wmBound = true;

      const ref = poly;
      historyRecord({
        undo: () => removeShapeFromStore(ref),
        redo: () => addShapeToStore(ref),
      });

      s.map?.setOptions({ draggable: true });
      s.drawMode = null;
      const mapDiv = s.map?.getDiv();
      mapDiv?.classList.remove("cursor-poly");
      publishState();
    }

    function finishRectangle() {
      const s = stateRef.current;
      if (!s.tmpRect) return;
      const ref = s.tmpRect as google.maps.Rectangle & {
        wmType?: string;
        __wmBound?: boolean;
      };
      ref.setEditable(true);
      ref.setDraggable(true);
      ref.setOptions({ clickable: true });
      ref.wmType = "rectangle";
      s.rectangles.push(ref);
      attachShapeClick(ref);
      ref.__wmBound = true;
      s.tmpRect = null;

      historyRecord({
        undo: () => removeShapeFromStore(ref),
        redo: () => addShapeToStore(ref),
      });

      s.map?.setOptions({ draggable: true });
      s.drawMode = null;
      const mapDiv = s.map?.getDiv();
      mapDiv?.classList.remove("cursor-rect");
      publishState();
    }

    function finishCircle() {
      const s = stateRef.current;
      if (!s.tmpCirc) return;
      const ref = s.tmpCirc as google.maps.Circle & {
        wmType?: string;
        __wmBound?: boolean;
      };
      ref.setEditable(true);
      ref.setDraggable(true);
      ref.setOptions({ clickable: true });
      ref.wmType = "circle";
      s.circles.push(ref);
      attachShapeClick(ref);
      ref.__wmBound = true;
      s.tmpCirc = null;

      historyRecord({
        undo: () => removeShapeFromStore(ref),
        redo: () => addShapeToStore(ref),
      });

      s.map?.setOptions({ draggable: true });
      s.drawMode = null;
      const mapDiv = s.map?.getDiv();
      mapDiv?.classList.remove("cursor-circ");
      publishState();
    }

    // ── Generate ──────────────────────────────────────────────────────────────

    async function generateAllShapes() {
      const s = stateRef.current;
      if (s.isGenerating) return;
      if (!hasAnyShapes()) return;

      s.isGenerating = true;
      publishStateNow();

      const allShapes: Array<{
        shape: google.maps.MVCObject & { wmType?: string };
        boundsStr: string;
        typeStr: string;
      }> = [];

      s.polygons.forEach((p) =>
        allShapes.push({
          shape: p,
          boundsStr: polygonToString(p),
          typeStr: "polygon",
        })
      );
      s.circles.forEach((c) =>
        allShapes.push({
          shape: c,
          boundsStr: circleToString(c),
          typeStr: "circle",
        })
      );
      s.rectangles.forEach((r) =>
        allShapes.push({
          shape: r,
          boundsStr: rectToPolygonString(r),
          typeStr: "polygon",
        })
      );

      const removedShapeRefs = allShapes.map((x) => x.shape);
      const settings = propsRef.current.generationSettings;
      const apiBase =
        propsRef.current.apiBaseUrl ?? "http://localhost:8088";

      const created: WaypointMarker[] = [];
      let generationError: string | null = null;

      try {
        for (const { boundsStr, typeStr } of allShapes) {
          const params = buildParams(boundsStr, typeStr, settings, s.flagCount);
          const res = await fetch(`${apiBase}/Home/GeneratePoints`, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: params,
          });

          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`GeneratePoints failed: ${res.status} ${txt}`);
          }

          const pts: Array<{
            Latitude: number;
            Longitude: number;
            altitude?: number;
            speed?: number;
            gimbalAngle?: number;
            heading?: number;
            action?: string;
            turnMode?: string;
            useStraightLine?: number;
            waypointTurnDampingDist?: number;
          }> = await res.json();

          for (const p of pts) {
            const m = createWaypointMarker(
              { lat: p.Latitude, lng: p.Longitude },
              {
                altitude: Number.isFinite(Number(p.altitude))
                  ? Number(p.altitude)
                  : settings.altitude,
                speed: Number.isFinite(Number(p.speed))
                  ? Number(p.speed)
                  : settings.speed,
                angle: Number.isFinite(Number(p.gimbalAngle))
                  ? Number(p.gimbalAngle)
                  : settings.gimbalAngle,
                heading: Number(p.heading) || 0,
                action: p.action ?? "noAction",
                turnMode: p.turnMode ?? "coordinateTurn",
                useStraightLine: p.useStraightLine ?? 0,
                waypointTurnDampingDist: p.waypointTurnDampingDist ?? 20,
              },
              true
            );
            created.push(m);
          }
        }

        // Record history entry for the whole batch
        if (created.length) {
          let shapesOnMap = false;
          historyRecord({
            undo: () => {
              created.forEach((m) => removeMarkerFromStore(m));
              removedShapeRefs.forEach((sh) => addShapeToStore(sh));
              shapesOnMap = true;
            },
            redo: () => {
              if (shapesOnMap) {
                removedShapeRefs.forEach((sh) => removeShapeFromStore(sh));
                shapesOnMap = false;
              }
              created.forEach((m) => addMarkerToStore(m));
            },
          });
        }

        // Auto-heading: each generated marker faces the next
        applySequentialHeadings(s.flags);

        removeAllShapes();
        redrawFlightPath();

        // Feature 1: record last generate signature
        s.lastGenerateSig = getGenerateSig(propsRef.current.generationSettings);
      } catch (err) {
        generationError =
          err instanceof Error ? err.message : "GeneratePoints failed.";
      } finally {
        s.isGenerating = false;
        publishStateNow({ isGenerating: false, generationError });
      }
    }

    function buildParams(
      boundsStr: string,
      typeStr: string,
      settings: GenerationSettings,
      startIdx: number
    ): string {
      const uiMode = settings.lineAngleMode;
      let sendMode = uiMode;
      let sendOrientation = "0";
      if (uiMode === "presetNS") {
        sendMode = "preset";
        sendOrientation = "1";
      } else if (uiMode === "preset") {
        sendMode = "preset";
        sendOrientation = "0";
      }
      const derivedTurnMode = settings.straightenLines
        ? "toPointAndStopWithDiscontinuityCurvature"
        : settings.turnMode;

      const p = new URLSearchParams();
      p.set("bounds", boundsStr);
      p.set("boundsType", typeStr);
      p.set("in_startingIndex", String(startIdx));
      p.set("in_units", settings.units);
      p.set("altitude", String(settings.altitude));
      p.set("speed", String(settings.speed));
      p.set("in_distance", String(settings.distance));
      p.set("in_overlap", String(settings.overlap));
      p.set("in_interval", String(settings.interval));
      p.set("angle", String(settings.gimbalAngle));
      p.set("in_lineAngleMode", sendMode);
      p.set("in_lineOrientation", sendOrientation);
      p.set("in_lineAngleDegrees", String(settings.lineAngleDegrees));
      p.set("in_turnMode", derivedTurnMode);
      p.set("in_straightenLines", settings.straightenLines ? "true" : "false");
      p.set(
        "in_generateAllPoints",
        settings.generateAllPoints ? "true" : "false"
      );
      p.set(
        "in_allPointsAction",
        normalizeActionForServer(settings.allPointsAction)
      );
      p.set("maintainAlt", settings.maintainAlt ? "true" : "false");
      p.set("in_flipPath", settings.flipPath ? "true" : "false");
      p.set("pass", settings.pass);
      return p.toString();
    }

    // ── Select all / copy / paste ─────────────────────────────────────────────

    function doSelectAll() {
      const s = stateRef.current;
      s.flags.forEach((m) => setMarkerSelected(m, true));
      s.selection = new Set(s.flags);
      publishState();
    }

    function doCopy() {
      const s = stateRef.current;
      const sources = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      if (!sources.length) return;
      s.clipboard = sources.map(markerToData);
    }

    function doPaste() {
      const s = stateRef.current;
      if (!s.clipboard || !s.clipboard.length) return;
      // Offset paste by ~15m so markers don't stack exactly
      const OFFSET = 0.00013;
      const created: WaypointMarker[] = [];
      for (const wp of s.clipboard) {
        const m = createWaypointMarker(
          { lat: wp.lat + OFFSET, lng: wp.lng + OFFSET },
          wp,
          true
        );
        created.push(m);
      }
      historyRecord({
        undo: () => created.forEach((m) => removeMarkerFromStore(m)),
        redo: () => created.forEach((m) => addMarkerToStore(m)),
      });
      redrawFlightPath();
      publishState();
    }

    // ── Import waypoints ──────────────────────────────────────────────────────

    function doImportWaypoints(wps: WaypointData[]) {
      if (!wps.length) return;
      const created: WaypointMarker[] = [];
      for (const wp of wps) {
        const m = createWaypointMarker(
          { lat: wp.lat, lng: wp.lng },
          wp,
          true
        );
        created.push(m);
      }
      // Auto-heading: each marker faces the next
      applySequentialHeadings(created);
      historyRecord({
        undo: () => created.forEach((m) => removeMarkerFromStore(m)),
        redo: () => created.forEach((m) => addMarkerToStore(m)),
      });
      redrawFlightPath();
      publishState();
      // Fit map to imported waypoints
      if (stateRef.current.map && created.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        created.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
        stateRef.current.map.fitBounds(bounds, 60);
      }
    }

    // ── Bulk edit selected markers ────────────────────────────────────────────

    function doBulkEdit(fields: Partial<Pick<WaypointData, "altitude" | "speed" | "angle">>) {
      const s = stateRef.current;
      const targets = s.selection.size > 0 ? Array.from(s.selection) : s.flags;
      if (!targets.length) return;
      const befores = targets.map((m) => snapMarker(m));
      targets.forEach((m) => {
        if (fields.altitude !== undefined) m.altitude = fields.altitude;
        if (fields.speed !== undefined) m.speed = fields.speed;
        if (fields.angle !== undefined) m.angle = fields.angle;
      });
      const afters = targets.map((m) => snapMarker(m));
      historyRecord({
        undo: () => targets.forEach((m, i) => applyMarkerSnapshot(m, befores[i])),
        redo: () => targets.forEach((m, i) => applyMarkerSnapshot(m, afters[i])),
      });
      publishState();
    }

    // ── Sequential headings ───────────────────────────────────────────────────

    function applySequentialHeadings(markers: WaypointMarker[]) {
      const sorted = [...markers].sort((a, b) => a.wmId - b.wmId);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const brg = Math.round(bearingDeg({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }));
        a.heading = brg;
        refreshMarkerAppearance(a);
      }
    }

    // ── KML Overlays ──────────────────────────────────────────────────────────

    function doAddKmlOverlay(overlay: { type: string; path: Array<{ lat: number; lng: number }>; name: string }) {
      const s = stateRef.current;
      if (!s.map) return;
      const id = ++s.overlayCounter;
      const path = overlay.path;
      let shape: google.maps.Polygon | google.maps.Polyline;
      const commonOpts = {
        map: s.map,
        strokeColor: "#198754",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        clickable: false,
      };
      if (overlay.type === "polygon") {
        shape = new google.maps.Polygon({
          ...commonOpts,
          paths: path,
          fillColor: "#198754",
          fillOpacity: 0.08,
        });
      } else {
        shape = new google.maps.Polyline({
          ...commonOpts,
          path,
        });
      }
      s.overlays.push({ id, shape, name: overlay.name });
      publishState();
    }

    function doClearOverlays() {
      const s = stateRef.current;
      s.overlays.forEach((o) => o.shape.setMap(null));
      s.overlays = [];
      publishState();
    }

    function doRemoveOverlay(id: number) {
      const s = stateRef.current;
      const idx = s.overlays.findIndex((o) => o.id === id);
      if (idx === -1) return;
      s.overlays[idx].shape.setMap(null);
      s.overlays.splice(idx, 1);
      publishState();
    }

    function doConvertAllUnits(factor: number) {
      const s = stateRef.current;
      s.flags.forEach((m) => {
        m.altitude = m.altitude * factor;
        m.speed = m.speed * factor;
      });
      publishState();
    }

    // ── Wind barbs grid ───────────────────────────────────────────────────────

    function doClearWindOverlay() {
      const s = stateRef.current;
      s.windArrow?.setMap(null);
      s.windArrow = null;
      s.windBarbs.forEach((m) => m.setMap(null));
      s.windBarbs = [];
      s.crosswindPolylines.forEach((l) => l.setMap(null));
      s.crosswindPolylines = [];
    }

    function doSetWindOverlay(speed: number, direction: number, level: "ok" | "caution" | "danger") {
      const s = stateRef.current;
      doClearWindOverlay();
      if (!s.map) return;
      const color = level === "danger" ? "#dc3545" : level === "caution" ? "#e67e22" : "#198754";
      const bounds = s.map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const pos = new google.maps.LatLng(
        ne.lat() - (ne.lat() - sw.lat()) * 0.08,
        sw.lng() + (ne.lng() - sw.lng()) * 0.08
      );
      const arrowPath = "M 0,-14 L -6,3 L -2,3 L -2,14 L 2,14 L 2,3 L 6,3 Z";
      s.windArrow = new google.maps.Marker({
        map: s.map, position: pos, zIndex: 100, clickable: false,
        icon: { path: arrowPath, fillColor: color, fillOpacity: 0.85, strokeColor: color, strokeWeight: 1, scale: 1.2, rotation: direction, anchor: new google.maps.Point(0, 0) },
        label: { text: `${speed.toFixed(1)} m/s`, color: "#fff", fontSize: "10px", fontWeight: "700" },
      });
    }

    /**
     * Draw a grid of wind barbs across the waypoint area.
     */
    function doSetWindBarbGrid(report: { lat: number; lng: number; speed: number; direction: number; gusts: number; level: "ok" | "caution" | "danger" }) {
      const s = stateRef.current;
      // Clear existing barbs (keep the main arrow)
      s.windBarbs.forEach((m) => m.setMap(null));
      s.windBarbs = [];
      if (!s.map || s.flags.length < 2) return;

      const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      sorted.forEach((m) => { minLat = Math.min(minLat, m.lat); maxLat = Math.max(maxLat, m.lat); minLng = Math.min(minLng, m.lng); maxLng = Math.max(maxLng, m.lng); });

      const spanLat = maxLat - minLat || 0.001;
      const spanLng = maxLng - minLng || 0.001;
      const gridCols = Math.min(4, Math.max(2, Math.round(spanLng / spanLat * 3)));
      const gridRows = Math.min(3, Math.max(1, Math.round(spanLat / spanLng * 3)));

      const kts = report.speed * 1.94384; // m/s → knots
      const barbPath = windBarbPath(kts);
      const color = report.level === "danger" ? "#dc3545" : report.level === "caution" ? "#e67e22" : "rgba(255,255,255,0.7)";

      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const lat = minLat + spanLat * (row + 0.5) / gridRows;
          const lng = minLng + spanLng * (col + 0.5) / gridCols;
          s.windBarbs.push(new google.maps.Marker({
            map: s.map,
            position: { lat, lng },
            zIndex: 99,
            clickable: false,
            icon: { path: barbPath, fillOpacity: 0.7, fillColor: color, strokeColor: color, strokeWeight: 1.5, scale: 0.6, rotation: report.direction, anchor: new google.maps.Point(0, 15) },
          }));
        }
      }
    }

    function doSetFlightPathCrosswind(segments: Array<{ risk: "ok" | "caution" | "danger" }>) {
      const s = stateRef.current;
      s.crosswindPolylines.forEach((l) => l.setMap(null));
      s.crosswindPolylines = [];
      if (!s.map || s.flags.length < 2 || segments.length === 0) return;

      const colors: Record<string, string> = { ok: "#198754", caution: "#e67e22", danger: "#dc3545" };
      const sorted = [...s.flags].sort((a, b) => a.wmId - b.wmId);

      for (let i = 0; i < segments.length && i + 1 < sorted.length; i++) {
        const risk = segments[i].risk;
        const poly = new google.maps.Polyline({
          map: s.map,
          path: [{ lat: sorted[i].lat, lng: sorted[i].lng }, { lat: sorted[i + 1].lat, lng: sorted[i + 1].lng }],
          strokeColor: colors[risk],
          strokeOpacity: 0.7,
          strokeWeight: 3,
          zIndex: 6,
          clickable: false,
          geodesic: false,
        });
        s.crosswindPolylines.push(poly);
      }
    }

    // ── Right-click context menu ──────────────────────────────────────────────

    function onMapRightClick(e: google.maps.MapMouseEvent) {
      // Remove any existing context menu
      document.querySelectorAll(".wm-ctx-menu").forEach((el) => el.remove());

      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      const domEvent = (e as any).domEvent as MouseEvent | undefined;
      const x = domEvent?.clientX ?? 0;
      const y = domEvent?.clientY ?? 0;

      const menu = document.createElement("div");
      menu.className = "wm-ctx-menu";
      menu.style.cssText = `
        position: fixed;
        z-index: 9999;
        left: ${x}px;
        top: ${y}px;
        background: #fff;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 4px 0;
        min-width: 180px;
      `;

      const btnCopy = document.createElement("button");
      btnCopy.textContent = "📋 Copy coordinates";
      btnCopy.style.cssText = "display:block;width:100%;padding:8px 16px;border:none;background:none;text-align:left;cursor:pointer;font-size:13px;color:#212529;";
      btnCopy.addEventListener("click", () => {
        navigator.clipboard.writeText(`${lat.toFixed(7)}, ${lng.toFixed(7)}`).catch(() => {});
        menu.remove();
      });

      const btnPaste = document.createElement("button");
      btnPaste.textContent = "📌 Paste waypoint here";
      btnPaste.style.cssText = "display:block;width:100%;padding:8px 16px;border:none;background:none;text-align:left;cursor:pointer;font-size:13px;color:#212529;";
      btnPaste.addEventListener("click", () => {
        createWaypointMarker({ lat, lng });
        menu.remove();
      });

      menu.appendChild(btnCopy);
      menu.appendChild(btnPaste);
      document.body.appendChild(menu);

      const removeMenu = () => {
        menu.remove();
        document.removeEventListener("click", removeMenu);
      };
      setTimeout(() => document.addEventListener("click", removeMenu), 0);
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    function doReset() {
      const s = stateRef.current;
      cancelDraw();
      // Clear waypoints
      s.flags.forEach((m) => m.setMap(null));
      s.flags = [];
      s.selection.clear();
      s.flagCount = 1;
      // Clear shapes
      removeAllShapes();
      // Clear paths
      s.lines.forEach((l) => l.setMap(null));
      s.lines = [];
      // P10: also clear curvedLines
      s.curvedLines.forEach((l) => l.setMap(null));
      s.curvedLines = [];
      s.startEndDecorations.forEach((c) => c.setMap(null));
      s.startEndDecorations = [];
      s.windArrow?.setMap(null);
      s.windArrow = null;
      s.windBarbs.forEach((m) => m.setMap(null));
      s.windBarbs = [];
      s.crosswindPolylines.forEach((l) => l.setMap(null));
      s.crosswindPolylines = [];
      // Clear history
      s.undoStack = [];
      s.redoStack = [];
      s.activeIWMarker = null;
      s.infoWindow?.close();
      // P10: clear derived state
      s.clipboard = null;
      s.groupDrag = null;
      s.lastMouseLatLng = null;
      s.headingTransform = null;
      s.geoTransform = null;
      s.lastGenerateSig = null;
      propsRef.current.onSelectedWaypointChange(null);
      // P10: remove dangling context menus
      document.querySelectorAll(".wm-ctx-menu").forEach((el) => el.remove());
      publishState();
    }

    // ── Keyboard ──────────────────────────────────────────────────────────────

    function onKeyDown(e: KeyboardEvent) {
      const s = stateRef.current;
      if (e.key === "Control" || e.key === "Meta") s.ctrlDown = true;

      // Feature 3: heading transform — Ctrl+H
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (!s.headingTransform) {
          beginHeadingTransform();
        }
        return;
      }

      // Feature 6: geo transforms — Ctrl+R / Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (!s.geoTransform) {
          beginGeoTransform("rotate");
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        // Don't block browser save; only intercept when waypoints exist
        if (s.flags.length > 0) {
          e.preventDefault();
          if (!s.geoTransform) {
            beginGeoTransform("scale");
          }
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        historyUndo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        historyRedo();
        return;
      }

      if (e.key === "Enter") {
        if (s.headingTransform) { commitHeadingTransform(); return; }
        if (s.geoTransform) { commitGeoTransform(); return; }
      }

      if (e.key === "Escape") {
        if (s.headingTransform) { cancelHeadingTransform(); return; }
        if (s.geoTransform) { cancelGeoTransform(); return; }
        setDrawModeInternal(null);
        clearSelection();
        return;
      }

      // Arrow keys for heading transform (±5°) and geo transform (rotate ±5° / scale ×1.05 ×0.95)
      if (e.key === "ArrowLeft") {
        if (s.headingTransform) { e.preventDefault(); doRotateHeadings(-5); return; }
        if (s.geoTransform?.mode === "rotate") {
          e.preventDefault();
          s.geoTransform.angle = (s.geoTransform.angle - 5 + 360) % 360;
          applyGeoTransform();
          publishStateNow();
          return;
        }
      }
      if (e.key === "ArrowRight") {
        if (s.headingTransform) { e.preventDefault(); doRotateHeadings(5); return; }
        if (s.geoTransform?.mode === "rotate") {
          e.preventDefault();
          s.geoTransform.angle = (s.geoTransform.angle + 5) % 360;
          applyGeoTransform();
          publishStateNow();
          return;
        }
      }
      if (e.key === "ArrowUp") {
        if (s.geoTransform?.mode === "scale") {
          e.preventDefault();
          s.geoTransform.scale *= 1.05;
          applyGeoTransform();
          publishStateNow();
          return;
        }
      }
      if (e.key === "ArrowDown") {
        if (s.geoTransform?.mode === "scale") {
          e.preventDefault();
          s.geoTransform.scale *= 0.95;
          applyGeoTransform();
          publishStateNow();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        doSelectAll();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        doCopy();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        doPaste();
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        s.selection.size > 0
      ) {
        const target = e.target as HTMLElement;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT")
        )
          return;
        e.preventDefault();
        const sel = Array.from(s.selection);
        sel.forEach((m) => removeMarkerFromStore(m));
        historyRecord({
          undo: () => sel.forEach((m) => addMarkerToStore(m)),
          redo: () => sel.forEach((m) => removeMarkerFromStore(m)),
        });
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Meta")
        stateRef.current.ctrlDown = false;
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
      <View style={styles.wrapper} pointerEvents="box-none">
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 12,
            overflow: "hidden",
          }}
        />
      </View>
    );
  }
);

// ─── Google Maps loader ───────────────────────────────────────────────────────

let _loaderPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string, callback: () => void) {
  if ((window as any).google?.maps?.Map) {
    callback();
    return;
  }
  if (!_loaderPromise) {
    _loaderPromise = new Promise<void>((resolve) => {
      const id = "__gm_cb__" + Date.now();
      (window as any)[id] = () => {
        resolve();
        delete (window as any)[id];
      };
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&callback=${id}`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    });
  }
  _loaderPromise.then(callback);
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function normalizeActionForServer(action: string): string {
  switch (action) {
    case "take-picture":
      return "takePicture";
    case "start-recording":
      return "startRecording";
    case "stop-recording":
      return "stopRecording";
    default:
      return "noAction";
  }
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1a1a2e",
  },
});
