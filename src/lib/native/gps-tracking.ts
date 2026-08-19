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
  type PauseInterval,
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
  /**
   * Optional because the offline fallback page (public/offline-track.html)
   * writes this same record without it, and because sessions persisted before
   * pause existed are still out there waiting to be recovered.
   */
  pauses?: PauseInterval[];
}

async function readSession(): Promise<StoredSession | null> {
  const { value } = await Preferences.get({ key: SESSION_KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredSession;
    return { ...parsed, pauses: Array.isArray(parsed.pauses) ? parsed.pauses : [] };
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
 *
 * `onPoint` fires for every accepted fix, live, so the UI can draw the route
 * on a map as the run happens — it's purely a rendering hook, not the
 * source of truth (Preferences persistence above is), so a missed callback
 * during a brief app suspend never loses data, just a map redraw.
 */
export async function startGpsSession(onPoint?: (point: GpsPoint) => void): Promise<GpsSessionHandle> {
  const startedAt = Date.now();
  await writeSession({ points: [], startedAt, permissionRevoked: false, pauses: [] });

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
        // The device's own estimate of how much to trust that altitude — the
        // difference between a barometer-aided fix and a bare GPS one, and the
        // signal elevationGainMeters() needs to decide how small a climb it is
        // entitled to believe (see gps-track.ts).
        altitudeAccuracy: position.altitudeAccuracy,
        altitude: position.altitude,
        time: position.time ?? Date.now(),
      };
      await writeSession({ ...current, points: [...current.points, point] });
      onPoint?.(point);
    }
  );

  await Preferences.set({ key: WATCHER_ID_KEY, value: watcherId });
  return { active: true };
}

/**
 * Opens a pause. The native watcher is deliberately left running: tearing it
 * down and rebuilding it on resume risks the rebuild failing (permissions
 * changed, plugin error) and silently losing the rest of the run, and losing a
 * recorded run is the worst outcome this feature has. A pause is bookkeeping —
 * fixes that arrive while paused are still persisted, they just don't count
 * toward distance, duration or climb (see gps-track.ts's pause handling).
 *
 * Persisted rather than held in component state so that a pause survives the
 * app being killed mid-pause: recovery then still knows those minutes were
 * standing still, instead of scoring them as the slowest running ever done.
 */
export async function pauseGpsSession(at: number = Date.now()): Promise<void> {
  const session = await readSession();
  if (!session) return;
  const pauses = session.pauses ?? [];
  // Idempotent — a double-tap must not stack two open pauses.
  if (pauses.some((p) => p.endTime === null)) return;
  await writeSession({ ...session, pauses: [...pauses, { startTime: at, endTime: null }] });
}

/** Closes the open pause. No-op if nothing is paused, so a stray resume can't corrupt the record. */
export async function resumeGpsSession(at: number = Date.now()): Promise<void> {
  const session = await readSession();
  if (!session) return;
  const pauses = session.pauses ?? [];
  const openIndex = pauses.findIndex((p) => p.endTime === null);
  if (openIndex === -1) return;
  const next = [...pauses];
  next[openIndex] = { ...next[openIndex], endTime: at };
  await writeSession({ ...session, pauses: next });
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
    // A run stopped while still paused leaves an open pause; closing it here
    // means those final standing-still seconds aren't billed as running.
    pauses: closeOpenPauses(session.pauses ?? []),
  });
}

/** An open pause is closed at `at` so that summarizing never treats "still paused" as "paused until the end of time". */
function closeOpenPauses(pauses: PauseInterval[], at: number = Date.now()): PauseInterval[] {
  return pauses.map((p) => (p.endTime === null ? { ...p, endTime: at } : p));
}

export interface RecoveredGpsSession {
  summary: GpsTrackSummary;
  /** Raw fixes, not just the aggregate summary — user feedback: a recovered
   * session (including one left by the offline-track.html fallback page,
   * which writes to this exact same Preferences shape) used to show only a
   * tiny "we found a run" text banner with no way to see the actual route,
   * even though the real points were sitting right there in storage. */
  points: GpsPoint[];
  /**
   * The session's pauses, with any pause left open by the app-kill already
   * closed. Returned alongside the points because the caller has to be able to
   * reproduce the same moving/paused split the summary was built from — the
   * route it submits must exclude fixes recorded while standing still, exactly
   * as the live path does, and it has no other way to know which those were.
   */
  pauses: PauseInterval[];
}

/**
 * Call once on app launch (before offering to start a new run). If a
 * session was left running — the app got killed mid-run rather than the
 * user pressing stop, or it was recorded entirely offline via
 * offline-track.html — this returns its summary (flagged as partial) AND
 * its raw points, and clears the stored session, so the interrupted/offline
 * run surfaces to the user with its actual map, right away, instead of
 * silently disappearing or showing only a number.
 */
export async function recoverOrphanedSession(): Promise<RecoveredGpsSession | null> {
  if (!isNativePlatform()) return null;

  const session = await readSession();
  if (!session) return null;

  await clearSession();

  if (session.points.length === 0) return null;

  // An app killed mid-pause leaves that pause open; it can only have lasted
  // until the last fix that was actually recorded, so that is where it ends.
  const lastPointTime = session.points[session.points.length - 1].time;
  const pauses = closeOpenPauses(session.pauses ?? [], lastPointTime);

  return {
    summary: summarizeGpsTrack(session.points, {
      endedCleanly: false,
      permissionRevoked: session.permissionRevoked,
      pauses,
    }),
    points: session.points,
    pauses,
  };
}
