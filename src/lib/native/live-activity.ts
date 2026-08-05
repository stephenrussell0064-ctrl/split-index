import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

export type LiveActivityMode = "gpsTracking" | "gymTimer";

/**
 * Deliberately date-driven, not a plain elapsed-seconds counter: the widget
 * renders `startDateEpochMs` via SwiftUI's native `Text(_:style:.timer)`,
 * which keeps ticking correctly on the OS side with zero further app
 * involvement — the previous "push a fresh elapsedSeconds every second"
 * design froze the lock-screen card the moment iOS suspended the
 * WebView's JS timers (screen lock, backgrounding), which is exactly the
 * "gets stuck" bug this replaces. See gym-workout-timer.tsx for how the web
 * UI's own clock uses this same reference-date approach so it can't drift
 * either.
 */
export interface LiveActivityState {
  /** Epoch ms the native timer ticks from while running. For a fresh start this is the real start time; on resume-from-pause it should be `Date.now() - pausedElapsedMs` so the display picks back up where it left off. Ignored while isPaused. */
  startDateEpochMs: number;
  /** Gym timer only — true freezes the displayed clock at pausedElapsedSeconds instead of ticking. GPS tracking never pauses. */
  isPaused?: boolean;
  /** Gym timer only — the frozen total (seconds) to show while isPaused. */
  pausedElapsedSeconds?: number;
  /** GPS tracking only. */
  distanceKm?: number;
  /** GPS tracking only — e.g. "5:30/km" or "12.4 km/h". */
  paceOrSpeedText?: string;
  /** GPS tracking only, when a heart-rate source is connected. */
  heartRateBpm?: number;
  /** Gym timer only — epoch ms a rest countdown ends at; omit when no rest is active. Rendered as a native countdown (SwiftUI counts DOWN when given a future date), so it survives the app being backgrounded too. */
  restEndDateEpochMs?: number;
  /** Best-effort hint — the widget re-derives "done" from restEndDateEpochMs vs. its own clock too, so a rest that finished while backgrounded reads correctly without waiting for this. */
  restDone?: boolean;
}

/** What LiveActivityPlugin.getState() resolves to — mirrors LiveActivityState's gym-timer fields (GPS tracking never needs to read this back, since it has no interactive controls). `found: false` means no Live Activity is currently running. */
export type LiveActivitySnapshot =
  | { found: false }
  | {
      found: true;
      startDateEpochMs: number;
      isPaused: boolean;
      pausedElapsedSeconds: number;
      restEndDateEpochMs?: number;
      restDone: boolean;
    };

interface LiveActivityPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(options: { mode: LiveActivityMode; title: string } & LiveActivityState): Promise<{ started: boolean }>;
  update(options: LiveActivityState): Promise<{ updated: boolean }>;
  end(): Promise<{ ended: boolean }>;
  getState(): Promise<LiveActivitySnapshot>;
}

/**
 * Backed by ios/App/App/LiveActivityPlugin.swift — same local-plugin
 * pattern as the other Split Index-specific native plugins (registered
 * explicitly in MainViewController's capacitorDidLoad()). Android has no
 * Live Activities equivalent, so this is iOS-only.
 *
 * Every call here is best-effort: a Live Activity is a lock-screen bonus,
 * never something the GPS run or gym timer flow should block or show an
 * error for if it fails (older iOS, Live Activities disabled in Settings,
 * etc.) — failures are swallowed rather than thrown.
 */
const LiveActivity = registerPlugin<LiveActivityPlugin>("LiveActivity");

let active = false;

/** True only on iOS — no Android implementation yet. Doesn't guarantee the OS itself supports/allows Live Activities; call startLiveActivity and let it no-op silently if not. */
export function isLiveActivitySupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

export async function startLiveActivity(
  mode: LiveActivityMode,
  title: string,
  initial: LiveActivityState
): Promise<void> {
  try {
    const { available } = await LiveActivity.isAvailable();
    if (!available) return;
    await LiveActivity.start({ mode, title, ...initial });
    active = true;
  } catch {
    // Best-effort — no lock-screen card is a cosmetic miss, not a failure.
  }
}

export async function updateLiveActivity(state: LiveActivityState): Promise<void> {
  if (!active) return;
  try {
    await LiveActivity.update(state);
  } catch {
    // Best-effort.
  }
}

export async function endLiveActivity(): Promise<void> {
  if (!active) return;
  active = false;
  try {
    await LiveActivity.end();
  } catch {
    // Best-effort.
  }
}

/**
 * Pulls the Live Activity's current state back from the OS — the other
 * half of the interactive lock-screen buttons (Pause/Resume, Add Rest;
 * see GymTimerIntents.swift): those run in the widget extension's own
 * process and mutate the Activity directly, with no way to call back into
 * this already-running app, so the gym timer screen calls this on resume
 * (visibilitychange/focus) to catch up rather than silently drifting out
 * of sync with whatever the lock screen last did. Returns `{ found: false }`
 * rather than throwing when nothing's running or this isn't supported —
 * a routine, expected case, not an error.
 */
export async function getLiveActivityState(): Promise<LiveActivitySnapshot> {
  if (!active) return { found: false };
  try {
    return await LiveActivity.getState();
  } catch {
    return { found: false };
  }
}
