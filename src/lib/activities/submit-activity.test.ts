import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE FLAKY CONNECTION, WHICH IS THE ONE THAT LOSES WORKOUTS.
 *
 * Offline was always handled: `fetch` rejects, `navigator.onLine` is false, the
 * workout is queued. The case with no answer was a connection good enough to
 * open a socket and not good enough to answer on it — one bar of signal, or a
 * captive portal. The request hung for WKWebView's ~60s, the queue never ran
 * (it only runs on a rejection), and the athlete got a spinner and then a
 * generic error with nothing saved.
 *
 * These tests hold the two halves of the fix together: the timeout queues, and
 * it queues under the SAME idempotency key the timed-out attempt already sent —
 * because a request that times out may have arrived, and a retry under a fresh
 * key is a second run in the logbook.
 */

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});
vi.stubGlobal("window", {});
vi.stubGlobal("navigator", { onLine: true });
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "athlete-1" } } }) } }),
}));

const QUEUE_KEY = "split_index_pending_activities";

function queued(): { clientRequestId: string; userId?: string; url: string }[] {
  return JSON.parse(store.get(QUEUE_KEY) ?? "[]");
}

const RUN = { sport: "running", distance_meters: 10000, duration_seconds: 2900 };

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { onLine: true });
});

describe("a save that hangs on a half-open connection", () => {
  it("is queued rather than lost", async () => {
    const { submitActivityRequest } = await import("./submit-activity");

    // A connection that accepts the request and never answers. It rejects only
    // when aborted — exactly what WKWebView does for the first sixty seconds.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError"))
            );
          })
      )
    );

    const pending = submitActivityRequest("/api/activities", "POST", RUN);
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(queued()).toHaveLength(1);
  });

  it("tells the athlete it was slow, not that they were offline", async () => {
    // They can see they have signal. "You're offline" reads as a bug.
    const { submitActivityRequest } = await import("./submit-activity");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_r, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })
      )
    );

    const pending = submitActivityRequest("/api/activities", "POST", RUN);
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await pending;

    expect(result.ok && result.queued && result.message).toContain("took too long");
  });

  it("queues under the key the timed-out attempt already sent", async () => {
    // The whole point. The server may have written the activity before the
    // response was lost; a replay under a new key would write it again.
    const { submitActivityRequest } = await import("./submit-activity");
    let sentKey: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        sentKey = JSON.parse(init.body as string).client_request_id;
        return new Promise((_r, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      })
    );

    const pending = submitActivityRequest("/api/activities", "POST", RUN);
    await vi.advanceTimersByTimeAsync(12_000);
    await pending;

    expect(sentKey).toBeTruthy();
    expect(queued()[0]!.clientRequestId).toBe(sentKey);
  });
});

describe("a save that works", () => {
  it("is not queued, and does not wait for the timeout", async () => {
    const { submitActivityRequest } = await import("./submit-activity");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ activity_id: "a1" }) }))
    );

    const result = await submitActivityRequest("/api/activities", "POST", RUN);

    expect(result).toMatchObject({ ok: true, queued: false });
    expect(queued()).toHaveLength(0);
  });

  it("carries an idempotency key even when it succeeds first time", async () => {
    // Not a queue-only concern any more: the request the server never got to
    // answer is indistinguishable, from here, from one it never received.
    const { submitActivityRequest } = await import("./submit-activity");
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await submitActivityRequest("/api/activities", "POST", RUN);

    const body = JSON.parse(sentBody);
    expect(body.client_request_id).toMatch(/^cr-/);
    expect(body.sport).toBe("running");
  });
});

describe("a save the server rejects", () => {
  it("is reported, not queued — retrying it forever would not help", async () => {
    const { submitActivityRequest } = await import("./submit-activity");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Distance looks wrong" }) }))
    );

    const result = await submitActivityRequest("/api/activities", "POST", RUN);

    expect(result).toMatchObject({ ok: false, queued: false, error: "Distance looks wrong" });
    expect(queued()).toHaveLength(0);
  });
});

describe("a save with no connection at all", () => {
  it("still queues, and still says offline", async () => {
    const { submitActivityRequest } = await import("./submit-activity");
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      })
    );

    const result = await submitActivityRequest("/api/activities", "POST", RUN);

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(result.ok && result.queued && result.message).toContain("offline");
    expect(queued()[0]!.userId).toBe("athlete-1");
  });
});
