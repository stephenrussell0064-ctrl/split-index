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

/**
 * Serializes every read-modify-write of the stored session.
 *
 * Measured, not theorised: firing ten fixes into the watcher callback without
 * yielding between them persisted ONE of them. Each callback read the record,
 * appended its own point, and wrote the whole thing back, so ten reads of the
 * same starting value produced ten writes of "start + one point" and the last
 * one won. The live HUD reads React state, which never loses a point, so the
 * screen said 0.72km while storage held 0.00km — and storage is what the saved
 * activity is built from.
 *
 * Real fixes arrive about a second apart, which is why this survived to here.
 * But the window is a whole Preferences round-trip, it widens as the point
 * array grows (a long run serializes hundreds of kilobytes on every single
 * fix), and pauseGpsSession/resumeGpsSession race the watcher over the exact
 * same record — a pause losing that race is silently un-paused in storage.
 * Every mutation goes through here so the read and the write it is based on
 * can't be split by another mutation.
 */
let sessionMutations: Promise<unknown> = Promise.resolve();

function withSessionLock<T>(mutate: () => Promise<T>): Promise<T> {
  const run = sessionMutations.then(mutate, mutate);
  // The queue itself must never reject, or every later mutation inherits the
  // rejection and the rest of the run stops being recorded.
  sessionMutations = run.then(
    () => undefined,
    () => undefined
  );
  return run;
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
  await attachWatcher(onPoint);
  return { active: true };
}

/**
 * Attaches the native watcher to whatever session is currently persisted, and
 * records its id so it can be torn down later. Shared by a fresh start and by
 * `rejoinGpsSession`, which needs exactly the same watcher over a session
 * record it did not create.
 */
async function attachWatcher(onPoint?: (point: GpsPoint) => void): Promise<void> {
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
          await withSessionLock(async () => {
            const current = await readSession();
            if (current) await writeSession({ ...current, permissionRevoked: true });
          });
        }
        return;
      }
      if (!position) return;

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
      const stored = await withSessionLock(async () => {
        const current = await readSession();
        if (!current) return false;
        await writeSession({ ...current, points: [...current.points, point] });
        return true;
      });
      if (stored) onPoint?.(point);
    }
  );

  await Preferences.set({ key: WATCHER_ID_KEY, value: watcherId });
}

/** Best-effort teardown of the watcher this session recorded. Safe to call when there isn't one. */
async function detachWatcher(): Promise<void> {
  const { value: watcherId } = await Preferences.get({ key: WATCHER_ID_KEY });
  if (!watcherId) return;
  try {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  } catch {
    // A watcher the OS already tore down (app killed, permission pulled) throws
    // here. Nothing to clean up in that case, and it must not stop the caller.
  }
}

/**
 * Picks a still-live run back up after the WebView was reloaded underneath it —
 * the app being killed and reopened, or, far more often, iOS discarding and
 * re-creating the WKWebView while the app sat in the background. The native
 * shell loads a remote URL (see capacitor.config.ts), so that reload drops the
 * entire JS context: React state, the watcher's callback, everything.
 *
 * Everything already recorded is handed back in and re-persisted, so the run
 * keeps its start time, its fixes and its pauses. A fresh watcher is attached
 * because the old one's callback belonged to the JS context that just died —
 * it can never deliver another fix, whether or not the native side still holds
 * it.
 */
export async function rejoinGpsSession(
  session: { points: GpsPoint[]; pauses: PauseInterval[]; startedAt: number; permissionRevoked?: boolean },
  onPoint?: (point: GpsPoint) => void
): Promise<GpsSessionHandle> {
  await writeSession({
    points: session.points,
    startedAt: session.startedAt,
    permissionRevoked: session.permissionRevoked ?? false,
    pauses: session.pauses,
  });
  await attachWatcher(onPoint);
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
  return withSessionLock(async () => {
    const session = await readSession();
    if (!session) return;
    const pauses = session.pauses ?? [];
    // Idempotent — a double-tap must not stack two open pauses.
    if (pauses.some((p) => p.endTime === null)) return;
    await writeSession({ ...session, pauses: [...pauses, { startTime: at, endTime: null }] });
  });
}

/** Closes the open pause. No-op if nothing is paused, so a stray resume can't corrupt the record. */
export async function resumeGpsSession(at: number = Date.now()): Promise<void> {
  return withSessionLock(async () => {
    const session = await readSession();
    if (!session) return;
    const pauses = session.pauses ?? [];
    const openIndex = pauses.findIndex((p) => p.endTime === null);
    if (openIndex === -1) return;
    const next = [...pauses];
    next[openIndex] = { ...next[openIndex], endTime: at };
    await writeSession({ ...session, pauses: next });
  });
}

