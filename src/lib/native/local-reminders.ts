import { registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "./platform";
import type { DailyTrainingDayPayload, DailyTrainingPayload } from "./daily-training";

/**
 * On-device reminders for the sessions the plan already prescribes.
 *
 * WHY LOCAL AND NOT PUSH. A reminder is a function of a plan this device has
 * already been handed and a clock this device already has. Sending it from a
 * server would mean an APNs key, a device-token table, a sender, and a
 * delivery failure mode — to say something the phone could work out on its
 * own. Push earns its complexity when the trigger is something the device
 * cannot know: another athlete passing you, a report finishing. Not this.
 *
 * SCHEDULED FROM THE WIDGET PAYLOAD, deliberately. `DailyTrainingPayload` is
 * already computed on the plan screen, already covers several days ahead for
 * exactly the reason that matters here — the app cannot be relied on to be
 * running at midnight — and its `title`/`detail` are already trimmed to the
 * wording the widget shows. Reminders built from any other source would
 * eventually word the same session differently from the home screen, which is
 * the bug the widget's own header warns about.
 *
 * REGISTERED BY NAME rather than imported from @capacitor/local-notifications,
 * the same way DailyTraining and RacePredictions are. The package is a
 * dependency so `npx cap sync` installs the native pod, but the web bundle
 * never imports it: the deployed JS is routinely newer than the binary on the
 * phone, so this code has to run — and do nothing — on a build that has no
 * such plugin. Calling through the bridge makes that the normal path rather
 * than a crash.
 *
 * THIS MODULE NEVER PROMPTS. iOS gives an app exactly one chance to ask for
 * notification permission, and asking on a screen the athlete happened to
 * open spends it at the worst possible moment. Scheduling here is silently
 * skipped until permission already exists; `requestTrainingReminders` is the
 * only thing that asks, and only a deliberate tap reaches it.
 */

type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: PermissionState }>;
  requestPermissions(): Promise<{ display: PermissionState }>;
  schedule(options: {
    notifications: {
      id: number;
      title: string;
      body: string;
      schedule: { at: Date; allowWhileIdle?: boolean };
    }[];
  }): Promise<unknown>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
}

const LocalNotifications = registerPlugin<LocalNotificationsPlugin>("LocalNotifications");

/**
 * Our slice of the notification id space.
 *
 * `cancel` takes explicit ids, so reminders can only be replaced safely if
 * this module can name every id it has ever created without consulting
 * anything. A fixed base plus the day offset does that, and keeps us clear of
 * any other feature that schedules notifications later.
 */
const ID_BASE = 71_000;
/** How many days ahead to schedule. Matches the widget's own look-ahead. */
const HORIZON_DAYS = 7;
/** Local hour to fire on the morning of the session. */
export const DEFAULT_REMINDER_HOUR = 8;

export type ReminderPermission = "granted" | "denied" | "prompt" | "unavailable";

/** Both mobile platforms schedule local notifications; a browser tab has nowhere to put one. */
export function areTrainingRemindersSupported(): boolean {
  return isNativePlatform();
}

/**
 * What the OS currently thinks, without asking it to decide.
 *
 * "unavailable" is not a denial — it is every web render, and every native
 * build older than this plugin. The difference matters to the settings card,
 * which must offer a button in one case and render nothing in the other.
 */
export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!areTrainingRemindersSupported()) return "unavailable";
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted") return "granted";
    if (display === "denied") return "denied";
    return "prompt";
  } catch {
    return "unavailable";
  }
}

/**
 * The one place that asks. Only ever reached from an explicit tap.
 *
 * A second call after a denial is not a second chance — iOS answers from the
 * stored decision without showing anything — so the caller must send the
 * athlete to Settings rather than calling again and hoping.
 */
export async function requestTrainingReminders(): Promise<ReminderPermission> {
  if (!areTrainingRemindersSupported()) return "unavailable";
  try {
    const { display } = await LocalNotifications.requestPermissions();
    if (display === "granted") return "granted";
    if (display === "denied") return "denied";
    return "prompt";
  } catch {
    return "unavailable";
  }
}

