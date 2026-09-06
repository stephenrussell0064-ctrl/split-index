const QUEUE_KEY = "split_index_pending_activities";

/**
 * How many times a queued submit is retried before it is dropped.
 *
 * Failures used to be retried forever and invisibly: a request that came back
 * 400 or 404 was counted as `failed`, left in the queue, and tried again on
 * every reconnect and every app launch for the rest of the install's life. The
 * user saw nothing either way.
 */
const MAX_ATTEMPTS = 5;

export interface QueuedActivitySubmit {
  id: string;
  url: string;
  method: "POST" | "PATCH";
  payload: unknown;
  createdAt: string;
  label?: string;
  /**
   * Who queued it.
   *
   * The queue lives in localStorage, which is keyed to the DEVICE and not to
   * the account — so an unsent workout belonging to whoever was signed in when
   * the phone lost signal used to be flushed by whoever was signed in when it
   * came back. On a shared or handed-down phone that files one athlete's run
   * into another athlete's logbook, under their name, with their scores moved
   * accordingly. Absent on rows queued before this field existed; those are
   * flushed once by whoever is signed in next, which is the old behaviour and
   * the best that can be done retroactively.
   */
  userId?: string;
  /**
   * Idempotency key, sent to the API as `client_request_id`.
   *
   * The failure this exists for is ordinary rather than exotic: a POST reaches
   * the server, the server writes the activity, and the response never makes it
   * back over a dropping mobile connection. `fetch` rejects, the queue treats
   * that as "never sent", and the next flush files the same run a second time.
   * The key is generated ONCE at enqueue and reused on every retry, so the
   * server can recognise the repeat.
   */
  clientRequestId: string;
  attempts?: number;
}

function readQueue(): QueuedActivitySubmit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedActivitySubmit[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedActivitySubmit[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // A full or disabled store must not throw out of a save path — the request
    // itself already failed, and losing the queue write is not made better by
    // also throwing away the error the caller was about to show.
  }
}

/** Pending items belonging to this athlete (plus legacy rows with no owner recorded). */
export function getPendingActivityCount(userId?: string | null): number {
  return readQueue().filter((item) => ownedBy(item, userId)).length;
}

function ownedBy(item: QueuedActivitySubmit, userId?: string | null): boolean {
  if (!item.userId) return true; // queued before ownership was recorded
  if (!userId) return false; // signed out: nothing that names an owner is ours to send
  return item.userId === userId;
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function enqueueActivitySubmit(
  entry: Omit<QueuedActivitySubmit, "id" | "createdAt" | "clientRequestId">
) {
  const queue = readQueue();
  const item: QueuedActivitySubmit = {
    ...entry,
    id: newId("q"),
    clientRequestId: newId("cr"),
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  writeQueue(queue);
  return item;
}

export function removeQueuedActivity(id: string) {
  writeQueue(readQueue().filter((q) => q.id !== id));
}

function updateQueuedActivity(id: string, patch: Partial<QueuedActivitySubmit>) {
  writeQueue(readQueue().map((q) => (q.id === id ? { ...q, ...patch } : q)));
}

/**
 * True when the server has answered and the answer will not change on a retry.
 *
 * 401 and 408 are excluded because they genuinely can: a session refreshes, a
 * timeout succeeds next time. 429 likewise. Everything else in the 4xx range is
 * the server saying the request itself is wrong, and sending it again on every
 * launch forever helps nobody.
 */
function isPermanentFailure(status: number): boolean {
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

export interface FlushResult {
  flushed: number;
  /** Still queued, will be tried again. */
  failed: number;
  /** Given up on and removed — the workout is gone and the user should be told. */
  dropped: number;
}

export async function flushActivityQueue(userId?: string | null): Promise<FlushResult> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { flushed: 0, failed: 0, dropped: 0 };
  }

  const queue = readQueue().filter((item) => ownedBy(item, userId));
  if (queue.length === 0) return { flushed: 0, failed: 0, dropped: 0 };

  let flushed = 0;
  let failed = 0;
  let dropped = 0;

  for (const item of queue) {
    const attempts = (item.attempts ?? 0) + 1;
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        // The same key on every attempt — that is the whole point of it.
        body: JSON.stringify(
          typeof item.payload === "object" && item.payload !== null
            ? { ...(item.payload as Record<string, unknown>), client_request_id: item.clientRequestId }
            : item.payload
        ),
      });

      if (res.ok) {
        removeQueuedActivity(item.id);
        flushed += 1;
        continue;
      }

      if (isPermanentFailure(res.status) || attempts >= MAX_ATTEMPTS) {
        removeQueuedActivity(item.id);
        dropped += 1;
        console.error(
          `[offline-queue] giving up on a queued workout after ${attempts} attempt(s), HTTP ${res.status}`
        );
        continue;
      }

      updateQueuedActivity(item.id, { attempts });
      failed += 1;
    } catch {
      if (attempts >= MAX_ATTEMPTS) {
        removeQueuedActivity(item.id);
        dropped += 1;
        continue;
      }
      updateQueuedActivity(item.id, { attempts });
      failed += 1;
    }
  }

  return { flushed, failed, dropped };
}

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("network") ||
      msg.includes("load failed")
    );
  }
  return false;
}
