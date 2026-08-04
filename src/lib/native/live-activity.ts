import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

export type LiveActivityMode = "gpsTracking" | "gymTimer";

export interface LiveActivityState {
  elapsedSeconds: number;
  /** GPS tracking only. */
  distanceKm?: number;
  /** GPS tracking only — e.g. "5:30/km" or "12.4 km/h". */
  paceOrSpeedText?: string;
  /** GPS tracking only, when a heart-rate source is connected. */
  heartRateBpm?: number;
  /** Gym timer only. */
  restRemainingSeconds?: number;
  /** Gym timer only. */
  restDone?: boolean;
}

interface LiveActivityPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(options: { mode: LiveActivityMode; title: string } & LiveActivityState): Promise<{ started: boolean }>;
  update(options: LiveActivityState): Promise<{ updated: boolean }>;
  end(): Promise<{ ended: boolean }>;
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
