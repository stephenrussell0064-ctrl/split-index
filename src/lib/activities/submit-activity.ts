import {
  enqueueActivitySubmit,
  isNetworkFailure,
  flushActivityQueue,
} from "./offline-queue";

export type ActivitySubmitResult =
  | { ok: true; data: Record<string, unknown>; queued: false }
  | { ok: true; queued: true; queueId: string; message: string }
  | { ok: false; error: string; queued: false };

export async function submitActivityRequest(
  url: string,
  method: "POST" | "PATCH",
  payload: unknown
): Promise<ActivitySubmitResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) ?? "Failed to save workout", queued: false };
    }
    return { ok: true, data, queued: false };
  } catch (err) {
    if (!navigator.onLine || isNetworkFailure(err)) {
      // Stamped with the owner so a later flush cannot file this workout into
      // whoever happens to be signed in at the time — see QueuedActivitySubmit.
      const item = enqueueActivitySubmit({ url, method, payload, userId: await currentUserId() });
      return {
        ok: true,
        queued: true,
        queueId: item.id,
        message:
          "You're offline — workout saved on this device and will sync when you're back online.",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save workout",
      queued: false,
    };
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
