import { registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, Location, CallbackError } from "@capacitor-community/background-geolocation";
import { Preferences } from "@capacitor/preferences";

// This plugin ships only type definitions + native (Swift/Java) source, no
// bundled JS glue — registerPlugin is how its own README documents wiring
// it up (the plugin name string must match the native side's @CapacitorPlugin name).
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
import { isNativePlatform } from "./platform";
import {
  GPS_TRACKING_CONFIG,
  summarizeGpsTrack,
  type GpsPoint,
  type GpsTrackSummary,
} from "@/lib/scoring/gps-track";

/**
 * Capacitor-conversion brief, Part 3 — the native half of GPS run tracking.
 * Every accepted fix is persisted to Preferences (survives an app kill,
 * unlike an in-memory array or a WebView's own storage under memory
 * pressure) as it arrives, so a session interrupted mid-run — the OS
 * killing the background process, the user force-quitting, permission
 * getting revoked — can still be recovered and correctly flagged as
 * partial the next time the app opens, rather than silently vanishing or
 * silently being submitted as if it were complete.
 */

const SESSION_KEY = "gps-tracking-session";
const WATCHER_ID_KEY = "gps-tracking-watcher-id";

interface StoredSession {
  points: GpsPoint[];
  startedAt: number;
  permissionRevoked: boolean;
}

async function readSession(): Promise<StoredSession | null> {
  const { value } = await Preferences.get({ key: SESSION_KEY });
  if (!value) return null;
  try {
    return JSON.parse(value) as StoredSession;
  } catch {
    return null;
  }
}

async function writeSession(session: StoredSession): Promise<void> {
  await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
}

async function clearSession(): Promise<void> {
  await Preferences.remove({ key: SESSION_KEY });
  await Preferences.remove({ key: WATCHER_ID_KEY });
}

export interface GpsSessionHandle {
  /** Distinguishes "no GPS session is running" from a real error to the caller. */
  active: boolean;
}

/**
 * Starts a new tracking session. Any previously-persisted session is
 * discarded here — callers are expected to have already recovered/resolved
 * an orphaned session (see `recoverOrphanedSession`) before calling this.
 */
export async function startGpsSession(): Promise<GpsSessionHandle> {
  const startedAt = Date.now();
  await writeSession({ points: [], startedAt, permissionRevoked: false });

  const watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: "Split Index",
      backgroundMessage: "Tracking your run",
      requestPermissions: true,
      distanceFilter: GPS_TRACKING_CONFIG.DISTANCE_FILTER_METERS,
    },
    async (position?: Location, error?: CallbackError) => {
      if (error) {
        if (error.code === "NOT_AUTHORIZED") {
          const current = await readSession();
          if (current) await writeSession({ ...current, permissionRevoked: true });
        }
        return;
      }
      if (!position) return;

      const current = await readSession();
      if (!current) return;

      const point: GpsPoint = {
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
        altitude: position.altitude,
        time: position.time ?? Date.now(),
      };
      await writeSession({ ...current, points: [...current.points, point] });
    }
  );

  await Preferences.set({ key: WATCHER_ID_KEY, value: watcherId });
  return { active: true };
}

/** Ends the session the user actually stopped themselves — the one path where `endedCleanly: true` is honest. */
export async function stopGpsSession(): Promise<GpsTrackSummary> {
  const { value: watcherId } = await Preferences.get({ key: WATCHER_ID_KEY });
  if (watcherId) {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  }

  const session = await readSession();
  await clearSession();

  if (!session) {
    return summarizeGpsTrack([], { endedCleanly: true, permissionRevoked: false });
  }

  return summarizeGpsTrack(session.points, {
    endedCleanly: true,
    permissionRevoked: session.permissionRevoked,
  });
}

/**
 * Call once on app launch (before offering to start a new run). If a
 * session was left running — the app got killed mid-run rather than the
 * user pressing stop — this returns its summary flagged as partial and
 * clears the stored session, so the interrupted run surfaces to the user
 * instead of silently disappearing or silently resuming as if nothing
 * happened.
 */
export async function recoverOrphanedSession(): Promise<GpsTrackSummary | null> {
  if (!isNativePlatform()) return null;

  const session = await readSession();
  if (!session) return null;

  await clearSession();

  if (session.points.length === 0) return null;

  return summarizeGpsTrack(session.points, {
    endedCleanly: false,
    permissionRevoked: session.permissionRevoked,
  });
}
