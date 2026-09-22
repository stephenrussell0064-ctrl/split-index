import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DailyTrainingPayload } from "./daily-training";

const bridge = {
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
};

vi.mock("@capacitor/core", () => ({ registerPlugin: () => bridge }));
const native = { value: true };
vi.mock("./platform", () => ({
  isNativePlatform: () => native.value,
  getNativePlatform: () => "ios",
}));

const { syncTrainingReminders, getReminderPermission } = await import("./local-reminders");

/** A day the plan actually prescribes something on. */
function session(date: string, title = "Lower", detail = "Deadlift 4x6-10") {
  return {
    date,
    isRest: false,
    weekLabel: "Week 1 · Base",
    totalMinutes: 66,
    sessions: [
      { title, detail, domain: "strength" as const, minutes: 66, isQuality: false },
    ],
  };
}

function ready(days: DailyTrainingPayload["days"]): DailyTrainingPayload {
  return { status: "ready", days };
}

const NOW = new Date(2026, 8, 22, 12, 0, 0); // Tue 22 Sep 2026, midday

beforeEach(() => {
  vi.clearAllMocks();
  native.value = true;
  bridge.checkPermissions.mockResolvedValue({ display: "granted" });
  bridge.cancel.mockResolvedValue(undefined);
  bridge.schedule.mockResolvedValue(undefined);
});

describe("permission is never inferred", () => {
  it("reports unavailable rather than denied when the bridge is missing", async () => {
    // A build older than this plugin rejects the call. That is not the athlete
    // saying no, and the settings card renders a button on one and nothing on
    // the other — so the two must not collapse.
    bridge.checkPermissions.mockRejectedValue(new Error("not implemented"));
    await expect(getReminderPermission()).resolves.toBe("unavailable");
  });

  it("schedules nothing, and prompts nothing, when permission has not been given", async () => {
    bridge.checkPermissions.mockResolvedValue({ display: "prompt" });
    const result = await syncTrainingReminders(ready([session("2026-09-23")]), { now: NOW });

    expect(result).toEqual({ scheduled: 0, reason: "notPermitted" });
    // The one-shot iOS prompt must never be spent by a background sync.
    expect(bridge.requestPermissions).not.toHaveBeenCalled();
    expect(bridge.schedule).not.toHaveBeenCalled();
  });
});

describe("what gets scheduled", () => {
  it("skips rest days and fires at the configured local hour", async () => {
    const payload = ready([
      session("2026-09-23"),
      { date: "2026-09-24", isRest: true, restReason: "Rest", weekLabel: "Week 1 · Base", totalMinutes: 0, sessions: [] },
      session("2026-09-25", "Long run", "90 min easy"),
    ]);

    const result = await syncTrainingReminders(payload, { now: NOW, hour: 8 });

    expect(result).toEqual({ scheduled: 2 });
    const scheduled = bridge.schedule.mock.calls[0]![0].notifications;
    expect(scheduled.map((n: { title: string }) => n.title)).toEqual(["Lower", "Long run"]);
    expect(scheduled[0].schedule.at).toEqual(new Date(2026, 8, 23, 8, 0, 0, 0));
  });

  it("drops a fire time that has already passed", async () => {
    // iOS delivers a past-dated local notification immediately. Scheduling
    // today's 08:00 reminder at midday would fire it on the spot.
    const result = await syncTrainingReminders(ready([session("2026-09-22")]), {
      now: NOW,
      hour: 8,
    });

    expect(result).toEqual({ scheduled: 0, reason: "nothingToSchedule" });
    expect(bridge.schedule).not.toHaveBeenCalled();
  });

  it("clears reminders when the block has ended, rather than leaving them", async () => {
    // The failure this exists to prevent: a withdrawn plan whose 08:00
    // reminder still fires tomorrow for a session that no longer exists.
    const result = await syncTrainingReminders({ status: "betweenBlocks" }, { now: NOW });

    expect(result).toEqual({ scheduled: 0, reason: "noPlan" });
    expect(bridge.cancel).toHaveBeenCalled();
    expect(bridge.schedule).not.toHaveBeenCalled();
  });

  it("names the count when a day has more than one session", async () => {
    const twoSessions = {
      ...session("2026-09-23"),
      sessions: [
        { title: "Lower", detail: "Deadlift", domain: "strength" as const, minutes: 60, isQuality: false },
        { title: "Easy run", detail: "40 min", domain: "endurance" as const, minutes: 40, isQuality: false },
      ],
    };
    await syncTrainingReminders(ready([twoSessions]), { now: NOW, hour: 8 });

    const [first] = bridge.schedule.mock.calls[0]![0].notifications;
    expect(first.title).toBe("2 sessions today");
    expect(first.body).toBe("Lower · Easy run");
  });
});

describe("off the native shell", () => {
  it("does nothing at all on web", async () => {
    native.value = false;
    const result = await syncTrainingReminders(ready([session("2026-09-23")]), { now: NOW });

    expect(result).toEqual({ scheduled: 0, reason: "unsupported" });
    expect(bridge.cancel).not.toHaveBeenCalled();
    expect(bridge.checkPermissions).not.toHaveBeenCalled();
  });
});
