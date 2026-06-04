import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

const SETTINGS_KEY = "wm_dji_upload_v1";

export type DjiUploadSettings = {
  enabled: boolean;
  /** Directory where DJI Pilot reads KMZ missions */
  djiDir: string;
  /** If true, overwrite the same filename each time for DJI Pilot to auto-detect */
  fixedFilename: string | null;
};

const DJI_RC_PRO_DEFAULTS: Record<string, string> = {
  default: "/sdcard/DJI/",
  "dji.go.v5": "/sdcard/Android/data/dji.go.v5/files/waypoint/",
  fly: "/sdcard/Android/data/dji.go.v5/files/wayline/",
};

export function getDefaultDjiDir(): string {
  return DJI_RC_PRO_DEFAULTS.default;
}

export function getDjiDirPresets(): Array<{ label: string; value: string }> {
  return Object.entries(DJI_RC_PRO_DEFAULTS).map(([key, value]) => ({
    label: key === "default" ? "DJI Pilot 2 (SD Card)" : key === "dji.go.v5" ? "DJI Pilot 2 (Internal)" : "DJI Fly (Internal)",
    value,
  }));
}

export function loadDjiSettings(): DjiUploadSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SETTINGS_KEY) : null;
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, djiDir: getDefaultDjiDir(), fixedFilename: null };
}

export function saveDjiSettings(s: DjiUploadSettings) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
  } catch {}
}

/**
 * Save a KMZ blob to the DJI mission directory.
 * Returns the full path written, or null on failure.
 */
export async function uploadKmzToDji(
  blob: Blob,
  missionName: string,
  settings: DjiUploadSettings
): Promise<string | null> {
  if (Platform.OS !== "android") return null;

  // Convert blob → base64
  const base64 = await blobToBase64(blob);
  if (!base64) return null;

  // Ensure directory exists
  const dir = settings.djiDir.endsWith("/") ? settings.djiDir : settings.djiDir + "/";
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } catch {
      return null;
    }
  }

  const safeName = missionName.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
  const filename = settings.fixedFilename
    ? settings.fixedFilename.endsWith(".kmz") ? settings.fixedFilename : settings.fixedFilename + ".kmz"
    : safeName + ".kmz";
  const filePath = dir + filename;

  try {
    await FileSystem.writeAsStringAsync(filePath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return filePath;
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string | null;
      if (!result) { resolve(null); return; }
      // Strip data:application/...;base64, prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
