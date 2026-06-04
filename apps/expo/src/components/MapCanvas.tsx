import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import type { Mission, Point, Shape, ToolMode, Waypoint } from "../domain/mission";
import { getShapeBounds } from "../domain/mission";

type DraftState = {
  rectangleStart: null | Point;
  polygonPoints: Point[];
};

type Props = {
  draft: DraftState;
  mission: Mission;
  selectedShapeId: null | string;
  selectedWaypointId: null | string;
  onCanvasPress: (point: Point) => void;
  onGenerateSelectedShape: () => void;
  onRemoveSelectedShape: () => void;
  onSelectShape: (shapeId: string | null) => void;
  onSelectWaypoint: (waypointId: string) => void;
  onSetBasemapMode: (mode: Mission["basemapMode"]) => void;
  onSetToolMode: (mode: ToolMode) => void;
};

const TOOLBAR: Array<{ key: ToolMode; label: string }> = [
  { key: "polygon", label: "Polygon" },
  { key: "rectangle", label: "Rectangle" },
  { key: "poi", label: "POI" },
  { key: "waypoint", label: "Waypoint" },
  { key: "select", label: "Select" }
];

export function MapCanvas(props: Props) {
  const selectedShape = props.mission.shapes.find((shape) => shape.id === props.selectedShapeId) ?? null;

  return (
    <View style={styles.frame}>
      <View style={styles.mapSurface}>
        <Image
          source={require("../world-satellite.jpg")}
          style={styles.mapImage}
          resizeMode="cover"
        />
        <View
          style={[
            styles.mapTint,
            props.mission.basemapMode === "map" ? styles.mapTintStreet : undefined
          ]}
        />

        <View style={styles.basemapSwitch}>
          {(["map", "satellite"] as const).map((mode) => (
            <Pressable
              key={mode}
              style={[
                styles.basemapButton,
                props.mission.basemapMode === mode ? styles.basemapButtonActive : undefined
              ]}
              onPress={() => props.onSetBasemapMode(mode)}
            >
              <Text
                style={[
                  styles.basemapText,
                  props.mission.basemapMode === mode ? styles.basemapTextActive : undefined
                ]}
              >
                {mode === "map" ? "Map" : "Satellite"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.toolbar}>
          {TOOLBAR.map((tool) => (
            <Pressable
              key={tool.key}
              style={[
                styles.toolButton,
                props.mission.toolMode === tool.key ? styles.toolButtonActive : undefined
              ]}
              onPress={() => props.onSetToolMode(tool.key)}
            >
              <Text
                style={[
                  styles.toolText,
                  props.mission.toolMode === tool.key ? styles.toolTextActive : undefined
                ]}
              >
                {tool.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.fullscreenButton}>
          <Text style={styles.fullscreenText}>⛶</Text>
        </View>

        <View
          style={styles.touchLayer}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(event) => {
            props.onCanvasPress({
              x: event.nativeEvent.locationX,
              y: event.nativeEvent.locationY
            });
          }}
        />

        <Svg width="100%" height="100%" viewBox="0 0 720 600" style={StyleSheet.absoluteFill}>
          {Array.from({ length: 8 }, (_, index) => (
            <Line
              key={`vertical-${index}`}
              x1={index * 90}
              y1={0}
              x2={index * 90}
              y2={600}
              stroke="rgba(255,255,255,0.08)"
            />
          ))}
          {Array.from({ length: 7 }, (_, index) => (
            <Line
              key={`horizontal-${index}`}
              x1={0}
              y1={index * 100}
              x2={720}
              y2={index * 100}
              stroke="rgba(255,255,255,0.08)"
            />
          ))}

          {props.mission.shapes.map((shape) => renderShape(shape, shape.id === props.selectedShapeId))}
          {renderDraft(props.draft, props.mission.toolMode)}

          {props.mission.waypoints.length > 1 ? (
            <Path
              d={props.mission.waypoints
                .map((waypoint, index) =>
                  `${index === 0 ? "M" : "L"} ${waypoint.canvas.x} ${waypoint.canvas.y}`
                )
                .join(" ")}
              fill="none"
              stroke="#ff4b4b"
              strokeWidth={3}
            />
          ) : null}
        </Svg>

        {props.mission.shapes.length === 0 && props.mission.waypoints.length === 0 ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintTitle}>Draw a shape to begin</Text>
            <Text style={styles.emptyHintBody}>
              Use the polygon, rectangle, or POI tools. Click the shape and press Generate.
            </Text>
          </View>
        ) : null}

        {props.mission.shapes.map((shape) => {
          const bounds = getShapeBounds(shape);

          return (
            <Pressable
              key={shape.id}
              style={[
                styles.hitArea,
                {
                  left: bounds.left,
                  top: bounds.top,
                  width: Math.max(48, bounds.right - bounds.left),
                  height: Math.max(48, bounds.bottom - bounds.top)
                }
              ]}
              onPress={() => props.onSelectShape(shape.id)}
            />
          );
        })}

        {selectedShape ? (
          <View
            style={[
              styles.generateCard,
              {
                left: Math.max(18, getShapeBounds(selectedShape).left - 12),
                top: Math.max(150, getShapeBounds(selectedShape).top - 104)
              }
            ]}
          >
            <Text style={styles.generateTitle}>Generate Waypoints For Shape?</Text>
            <View style={styles.generateActions}>
              <Pressable style={[styles.generateActionButton, styles.generateActionPrimary]} onPress={props.onGenerateSelectedShape}>
                <Text style={styles.generateActionText}>Generate</Text>
              </Pressable>
              <Pressable style={[styles.generateActionButton, styles.generateActionDanger]} onPress={props.onRemoveSelectedShape}>
                <Text style={styles.generateActionText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {props.mission.waypoints.map((waypoint) => renderWaypoint(waypoint, waypoint.id === props.selectedWaypointId, props.onSelectWaypoint))}

        <View style={styles.zoomButton}>
          <Text style={styles.zoomText}>⌖</Text>
        </View>
        <View style={styles.pegman}>
          <Text style={styles.pegmanText}>👤</Text>
        </View>

        <View style={styles.googleMark}>
          <Text style={styles.googleMarkText}>Google</Text>
        </View>

        <View style={styles.mapMetaRow}>
          <Text style={styles.mapMetaText}>Keyboard shortcuts</Text>
          <Text style={styles.mapMetaText}>Map data ©2026 Google Imagery ©2026 NASA</Text>
          <Text style={styles.mapMetaText}>Terms</Text>
        </View>
      </View>
    </View>
  );
}

function renderShape(shape: Shape, selected: boolean) {
  const stroke = selected ? "#0d6efd" : "#4b98ff";
  const fill = "rgba(255,255,255,0.12)";

  if (shape.kind === "circle") {
    const center = shape.center ?? { x: 0, y: 0 };

    return (
      <Circle
        key={shape.id}
        cx={center.x}
        cy={center.y}
        r={shape.radius ?? 28}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 4 : 3}
      />
    );
  }

  if (shape.kind === "rectangle") {
    const bounds = getShapeBounds(shape);

    return (
      <Rect
        key={shape.id}
        x={bounds.left}
        y={bounds.top}
        width={bounds.right - bounds.left}
        height={bounds.bottom - bounds.top}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 4 : 3}
      />
    );
  }

  const points = shape.points ?? [];
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <Path
      key={shape.id}
      d={`${path} Z`}
      fill={fill}
      stroke={stroke}
      strokeWidth={selected ? 4 : 3}
    />
  );
}

function renderDraft(draft: DraftState, toolMode: ToolMode) {
  if (toolMode === "polygon" && draft.polygonPoints.length > 0) {
    const path = draft.polygonPoints
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");

    return <Path d={path} fill="none" stroke="#8ab4ff" strokeWidth={3} strokeDasharray="8 6" />;
  }

  if (toolMode === "rectangle" && draft.rectangleStart) {
    return (
      <Circle
        cx={draft.rectangleStart.x}
        cy={draft.rectangleStart.y}
        r={6}
        fill="#ffffff"
        stroke="#0d6efd"
        strokeWidth={2}
      />
    );
  }

  return null;
}

function renderWaypoint(
  waypoint: Waypoint,
  selected: boolean,
  onSelectWaypoint: (waypointId: string) => void
) {
  return (
    <Pressable
      key={waypoint.id}
      style={[
        styles.marker,
        {
          left: waypoint.canvas.x - 18,
          top: waypoint.canvas.y - 18
        }
      ]}
      onPress={() => onSelectWaypoint(waypoint.id)}
    >
      <View style={[styles.markerBubble, selected ? styles.markerBubbleActive : undefined]}>
        <Text style={styles.markerText}>{waypoint.number}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 720,
    height: 600,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ddd6cc",
    backgroundColor: "#d5d0c8"
  },
  mapSurface: {
    flex: 1,
    overflow: "hidden"
  },
  mapImage: {
    position: "absolute",
    left: -152,
    top: -96,
    width: 1120,
    height: 760
  },
  mapTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.02)"
  },
  mapTintStreet: {
    backgroundColor: "rgba(250, 247, 241, 0.42)"
  },
  basemapSwitch: {
    position: "absolute",
    left: 12,
    top: 12,
    zIndex: 4,
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 3,
    overflow: "hidden"
  },
  basemapButton: {
    paddingHorizontal: 18,
    paddingVertical: 11
  },
  basemapButtonActive: {
    backgroundColor: "#fff"
  },
  basemapText: {
    fontSize: 17,
    color: "#51565c",
    fontWeight: "500"
  },
  basemapTextActive: {
    color: "#16181c",
    fontWeight: "700"
  },
  toolbar: {
    position: "absolute",
    top: 12,
    left: 180,
    zIndex: 4,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.98)",
    borderRadius: 8,
    padding: 4,
    gap: 4
  },
  toolButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#0d6efd",
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14
  },
  toolButtonActive: {
    backgroundColor: "#fefefe"
  },
  toolText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0d6efd"
  },
  toolTextActive: {
    color: "#0d6efd"
  },
  fullscreenButton: {
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 4,
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center"
  },
  fullscreenText: {
    fontSize: 18,
    color: "#63676b"
  },
  touchLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1
  },
  emptyHint: {
    position: "absolute",
    left: 166,
    top: 323,
    width: 404,
    zIndex: 5,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "#90b5ff",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16
  },
  emptyHintTitle: {
    fontSize: 17,
    fontWeight: "500",
    color: "#212529"
  },
  emptyHintBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    color: "#6c757d",
    textAlign: "center"
  },
  hitArea: {
    position: "absolute",
    zIndex: 2
  },
  generateCard: {
    position: "absolute",
    zIndex: 7,
    width: 266,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#dce5f5",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18
  },
  generateTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2328"
  },
  generateActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10
  },
  generateActionButton: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  generateActionPrimary: {
    backgroundColor: "#198754"
  },
  generateActionDanger: {
    backgroundColor: "#dc3545"
  },
  generateActionText: {
    color: "#fff",
    fontWeight: "700"
  },
  marker: {
    position: "absolute",
    zIndex: 6
  },
  markerBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ef6a56",
    borderWidth: 2,
    borderColor: "#322b2b",
    alignItems: "center",
    justifyContent: "center"
  },
  markerBubbleActive: {
    backgroundColor: "#f6d14c"
  },
  markerText: {
    fontSize: 13,
    color: "#111",
    fontWeight: "800"
  },
  zoomButton: {
    position: "absolute",
    right: 10,
    bottom: 100,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center"
  },
  zoomText: {
    fontSize: 22,
    color: "#63676b"
  },
  pegman: {
    position: "absolute",
    right: 10,
    bottom: 18,
    zIndex: 4,
    width: 22,
    height: 36,
    borderRadius: 3,
    backgroundColor: "#ffe34b",
    borderWidth: 1,
    borderColor: "#d8c42b",
    alignItems: "center",
    justifyContent: "center"
  },
  pegmanText: {
    fontSize: 14
  },
  googleMark: {
    position: "absolute",
    left: 12,
    bottom: 10,
    zIndex: 4
  },
  googleMarkText: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "500",
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  mapMetaRow: {
    position: "absolute",
    right: 8,
    bottom: 2,
    zIndex: 4,
    flexDirection: "row",
    gap: 10
  },
  mapMetaText: {
    fontSize: 10,
    color: "#1f1f1f",
    backgroundColor: "rgba(255,255,255,0.74)"
  }
});
