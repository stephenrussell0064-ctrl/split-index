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
      const item = enqueueActivitySubmit({ url, method, payload });
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

export { flushActivityQueue, getPendingActivityCount } from "./offline-queue";
