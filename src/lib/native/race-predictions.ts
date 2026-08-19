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

/** What the widget can actually see, reported from the app's side of the App Group. */
export interface RacePredictionWidgetStatus {
  /** False means the App Group isn't live on this build: nothing this app writes will ever reach the widget. */
  containerReachable: boolean;
  /** `disconnected` = no container; `empty` = container present but never written; `published` = a payload is there. */
  state: "disconnected" | "empty" | "published";
  /** The status of the stored payload — only when `state` is "published". */
  status?: RacePredictionStatus;
  sampleCount?: number;
  /** ISO 8601. When the app last published, NOT when the athlete last ran. */
  updatedAt?: string;
  headlineLabel?: string;
  headlineSeconds?: number;
  appGroup?: string;
}

interface RacePredictionsPlugin {
  /** `stored` is whether the payload reached the shared container; `containerReachable` is false when the App Groups entitlement isn't live, which no amount of retrying will fix. */
  set(options: RacePredictionPayload): Promise<{ stored: boolean; containerReachable?: boolean }>;
  clear(): Promise<{ cleared: boolean }>;
  /** Added after the widget shipped — an older native build rejects this, which callers treat as "unknown". */
  status(): Promise<RacePredictionWidgetStatus>;
}

const RacePredictions = registerPlugin<RacePredictionsPlugin>("RacePredictions");

/** iOS-only: Android has no WidgetKit equivalent, and the web app has no home screen to put a widget on. */
export function isRacePredictionWidgetSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

export type RacePredictionPublishResult =
  | { published: true }
  | {
      published: false;
      reason:
        /** Not iOS. Expected, not a fault. */
        | "unsupported"
        /** The App Group isn't live on this build. Permanent until signing is fixed. */
        | "disconnected"
        /** Container reachable, write didn't land. Encode fault or defaults failure. */
        | "writeFailed"
        /** The native plugin didn't answer — old build, or the bridge isn't up yet. */
        | "bridgeUnavailable";
    };

/**
 * Best-effort, like the Live Activity bridge: a home-screen widget is a
 * bonus surface, never something the dashboard should block or error on.
 *
 * But best-effort is not the same as unaccountable. This returns WHY it
 * failed, because the three failures are genuinely different and one of them
 * ("disconnected") is invisible from the widget's side in a way that reads
 * to an athlete as "you have never logged a run". A silent boolean false is
 * what let a fully-trained athlete's home screen tell them exactly that.
 */
export async function publishRacePredictions(
  payload: RacePredictionPayload
): Promise<RacePredictionPublishResult> {
  if (!isRacePredictionWidgetSupported()) {
    return { published: false, reason: "unsupported" };
  }
  try {
    const { stored, containerReachable } = await RacePredictions.set(payload);
    if (stored) return { published: true };
    // `containerReachable` is absent on a native build older than this
    // field; treat only an explicit `false` as the permanent diagnosis.
    return {
      published: false,
      reason: containerReachable === false ? "disconnected" : "writeFailed",
    };
  } catch {
    return { published: false, reason: "bridgeUnavailable" };
  }
}

/**
 * What the widget would see right now, read from the app's side of the same
 * App Group. Null when there is nothing meaningful to report — off iOS, or
 * on a native build that predates the `status` method.
 *
 * This exists so "why is my widget empty?" is answerable by the athlete
 * looking at Settings, rather than only by someone with Xcode attached.
 */
export async function getRacePredictionWidgetStatus(): Promise<RacePredictionWidgetStatus | null> {
  if (!isRacePredictionWidgetSupported()) return null;
  try {
    return await RacePredictions.status();
  } catch {
    return null;
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