export type ReminderSyncResult =
  | { scheduled: number }
  | {
      scheduled: 0;
      reason:
        /** Web, or a build with no such plugin. Expected, not a fault. */
        | "unsupported"
        /** Never asked, or asked and refused. Nothing to do until a tap says otherwise. */
        | "notPermitted"
        /** No plan to remind anybody about — between blocks, or none generated. */
        | "noPlan"
        /** A plan, but nothing left to schedule: every day ahead is rest or already past. */
        | "nothingToSchedule"
        /** The bridge rejected the call. */
        | "failed";
    };

/** One line for the day, worded the way the widget words it. */
function describe(day: DailyTrainingDayPayload): { title: string; body: string } | null {
  if (day.isRest || day.sessions.length === 0) return null;
  if (day.sessions.length === 1) {
    const only = day.sessions[0]!;
    return { title: only.title, body: only.detail };
  }
  return {
    title: `${day.sessions.length} sessions today`,
    body: day.sessions.map((s) => s.title).join(" · "),
  };
}

/** Local wall-clock `hour` on the day named by "yyyy-MM-dd", parsed date-only to avoid a UTC midnight slip. */
function fireTimeFor(date: string, hour: number): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

/**
 * Replace the scheduled reminders with ones matching this plan.
 *
 * Cancel-then-schedule rather than diff: the whole set is at most seven
 * notifications, the plan can change shape underneath it (a deload inserted,
 * a session moved, the block ended), and a stale reminder for a session that
 * no longer exists is precisely the failure that makes someone turn
 * reminders off for good.
 */
export async function syncTrainingReminders(
  payload: DailyTrainingPayload,
  options: { hour?: number; now?: Date } = {}
): Promise<ReminderSyncResult> {
  if (!areTrainingRemindersSupported()) return { scheduled: 0, reason: "unsupported" };
  if ((await getReminderPermission()) !== "granted") {
    return { scheduled: 0, reason: "notPermitted" };
  }

  const hour = options.hour ?? DEFAULT_REMINDER_HOUR;
  const now = options.now ?? new Date();

  const ids = Array.from({ length: HORIZON_DAYS }, (_, i) => ({ id: ID_BASE + i }));

  try {
    // Unconditional: a plan that has ended must clear the reminders it left
    // behind, which is why this runs before the `noPlan` return rather than
    // after it.
    await LocalNotifications.cancel({ notifications: ids });
  } catch {
    return { scheduled: 0, reason: "failed" };
  }

  if (payload.status !== "ready" || !payload.days?.length) {
    return { scheduled: 0, reason: "noPlan" };
  }

  const notifications = payload.days
    .slice(0, HORIZON_DAYS)
    .map((day, i) => {
      const text = describe(day);
      const at = fireTimeFor(day.date, hour);
      // A fire time already past is dropped rather than scheduled: iOS
      // delivers a past-dated local notification immediately, so keeping it
      // would fire "today is Deadlift (volume)" the moment someone opens the
      // app in the evening.
      if (!text || !at || at.getTime() <= now.getTime()) return null;
      return {
        id: ID_BASE + i,
        title: text.title,
        body: text.body,
        schedule: { at, allowWhileIdle: true },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);

  if (notifications.length === 0) return { scheduled: 0, reason: "nothingToSchedule" };

  try {
    await LocalNotifications.schedule({ notifications });
    return { scheduled: notifications.length };
  } catch {
    return { scheduled: 0, reason: "failed" };
  }
}

/** Turn reminders off without touching the OS permission, which only the athlete can revoke. */
export async function clearTrainingReminders(): Promise<boolean> {
  if (!areTrainingRemindersSupported()) return false;
  try {
    await LocalNotifications.cancel({
      notifications: Array.from({ length: HORIZON_DAYS }, (_, i) => ({ id: ID_BASE + i })),
    });
    return true;
  } catch {
    return false;
  }
}
