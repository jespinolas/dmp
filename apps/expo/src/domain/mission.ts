export type ToolMode = "polygon" | "rectangle" | "poi" | "waypoint" | "select";
export type BasemapMode = "map" | "satellite";
export type WaypointAction = "none" | "take-picture" | "start-recording" | "stop-recording";
export type ShapeKind = "polygon" | "rectangle" | "circle";

export type Point = {
  x: number;
  y: number;
};

export type Waypoint = {
  id: string;
  number: number;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  gimbalAngle: number;
  heading: number;
  action: WaypointAction;
  turnMode: string;
  useStraightLine: number;
  waypointTurnDampingDist: number;
  canvas: Point;
};

export type Shape = {
  id: string;
  name: string;
  kind: ShapeKind;
  points?: Point[];
  center?: Point;
  radius?: number;
  width?: number;
  height?: number;
};

export type Mission = {
  id: string;
  name: string;
  basemapMode: BasemapMode;
  toolMode: ToolMode;
  shapes: Shape[];
  waypoints: Waypoint[];
};

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const LAT_ORIGIN = -20.2;
const LNG_ORIGIN = -60.5;
const LAT_SCALE = -0.0128;
const LNG_SCALE = 0.0165;

export function toCoordinate(point: Point): { latitude: number; longitude: number } {
  return {
    latitude: Number((LAT_ORIGIN + (point.y / 600) * LAT_SCALE).toFixed(6)),
    longitude: Number((LNG_ORIGIN + (point.x / 720) * LNG_SCALE).toFixed(6))
  };
}

export function fromCoordinate(latitude: number, longitude: number): Point {
  return {
    x: Number((((longitude - LNG_ORIGIN) / LNG_SCALE) * 720).toFixed(2)),
    y: Number((((latitude - LAT_ORIGIN) / LAT_SCALE) * 600).toFixed(2))
  };
}

export function getShapeBounds(shape: Shape): Bounds {
  if (shape.kind === "circle") {
    const center = shape.center ?? { x: 0, y: 0 };
    const radius = shape.radius ?? 28;

    return {
      left: center.x - radius,
      top: center.y - radius,
      right: center.x + radius,
      bottom: center.y + radius
    };
  }

  if (shape.kind === "rectangle") {
    const center = shape.center ?? { x: 0, y: 0 };
    const width = shape.width ?? 80;
    const height = shape.height ?? 80;

    return {
      left: center.x - width / 2,
      top: center.y - height / 2,
      right: center.x + width / 2,
      bottom: center.y + height / 2
    };
  }

  const points = shape.points ?? [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  };
}

function buildWaypoint(point: Point, number: number, heading: number, action: WaypointAction): Waypoint {
  const coordinates = toCoordinate(point);

  return {
    id: `wp-${number}`,
    number,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    altitude: 60,
    speed: 3.5,
    gimbalAngle: -45,
    heading,
    action,
    turnMode: "coordinateTurn",
    useStraightLine: 0,
    waypointTurnDampingDist: 20,
    canvas: point
  };
}

function buildPolygonWaypoints(shape: Shape, startNumber: number): Waypoint[] {
  const bounds = getShapeBounds(shape);
  const width = Math.max(120, bounds.right - bounds.left);
  const height = Math.max(120, bounds.bottom - bounds.top);
  const rows = Math.max(4, Math.round(height / 34));
  const points: Waypoint[] = [];
  let number = startNumber;

  for (let row = 0; row <= rows; row += 1) {
    const y = bounds.top + (height / rows) * row;
    const startX = row % 2 === 0 ? bounds.left : bounds.right;
    const endX = row % 2 === 0 ? bounds.right : bounds.left;
    points.push(buildWaypoint({ x: startX, y }, number, row % 2 === 0 ? 90 : -90, "take-picture"));
    number += 1;
    points.push(buildWaypoint({ x: endX, y }, number, row % 2 === 0 ? 90 : -90, "take-picture"));
    number += 1;
  }

  return points;
}

function buildRectangleWaypoints(shape: Shape, startNumber: number): Waypoint[] {
  return buildPolygonWaypoints(shape, startNumber);
}

function buildCircleWaypoints(shape: Shape, startNumber: number): Waypoint[] {
  const center = shape.center ?? { x: 360, y: 300 };
  const radius = Math.max(26, shape.radius ?? 30);
  const count = 14;

  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const point = {
      x: center.x + Math.cos(angle) * radius * 1.6,
      y: center.y + Math.sin(angle) * radius * 1.6
    };

    return buildWaypoint(point, startNumber + index, Math.round((angle * 180) / Math.PI), "none");
  });
}

export function buildGeneratedWaypoints(shape: Shape, startNumber: number): Waypoint[] {
  if (shape.kind === "circle") {
    return buildCircleWaypoints(shape, startNumber);
  }

  if (shape.kind === "rectangle") {
    return buildRectangleWaypoints(shape, startNumber);
  }

  return buildPolygonWaypoints(shape, startNumber);
}

export function exportMissionPreview(mission: Mission): string {
  return JSON.stringify(
    {
      missionName: mission.name,
      shapes: mission.shapes.map((shape) => ({
        id: shape.id,
        kind: shape.kind
      })),
      waypoints: mission.waypoints.map((waypoint) => ({
        id: waypoint.id,
        latitude: waypoint.latitude,
        longitude: waypoint.longitude,
        altitude: waypoint.altitude,
        speed: waypoint.speed,
        gimbalAngle: waypoint.gimbalAngle,
        heading: waypoint.heading,
        action: waypoint.action,
        turnMode: waypoint.turnMode,
        useStraightLine: waypoint.useStraightLine,
        waypointTurnDampingDist: waypoint.waypointTurnDampingDist
      }))
    },
    null,
    2
  );
}
