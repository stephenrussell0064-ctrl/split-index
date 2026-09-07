import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE QUEUE HAD NO WINDOW INTO IT.
 *
 * `getPendingActivityCount` was written, exported and re-exported, and called
 * from nowhere in the app — no badge, no banner, no settings row. An athlete
 * whose run was queued got one toast at save time and then nothing ever again:
 * the logbook does not show queued work, so the run was simply absent, and the
 * only conclusion available to them was that the app had lost it.
 *
 * These pin the two things the banner depends on: an accurate per-owner count,
 * and a signal when it changes. The `storage` event cannot serve as that
 * signal — it fires only in OTHER tabs, and this is a phone app with one tab.
 */

const store = new Map<string, string>();
const listeners = new Map<string, Set<(e: Event) => void>>();

function stubWindow() {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: Event) => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
  });
}

beforeEach(() => {
  store.clear();
  listeners.clear();
  stubWindow();
});

afterEach(() => vi.unstubAllGlobals());

const RUN = { url: "/api/activities", method: "POST" as const, payload: { sport: "running" } };

describe("what the athlete can be told is pending", () => {
  it("counts only their own unsent workouts", async () => {
    // The queue is localStorage, which belongs to the device rather than the
    // account. A shared or handed-down phone must not report someone else's
    // run as yours.
    const { enqueueActivitySubmit, getPendingActivityCount } = await import("./offline-queue");
    enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });
    enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });
    enqueueActivitySubmit({ ...RUN, userId: "athlete-2" });

    expect(getPendingActivityCount("athlete-1")).toBe(2);
    expect(getPendingActivityCount("athlete-2")).toBe(1);
  });

  it("reports nothing when nothing is waiting", async () => {
    const { getPendingActivityCount } = await import("./offline-queue");
    expect(getPendingActivityCount("athlete-1")).toBe(0);
  });
});

describe("knowing when the count changed", () => {
  it("announces a queued workout, so the banner does not have to poll", async () => {
    const { enqueueActivitySubmit, ACTIVITY_QUEUE_CHANGED } = await import("./offline-queue");
    const heard = vi.fn();
    window.addEventListener(ACTIVITY_QUEUE_CHANGED, heard);

    enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("announces one leaving the queue too", async () => {
    const { enqueueActivitySubmit, removeQueuedActivity, ACTIVITY_QUEUE_CHANGED } =
      await import("./offline-queue");
    const item = enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });
    const heard = vi.fn();
    window.addEventListener(ACTIVITY_QUEUE_CHANGED, heard);

    removeQueuedActivity(item.id);

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not let a listener that throws break the save path", async () => {
    // The write already happened; a broken subscriber is not a reason to
    // report a failed save to someone whose workout is safely queued.
    const { enqueueActivitySubmit, ACTIVITY_QUEUE_CHANGED, getPendingActivityCount } =
      await import("./offline-queue");
    window.addEventListener(ACTIVITY_QUEUE_CHANGED, () => {
      throw new Error("listener blew up");
    });

    expect(() => enqueueActivitySubmit({ ...RUN, userId: "athlete-1" })).not.toThrow();
    expect(getPendingActivityCount("athlete-1")).toBe(1);
  });
});

/**
 * WHAT SURVIVES EACH OUTCOME.
 *
 * A queued workout is not a saved one. `flushActivityQueue` gives up after
 * MAX_ATTEMPTS or on an answer that will not change, and at that moment the
 * activity has never reached the server. If the device draft mirror was
 * cleared when the workout was QUEUED — which is what the first version of
 * this did — the session exists nowhere at all, and the banner's "you will
 * need to log it again" is simply true.
 *
 * So the queue reports which sports the SERVER accepted, and only those
 * mirrors are cleared. These pin that reporting, because it is the signal the
 * whole safety net hangs off.
 */
describe("which workouts the server has actually accepted", () => {
  it("names the sport of every item that flushed", async () => {
    const { enqueueActivitySubmit, flushActivityQueue } = await import("./offline-queue");
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

    enqueueActivitySubmit({ ...RUN, payload: { sport: "running" }, userId: "athlete-1" });
    enqueueActivitySubmit({ ...RUN, payload: { sport: "gym" }, userId: "athlete-1" });

    const result = await flushActivityQueue("athlete-1");

    expect(result.flushed).toBe(2);
    expect(result.flushedSports.sort()).toEqual(["gym", "running"]);
  });

  it("names nothing for a workout it gave up on", async () => {
    // The case that matters: a permanent rejection. The mirror must NOT be
    // cleared, because the phone is now the only copy.
    const { enqueueActivitySubmit, flushActivityQueue } = await import("./offline-queue");
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400 })));

    enqueueActivitySubmit({ ...RUN, payload: { sport: "running" }, userId: "athlete-1" });

    const result = await flushActivityQueue("athlete-1");

    expect(result.dropped).toBe(1);
    expect(result.flushedSports).toEqual([]);
    // Named so the athlete can be told WHERE the workout still is, rather than
    // told to log it again — the mirror for this sport was never cleared.
    expect(result.droppedSports).toEqual(["running"]);
  });

  it("names nothing for a workout still waiting", async () => {
    const { enqueueActivitySubmit, flushActivityQueue } = await import("./offline-queue");
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    enqueueActivitySubmit({ ...RUN, payload: { sport: "running" }, userId: "athlete-1" });

    const result = await flushActivityQueue("athlete-1");

    expect(result.failed).toBe(1);
    expect(result.flushedSports).toEqual([]);
    // Still waiting is not given up on.
    expect(result.droppedSports).toEqual([]);
  });
});

describe("a sport whose workout is still in the queue", () => {
  it("is reported, so its mirror is not offered back as editable", async () => {
    // Rehydrating it would invite a second submit under a fresh idempotency
    // key — the same session in the logbook twice.
    const { enqueueActivitySubmit, queuedSports } = await import("./offline-queue");
    enqueueActivitySubmit({ ...RUN, payload: { sport: "running" }, userId: "athlete-1" });
    expect(queuedSports("athlete-1")).toEqual(["running"]);
  });

  it("is not reported once nothing of theirs is queued", async () => {
    const { enqueueActivitySubmit, queuedSports } = await import("./offline-queue");
    enqueueActivitySubmit({ ...RUN, payload: { sport: "running" }, userId: "someone-else" });
    expect(queuedSports("athlete-1")).toEqual([]);
  });
});
