import {
  enqueueActivitySubmit,
  isNetworkFailure,
  newClientRequestId,
  flushActivityQueue,
} from "./offline-queue";

export type ActivitySubmitResult =
  | { ok: true; data: Record<string, unknown>; queued: false }
  | { ok: true; queued: true; queueId: string; message: string }
  | { ok: false; error: string; queued: false };

/**
 * How long a save may hang before it becomes a queued save.
 *
 * OFFLINE IS THE EASY CASE. `fetch` rejects, `navigator.onLine` is false, and
 * the branch below queues the workout. The case that had no answer is FLAKY:
 * one bar of signal, or a hotel captive portal that accepts the TCP connection
 * and then never answers. `navigator.onLine` is true, the request neither
 * resolves nor rejects, and WKWebView holds it for around sixty seconds. The
 * Save button spins for a minute, the athlete gets a generic error, and
 * nothing is queued — because the queue only runs on a rejection.
 *
 * Twelve seconds is well past a slow-but-working mobile save and well short of
 * the sixty the athlete would otherwise stand there for. A timeout converts a
 * hang into a queued save, which is the outcome they wanted anyway.
 */
const SUBMIT_TIMEOUT_MS = 12_000;

/**
 * `AbortController` plus `setTimeout`, not `AbortSignal.timeout`.
 *
 * The iOS deployment target here is 15.0 and `AbortSignal.timeout` arrived in
 * Safari 16. On iOS 15 the call throws a TypeError, which `isNetworkFailure`
 * reads as a network failure — so every single save on those devices would be
 * queued and none would ever be sent. This form works everywhere.
 */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function submitActivityRequest(
  url: string,
  method: "POST" | "PATCH",
  payload: unknown
): Promise<ActivitySubmitResult> {
  /*
    Minted here, before the request, and reused if this ends up queued.

    A request that times out may well have REACHED the server — the response is
    what went missing. Queueing the retry under a fresh key would file the same
    run twice; under this one, migration 058's unique index on
    `client_request_id` recognises the repeat.
  */
  const clientRequestId = newClientRequestId();
  const body =
    typeof payload === "object" && payload !== null
      ? { ...(payload as Record<string, unknown>), client_request_id: clientRequestId }
      : payload;

  const timeout = withTimeout(SUBMIT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) ?? "Failed to save workout", queued: false };
    }
    return { ok: true, data, queued: false };
  } catch (err) {
    // A timeout is checked explicitly: an abort is a DOMException whose message
    // mentions neither "network" nor "failed to fetch", so `isNetworkFailure`
    // says no and the workout would have been dropped on exactly the connection
    // this timeout exists to survive.
    if (timeout.signal.aborted || !navigator.onLine || isNetworkFailure(err)) {
      // Stamped with the owner so a later flush cannot file this workout into
      // whoever happens to be signed in at the time — see QueuedActivitySubmit.
      const item = enqueueActivitySubmit({
        url,
        method,
        payload,
        clientRequestId,
        userId: await currentUserId(),
      });
      return {
        ok: true,
        queued: true,
        queueId: item.id,
        message: timeout.signal.aborted
          ? "That took too long — workout saved on this device and will sync when the connection is better."
          : "You're offline — workout saved on this device and will sync when you're back online.",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save workout",
      queued: false,
    };
  } finally {
    timeout.done();
  }
}

/**
 * The signed-in athlete, read from the client's cached session.
 *
 * Best-effort by design: this runs in a failure path that has already lost the
 * network, and `getUser()` falls back to the locally stored session rather than
 * a round trip. A null result queues the item unowned, which is the old
 * behaviour and no worse than it.
 */
async function currentUserId(): Promise<string | undefined> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient().auth.getUser();
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export { flushActivityQueue, getPendingActivityCount } from "./offline-queue";
