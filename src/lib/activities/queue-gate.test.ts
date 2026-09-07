import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CHEAP GATE IN FRONT OF THE RESUME FLUSH.
 *
 * `ClientBootstrap` now flushes the offline queue on `visibilitychange` as well
 * as on `online`, because signal coming back while the app is BACKGROUNDED does
 * not reliably fire `online` in WKWebView — the queued session sat there until
 * the athlete force-quit and relaunched, having been told it would "sync when
 * you're back online" while it was online.
 *
 * That handler fires on every tab focus, so the common case — nothing queued —
 * has to cost one localStorage read rather than a session resolution. Hence
 * `hasQueuedActivities`, which is deliberately NOT owner-filtered: it answers
 * "is this worth waking up for", not "what should this athlete be shown".
 */

const store = new Map<string, string>();
const QUEUE_KEY = "split_index_pending_activities";

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const RUN = { url: "/api/activities", method: "POST" as const, payload: { sport: "running" } };

describe("whether a resume is worth acting on", () => {
  it("is false when nothing is queued", async () => {
    const { hasQueuedActivities } = await import("./offline-queue");
    expect(hasQueuedActivities()).toBe(false);
  });

  it("is true for a workout belonging to anyone on this device", async () => {
    // Not owner-filtered on purpose: resolving the owner is the expensive half
    // this gate exists to avoid, and a device with someone else's unsent run
    // still has work to do once they sign back in.
    const { enqueueActivitySubmit, hasQueuedActivities } = await import("./offline-queue");
    enqueueActivitySubmit({ ...RUN, userId: "someone-else" });
    expect(hasQueuedActivities()).toBe(true);
  });

  it("goes back to false once the queue drains", async () => {
    const { enqueueActivitySubmit, removeQueuedActivity, hasQueuedActivities } =
      await import("./offline-queue");
    const item = enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });
    removeQueuedActivity(item.id);
    expect(hasQueuedActivities()).toBe(false);
  });

  it("does not throw on a corrupted queue", async () => {
    // This runs on every tab focus. A store it cannot parse must read as
    // "nothing to do", not take the handler down.
    store.set(QUEUE_KEY, "{not json");
    const { hasQueuedActivities } = await import("./offline-queue");
    expect(hasQueuedActivities()).toBe(false);
  });
});

describe("the flush itself still refuses to run offline", () => {
  it("does nothing when the device is offline, whatever the gate said", async () => {
    const { enqueueActivitySubmit, flushActivityQueue } = await import("./offline-queue");
    vi.stubGlobal("navigator", { onLine: false });
    enqueueActivitySubmit({ ...RUN, userId: "athlete-1" });

    const result = await flushActivityQueue("athlete-1");

    // `flushedSports` names the sports the SERVER accepted, so an offline
    // flush names none — which is what keeps their draft mirrors alive.
    expect(result).toEqual({ flushed: 0, failed: 0, dropped: 0, flushedSports: [] });
  });
});
