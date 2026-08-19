import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

/**
 * Feeds the iOS home-screen race-prediction widget
 * (ios/App/SplitIndexWidgets/RacePredictionWidget.swift).
 *
 * A widget extension is its own process: no WebView, no Supabase session,
 * no way to fetch anything. So the numbers have to be pushed to it from
 * here — the app writes whatever it just rendered into a shared App Group
 * container, and the widget renders that. Backed by
 * ios/App/App/RacePredictionsPlugin.swift, registered by hand in
 * MainViewController.capacitorDidLoad() like the other Split Index-specific
 * plugins.
 *
 * The payload is a STATE, not a bare number, and that is the whole point.
 * This app once shipped a hardcoded 25:00 that an athlete read as a real
 * prediction for a week. A widget has no room for a caveat and no way to
 * ask a question, so "we don't have a prediction for you yet" has to be
 * representable, distinctly from "we do" — otherwise the empty case
 * inevitably gets rendered as 0:00, a dash, or worse, something plausible.
 */

export type RacePredictionStatus =
  /** A real Tier 2 benchmark exists. `headline` is REQUIRED. */
  | "ready"
  /** Runs logged, but the engine won't publish a number yet (tier2IsCalibrating). */
  | "calibrating"
  /** No runs, or nobody signed in. */
  | "noData";

export interface RacePredictionEntry {
  /** As the web app already labels it — "5K", "10K", "Half". Passed rather than re-derived natively so the two can't disagree. */
  label: string;
  /** Real, engine-derived seconds. Never a placeholder; the native side drops any entry that isn't finite and positive. */
  seconds: number;
}

export interface RacePredictionPayload {
  status: RacePredictionStatus;
  /** The 5K — the headline everywhere in this app. Omit unless status is "ready". */
  headline?: RacePredictionEntry;
  /** Longer distances for the medium widget (10K, Half). Optional even when ready. */
  ladder?: RacePredictionEntry[];
  /** Sessions of evidence — the same count Analytics shows. */
  sampleCount?: number;
  /** TIER2_MIN_SAMPLES_TO_DISPLAY; only meaningful while calibrating. */
  samplesNeeded?: number;
}

interface RacePredictionsPlugin {
  /** `stored` is a real read-back from the App Group, not an assumption — false means the entitlement isn't live and the widget will stay empty. */
  set(options: RacePredictionPayload): Promise<{ stored: boolean }>;
  clear(): Promise<{ cleared: boolean }>;
}

const RacePredictions = registerPlugin<RacePredictionsPlugin>("RacePredictions");

/** iOS-only: Android has no WidgetKit equivalent, and the web app has no home screen to put a widget on. */
export function isRacePredictionWidgetSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

/**
 * Best-effort, like the Live Activity bridge: a home-screen widget is a
 * bonus surface, never something the dashboard should block or error on.
 * Returns whether the payload actually reached the shared container, for
 * callers that want to log it — the dashboard doesn't act on it.
 */
export async function publishRacePredictions(
  payload: RacePredictionPayload
): Promise<boolean> {
  if (!isRacePredictionWidgetSupported()) return false;
  try {
    const { stored } = await RacePredictions.set(payload);
    return stored;
  } catch {
    return false;
  }
}

/**
 * Sign-out. Predicted times left on the home screen after the account is
 * gone are both wrong and a small privacy leak on a shared phone — the
 * widget has no session of its own to expire.
 */
export async function clearRacePredictions(): Promise<void> {
  if (!isRacePredictionWidgetSupported()) return;
  try {
    await RacePredictions.clear();
  } catch {
    // Best-effort.
  }
}