/** Ends the session the user actually stopped themselves — the one path where `endedCleanly: true` is honest. */
export async function stopGpsSession(): Promise<GpsTrackSummary> {
  await detachWatcher();

  const session = await withSessionLock(async () => {
    const current = await readSession();
    await clearSession();
    return current;
  });

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
  /**
   * The pauses exactly as they were stored, with a pause left open by the
   * interruption still open. Only for `rejoinGpsSession` — a run picked back up
   * was never interrupted at all from the athlete's point of view, so the pause
   * they opened is still the pause they are standing in, and it closes when
   * they press Resume. `pauses` above is the same list closed off at the last
   * fix, which is the honest reading for a run that is being saved rather than
   * continued.
   */
  livePauses: PauseInterval[];
  /** The real start of the run, so a rejoin keeps its original clock instead of restarting at zero. */
  startedAt: number;
  /** True when the interruption caught the run mid-pause — the athlete comes back to a paused run, not a running one. */
  wasPaused: boolean;
  /**
   * True when this looks like a run still in progress rather than a relic.
   *
   * THE BUG THIS EXISTS FOR. The athlete reported, twice, that pausing a GPS
   * run "only stops the run permanently". Pause and Resume themselves work.
   * What kills the run is this function: it treated ANY stored session as a
   * corpse, so pausing, pocketing the phone and coming back gave them the
   * idle screen with a "run that didn't stop normally" banner offering exactly
   * two things — save it as a partial effort, or bin it. There was no way back
   * into the run.
   *
   * The native shell loads a remote URL (capacitor.config.ts), so the entire
   * JS context is thrown away whenever iOS decides to re-create the WKWebView
   * behind a backgrounded app. A pause is the likeliest moment for that: it is
   * precisely when the athlete stops looking at the screen, and with nothing
   * moving there are no fixes arriving to keep anything warm.
   *
   * Honesty is not lost by offering to continue. Whether a rejoined run counts
   * as a complete effort is still decided at save time by the gaps between its
   * fixes: a genuine interruption leaves a hole and still saves as partial,
   * while a pause leaves no hole because paused time is excluded from the gap
   * (see summarizeGpsTrack). So the only thing this flag decides is whether
   * the athlete is offered the choice at all.
   */
  resumable: boolean;
}

/**
 * How stale a stored session may be and still be offered as "pick this back
 * up". Long enough to cover a real stop — a cafe, a physio, waiting out rain —
 * because a paused run produces no fixes at all and would otherwise age out
 * while the athlete is doing exactly what pause is for. Short enough that a run
 * forgotten overnight is not resurrected the next morning as if it were live.
 */
const RESUMABLE_WITHIN_MS = 3 * 60 * 60 * 1000;

/**
 * Call once on app launch (before offering to start a new run). If a
 * session was left running — the app got killed mid-run rather than the
 * user pressing stop, the WebView was reloaded underneath a live run, or it
 * was recorded entirely offline via offline-track.html — this returns its
 * summary AND its raw points, and clears the stored session, so the
 * interrupted/offline run surfaces to the user with its actual map, right
 * away, instead of silently disappearing or showing only a number.
 *
 * The stored record is cleared here even when the session is resumable:
 * `rejoinGpsSession` writes it straight back from the points returned here, so
 * nothing is lost, and a session that somehow cannot be handled can never wedge
 * the app by surviving every launch.
 */
export async function recoverOrphanedSession(): Promise<RecoveredGpsSession | null> {
  if (!isNativePlatform()) return null;

  const session = await withSessionLock(async () => {
    const current = await readSession();
    if (current) {
      // The watcher recorded against this session belongs to a JS context that
      // no longer exists, so it can never deliver another fix — but on iOS the
      // native half can outlive the WebView and keep the location subscription
      // (and its battery cost) alive with nobody listening. Tear it down before
      // its id goes with the cleared session.
      await detachWatcher();
      await clearSession();
    }
    return current;
  });
  if (!session) return null;

  if (session.points.length === 0) return null;

  const livePauses = session.pauses ?? [];
  // An app killed mid-pause leaves that pause open; for a run being SAVED it
  // can only have lasted until the last fix that was actually recorded, so that
  // is where it ends.
  const lastPointTime = session.points[session.points.length - 1].time;
  const pauses = closeOpenPauses(livePauses, lastPointTime);
  const wasPaused = livePauses.some((p) => p.endTime === null);

  // While paused there are no fixes, so the last fix is not evidence of age —
  // the moment the athlete pressed pause is.
  const lastActivityAt = Math.max(
    lastPointTime,
    ...livePauses.map((p) => p.endTime ?? p.startTime)
  );

  return {
    summary: summarizeGpsTrack(session.points, {
      endedCleanly: false,
      permissionRevoked: session.permissionRevoked,
      pauses,
    }),
    points: session.points,
    pauses,
    livePauses,
    startedAt: session.startedAt,
    wasPaused,
    resumable: !session.permissionRevoked && Date.now() - lastActivityAt <= RESUMABLE_WITHIN_MS,
  };
}
