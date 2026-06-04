import {
  fromCoordinate,
  getShapeBounds,
  toCoordinate,
  type Shape,
  type Waypoint,
  type WaypointAction
} from "../domain/mission";

export type GenerationSettings = {
  allPointsAction: WaypointAction;
  altitude: number;
  boundsType: string;
  distance: number;
  generateAllPoints: boolean;
  gimbalAngle: number;
  interval: number;
  lineAngleDegrees: number;
  lineAngleMode: "preset" | "presetNS" | "manual";
  lineOrientation: "0" | "1";
  maintainAlt: boolean;
  overlap: number;
  pass: string;
  flipPath: boolean;
  speed: number;
  straightenLines: boolean;
  turnMode: string;
  units: "0" | "1";
};

type ServerPoint = {
  Latitude: number;
  Longitude: number;
  action?: string;
  altitude?: number;
  gimbalAngle?: number;
  heading?: number;
  id?: number | string;
  speed?: number;
  turnMode?: string;
  useStraightLine?: number;
  waypointTurnDampingDist?: number;
};

type SerializedShape = {
  bounds: string;
  boundsType: "circle" | "polygon";
};

const DEFAULT_API_BASE_URL = "http://localhost:8088";

export async function generateWaypointsViaContract(input: {
  apiBaseUrl?: string;
  settings: GenerationSettings;
  shapes: Shape[];
  startingIndex: number;
}): Promise<Waypoint[]> {
  const nextWaypoints: Waypoint[] = [];
  let waypointNumber = input.startingIndex;

  for (const shape of input.shapes) {
    const serialized = serializeShape(shape);
    const body = buildGenerationRequestBody({
      serialized,
      settings: input.settings,
      startingIndex: waypointNumber
    });
    const response = await fetch(`${resolveApiBaseUrl(input.apiBaseUrl)}/Home/GeneratePoints`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GeneratePoints failed: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as ServerPoint[];

    for (const point of payload) {
      nextWaypoints.push(mapServerPointToWaypoint(point, waypointNumber));
      waypointNumber += 1;
    }
  }

  return nextWaypoints;
}

function resolveApiBaseUrl(apiBaseUrl?: string) {
  return apiBaseUrl ?? process.env.EXPO_PUBLIC_WAYPOINTMAP_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function buildGenerationRequestBody(input: {
  serialized: SerializedShape;
  settings: GenerationSettings;
  startingIndex: number;
}) {
  const data = new URLSearchParams();
  const normalizedLineAngle = normalizeLineAngle(
    input.settings.lineAngleMode,
    input.settings.lineOrientation
  );
  const derivedTurnMode = input.settings.straightenLines
    ? "toPointAndStopWithDiscontinuityCurvature"
    : input.settings.turnMode;

  data.set("bounds", input.serialized.bounds);
  data.set("boundsType", input.settings.boundsType || input.serialized.boundsType);
  data.set("in_startingIndex", String(input.startingIndex));
  data.set("in_units", input.settings.units);
  data.set("altitude", String(input.settings.altitude));
  data.set("speed", String(input.settings.speed));
  data.set("in_distance", String(input.settings.distance));
  data.set("in_overlap", String(input.settings.overlap));
  data.set("in_interval", String(input.settings.interval));
  data.set("angle", String(input.settings.gimbalAngle));
  data.set("in_lineAngleMode", normalizedLineAngle.mode);
  data.set("in_lineOrientation", normalizedLineAngle.orientation);
  data.set("in_lineAngleDegrees", String(input.settings.lineAngleDegrees));
  data.set("in_turnMode", derivedTurnMode);
  data.set("in_straightenLines", input.settings.straightenLines ? "true" : "false");
  data.set("in_generateAllPoints", input.settings.generateAllPoints ? "true" : "false");
  data.set("in_allPointsAction", normalizeActionForServer(input.settings.allPointsAction));
  data.set("maintainAlt", input.settings.maintainAlt ? "true" : "false");
  data.set("in_flipPath", input.settings.flipPath ? "true" : "false");
  data.set("pass", input.settings.pass);

  return data.toString();
}

function normalizeLineAngle(
  mode: GenerationSettings["lineAngleMode"],
  orientation: GenerationSettings["lineOrientation"]
) {
  if (mode === "presetNS") {
    return { mode: "preset", orientation: "1" };
  }

  if (mode === "manual") {
    return { mode: "manual", orientation };
  }

  return { mode: "preset", orientation: "0" };
}

function normalizeActionForServer(action: WaypointAction) {
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

function normalizeActionFromServer(action?: string): WaypointAction {
  switch (action) {
    case "take-picture":
    case "takePicture":
      return "take-picture";
    case "start-recording":
    case "startRecording":
      return "start-recording";
    case "stop-recording":
    case "stopRecording":
      return "stop-recording";
    default:
      return "none";
  }
}

function serializeShape(shape: Shape): SerializedShape {
  if (shape.kind === "circle") {
    const center = shape.center ?? { x: 360, y: 300 };
    const coordinates = toCoordinate(center);
    return {
      bounds: `${coordinates.latitude},${coordinates.longitude}`,
      boundsType: "circle"
    };
  }

  if (shape.kind === "rectangle") {
    const bounds = getShapeBounds(shape);
    const points = [
      toCoordinate({ x: bounds.left, y: bounds.top }),
      toCoordinate({ x: bounds.right, y: bounds.top }),
      toCoordinate({ x: bounds.right, y: bounds.bottom }),
      toCoordinate({ x: bounds.left, y: bounds.bottom })
    ];

    return {
      bounds: points.map((point) => `${point.latitude},${point.longitude}`).join("|"),
      boundsType: "polygon"
    };
  }

  const points = (shape.points ?? []).map((point) => toCoordinate(point));
  return {
    bounds: points.map((point) => `${point.latitude},${point.longitude}`).join("|"),
    boundsType: "polygon"
  };
}

function mapServerPointToWaypoint(point: ServerPoint, number: number): Waypoint {
  const canvas = fromCoordinate(point.Latitude, point.Longitude);

  return {
    id: String(point.id ?? `wp-${number}`),
    number,
    latitude: point.Latitude,
    longitude: point.Longitude,
    altitude: Number.isFinite(Number(point.altitude)) ? Number(point.altitude) : 60,
    speed: Number.isFinite(Number(point.speed)) ? Number(point.speed) : 3.5,
    gimbalAngle: Number.isFinite(Number(point.gimbalAngle)) ? Number(point.gimbalAngle) : -45,
    heading: Number.isFinite(Number(point.heading)) ? Number(point.heading) : 0,
    action: normalizeActionFromServer(point.action),
    turnMode: point.turnMode ?? "coordinateTurn",
    useStraightLine: Number.isFinite(Number(point.useStraightLine)) ? Number(point.useStraightLine) : 0,
    waypointTurnDampingDist: Number.isFinite(Number(point.waypointTurnDampingDist))
      ? Number(point.waypointTurnDampingDist)
      : 20,
    canvas
  };
}
