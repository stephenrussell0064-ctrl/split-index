import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

/**
 * Feeds the iOS home-screen widget that answers "what am I doing today"
 * (ios/App/SplitIndexWidgets/DailyTrainingWidget.swift).
 *
 * A widget extension is its own process: no WebView, no Supabase session, no
 * way to fetch a plan. So the days have to be pushed to it from here — the app
 * writes whatever the hybrid-plan screen just rendered into a shared App Group
 * container, and the widget renders whichever of those days is today. Backed
 * by ios/App/App/DailyTrainingPlugin.swift, registered by hand in
 * MainViewController.capacitorDidLoad() like the other Split Index-specific
 * plugins.
 *
 * THE PAYLOAD IS A STATE, NOT A SESSION, and that is the whole point. This app
 * once shipped a hardcoded 25:00 race prediction that an athlete read as real
 * for a week. A widget has no room for a caveat and no way to ask a question,
 * so "we have no plan for you", "your block has ended" and "today is a rest
 * day" all have to be representable, distinctly from each other and from a
 * real session — otherwise the empty case inevitably gets rendered as
 * something plausible.
 *
 * WHY AN ARRAY OF DAYS RATHER THAN JUST TODAY'S: the app cannot be relied on
 * to be running at midnight. Publishing several days lets the widget build a
 * WidgetKit timeline with an entry per local midnight and roll over on its
 * own. See the note on `getTimeline` in DailyTrainingWidget.swift.
 *
 * ADDITIVE ONLY. The web app is served over the network to a native shell the
 * athlete installs separately, so the deployed JS is routinely newer than the
 * binary on the phone. Every field the Swift side reads is optional there;
 * anything added here in future must be a new optional sibling, never a
 * rename or a re-nesting of what already exists, or an older binary will
 * misread good data — the mistake the strength half of the race widget was
 * carefully built to avoid.
 */

export type DailyTrainingStatus =
  /** A real plan exists and `days` covers at least today. */
  | "ready"
  /** The engine has not built a plan — missing intake, paused rollout, tier gate. */
  | "noPlan"
  /** A plan exists but today is outside its dates. A different problem from `noPlan`, and a different answer. */
  | "betweenBlocks";

export interface DailyTrainingSessionPayload {
  /** What the athlete calls it — "Long run", "Legs". Never an engine key like `bench_volume`. */
  title: string;
  /** The one line saying what to do. Trimmed here, not natively, so the app and the widget can't word it differently. */
  detail: string;
  /** "AM" / "PM". Omit when the plan did not slot it. */
  slot?: string;
  domain: "endurance" | "strength";
  minutes: number;
  isQuality: boolean;
}

export interface DailyTrainingDayPayload {
  /** Local calendar date, "yyyy-MM-dd". Date-only on purpose: an instant serialised through UTC slips across midnight. */
  date: string;
  /** True is a real prescription, not an absence. A rest day renders as a rest day. */
  isRest: boolean;
  /** Why the day is clear. Present on a rest day. */
  restReason?: string;
  /** "Week 3 · Build". */
  weekLabel: string;
  totalMinutes: number;
  sessions: DailyTrainingSessionPayload[];
}

export interface DailyTrainingPayload {
  status: DailyTrainingStatus;
  /** Today first, then the following days. Required when status is "ready", omitted otherwise. */
  days?: DailyTrainingDayPayload[];
  /** Short title for a non-ready state, e.g. "No plan yet". */
  headline?: string;
  /** One concrete next step for a non-ready state. */
  message?: string;
}

/** What the widget can actually see, reported from the app's side of the App Group. */
export interface DailyTrainingWidgetStatus {
  /** False means the App Group isn't live on this build: nothing this app writes will ever reach the widget. */
  containerReachable: boolean;
  state: "disconnected" | "empty" | "published";
  status?: DailyTrainingStatus;
  dayCount?: number;
  /** Whether the stored payload still reaches today — the one fact that decides whether the widget shows anything. */
  coversToday?: boolean;
  firstDay?: string;
  lastDay?: string;
  /** ISO 8601. When the app last published, NOT when the athlete last trained. */
  updatedAt?: string;
  appGroup?: string;
}

interface DailyTrainingPlugin {
  set(options: DailyTrainingPayload): Promise<{ stored: boolean; containerReachable?: boolean }>;
  clear(): Promise<{ cleared: boolean }>;
  status(): Promise<DailyTrainingWidgetStatus>;
}

const DailyTraining = registerPlugin<DailyTrainingPlugin>("DailyTraining");

/** iOS-only: Android has no WidgetKit equivalent, and the web app has no home screen to put a widget on. */
export function isDailyTrainingWidgetSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

export type DailyTrainingPublishResult =
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
        /** The native plugin didn't answer — a build older than this widget, or the bridge isn't up yet. */
        | "bridgeUnavailable";
    };

/**
 * Best-effort, like the race-prediction bridge: a home-screen widget is a
 * bonus surface and must never block or error the plan screen.
 *
 * But best-effort is not unaccountable. The reason comes back because the
 * failures are genuinely different, and one of them ("disconnected") is
 * invisible from the widget's side in a way that reads to an athlete as "you
 * have no plan".
 */
export async function publishDailyTraining(
  payload: DailyTrainingPayload
): Promise<DailyTrainingPublishResult> {
  if (!isDailyTrainingWidgetSupported()) {
    return { published: false, reason: "unsupported" };
  }
  try {
    const { stored, containerReachable } = await DailyTraining.set(payload);
    if (stored) return { published: true };
    // `containerReachable` is absent on a native build older than this field;
    // treat only an explicit `false` as the permanent diagnosis.
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
 * App Group. Null off iOS, or on a native build that predates this plugin.
 */
export async function getDailyTrainingWidgetStatus(): Promise<DailyTrainingWidgetStatus | null> {
  if (!isDailyTrainingWidgetSupported()) return null;
  try {
    return await DailyTraining.status();
  } catch {
    return null;
  }
}

/**
 * Sign-out. Someone else's training block left on a shared phone's home screen
 * is both wrong and a small privacy leak — the widget has no session of its
 * own to expire.
 */
export async function clearDailyTraining(): Promise<void> {
  if (!isDailyTrainingWidgetSupported()) return;
  try {
    await DailyTraining.clear();
  } catch {
    // Best-effort.
  }
}
