import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNativePlatform } from "./platform";

/**
 * Haptics, as a handful of verbs the UI can call without caring about the
 * platform.
 *
 * iOS WebKit has no `navigator.vibrate`, so before this the app had exactly one
 * tactile cue (the gym rest timer) and it fired on Android only. Every call
 * here is a no-op on the web and inside a server render; on the native shell
 * it reaches the Taptic Engine through `@capacitor/haptics`.
 *
 * `tick()` is the one that matters for the typing effect in onboarding: it is
 * the selection-changed click — the lightest feedback iOS has, the one the
 * picker wheel makes — and it is rate-limited here so a 30 ms typewriter
 * cannot ask for it faster than the engine can play it. Callers that type a
 * paragraph should wrap it in `startTicks()` / `stopTicks()`, which on iOS
 * prepares the generator so the first click is not late.
 *
 * Every call swallows its own error. A missing plugin (an older app binary that
 * predates this dependency) must never break the screen it decorates.
 */

const MIN_TICK_GAP_MS = 36;
let lastTickAt = 0;

export function hapticsAvailable(): boolean {
  return typeof window !== "undefined" && isNativePlatform();
}

export async function startTicks(): Promise<void> {
  if (!hapticsAvailable()) return;
  try {
    await Haptics.selectionStart();
  } catch {
    /* no haptics on this build */
  }
}

/** The lightest click there is. Rate-limited; safe to call per character. */
export function tick(now = Date.now()): void {
  if (!hapticsAvailable()) return;
  if (now - lastTickAt < MIN_TICK_GAP_MS) return;
  lastTickAt = now;
  Haptics.selectionChanged().catch(() => {});
}

export async function stopTicks(): Promise<void> {
  if (!hapticsAvailable()) return;
  try {
    await Haptics.selectionEnd();
  } catch {
    /* no haptics on this build */
  }
}

/** A tap acknowledged: Continue, a chip toggled, a step advanced. */
export function impact(style: "light" | "medium" | "heavy" = "light"): void {
  if (!hapticsAvailable()) return;
  const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
  Haptics.impact({ style: map[style] }).catch(() => {});
}

/** Something finished: the profile saved, the tour done. */
export function success(): void {
  if (!hapticsAvailable()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

/** Whether a tick would fire now — exported for the rate-limit test. */
export function shouldTick(now: number, last: number, gap = MIN_TICK_GAP_MS): boolean {
  return now - last >= gap;
}
