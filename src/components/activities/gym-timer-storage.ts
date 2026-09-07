/**
 * Where the gym timer's two clocks live between renders — and between app
 * launches.
 *
 * Split out of gym-workout-timer.tsx so the restore rules can be tested
 * without mounting a React component that reaches for Capacitor.
 *
 * This was sessionStorage, on the reasoning that the timer is ephemeral state
 * and `workout_drafts` already covers the logged sets across a real relaunch.
 * The sets, yes — but not the clock, and iOS reclaims a backgrounded WebView
 * routinely. An athlete forty minutes into a session who takes a call came
 * back to their sets intact and the workout clock at 0:00 — the one number the
 * timer exists to produce, since its whole job is handing an elapsed time to
 * the duration field so nobody has to estimate it afterwards.
 *
 * localStorage costs nothing here because both clocks are anchored to
 * wall-clock epoch timestamps rather than to a counter: what survives is three
 * numbers, and elapsed time is re-derived from `Date.now()` on the next render
 * however long the app was gone.
 *
 * What localStorage does NOT do for free is expire — see MAX_RESTORE_AGE_MS.
 */

const STORAGE_KEY = "split-index-gym-timer";

/**
 * Older than this and a restored timer is not a workout in progress, it is a
 * session someone abandoned. Restoring it would open The Lab with a clock
 * reading nineteen hours and a Live Activity nobody asked for.
 *
 * Twelve hours is past any real gym session, including a long one broken by a
 * meal, and short of "I opened this yesterday".
 */
export const MAX_RESTORE_AGE_MS = 12 * 60 * 60 * 1000;

export interface PersistedTimerState {
  running: boolean;
  pausedElapsedMs: number;
  /** Adjusted epoch ms for the current running segment; null while paused. */
  effectiveStartMs: number | null;
  /** Absolute epoch ms the rest countdown ends at; null when no rest is active. */
  restEndMs: number | null;
  hasLiveActivity: boolean;
  /** When this state was last written. Absent on records saved before the store moved to localStorage. */
  savedAtMs?: number;
}

export function loadPersistedTimerState(now: number = Date.now()): PersistedTimerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as PersistedTimerState;

    // Age is measured from whichever anchor the record has. `savedAtMs` is
    // absent on records written before this moved off sessionStorage, and on
    // those the running clock's own start is the honest fallback.
    const anchor = state.savedAtMs ?? state.effectiveStartMs;
    if (anchor != null && now - anchor > MAX_RESTORE_AGE_MS) {
      clearPersistedGymTimerState();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function persistTimerState(state: PersistedTimerState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, savedAtMs: state.savedAtMs ?? Date.now() })
    );
  } catch {
    // Best-effort — losing persistence just means the next mount starts fresh.
  }
}

/**
 * Exported so activity-form.tsx can clear a just-finished workout's timer on a
 * successful save — otherwise the next fresh workout restores elapsed time
 * from the one that was just submitted.
 */
export function clearPersistedGymTimerState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort — a lost persisted state just means the next mount starts fresh.
  }
}
