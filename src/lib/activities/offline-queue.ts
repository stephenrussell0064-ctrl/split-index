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

/**
 * Fired whenever the queue's contents change, so anything showing the athlete
 * a pending count can update without polling localStorage.
 *
 * The `storage` event does not help here: it only fires in OTHER tabs, never
 * in the one that wrote. This is a phone app with one tab.
 */
export const ACTIVITY_QUEUE_CHANGED = "split-index:activity-queue-changed";

function writeQueue(items: QueuedActivitySubmit[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // A full or disabled store must not throw out of a save path — the request
    // itself already failed, and losing the queue write is not made better by
    // also throwing away the error the caller was about to show.
  }
  // After the write, and outside the try: a listener that throws is not a
  // reason to report the save as failed.
  try {
    window.dispatchEvent(new CustomEvent(ACTIVITY_QUEUE_CHANGED));
  } catch {
    // A WebView without CustomEvent, or a subscriber that threw. Either way
    // the write above already happened, and the count picks the change up on
    // the next mount or `online` event — which is the pre-existing behaviour,
    // not a regression. What must not happen is a broken listener surfacing
    // as a failed save to someone whose workout is safely queued.
  }
}

/**
 * Is there anything queued at all, for anybody?
 *
 * A deliberately cheap gate — one localStorage read, no owner resolution and
 * no auth call — so a caller that fires on every resume can ask "is this worth
 * doing" before doing the expensive part. Use `getPendingActivityCount` for
 * anything an athlete is shown; this one is not owner-filtered and would
 * report a signed-out device's leftovers as pending.
 */
export function hasQueuedActivities(): boolean {
  return readQueue().length > 0;
}

/**
 * Sports with a workout still waiting to be sent, for this athlete.
 *
 * Used to decide whether a device draft mirror is a workout in progress or a
 * copy of one already handed to the queue — the second must not be offered
 * back as something to edit and submit again.
 */
export function queuedSports(userId?: string | null): string[] {
  const sports = new Set<string>();
  for (const item of readQueue()) {
    if (!ownedBy(item, userId)) continue;
    const sport = (item.payload as { sport?: unknown } | null)?.sport;
    if (typeof sport === "string") sports.add(sport);
  }
  return [...sports];
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

/** A fresh idempotency key. Exported so a direct submit can send the SAME key it will queue under — see `submitActivityRequest`. */
export function newClientRequestId(): string {
  return newId("cr");
}

export function enqueueActivitySubmit(
  entry: Omit<QueuedActivitySubmit, "id" | "createdAt" | "clientRequestId"> & {
    /**
     * Reuse the key the direct attempt already sent, instead of minting a new
     * one. A request that timed out may well have reached the server, and a
     * queued replay under a DIFFERENT key is a second run in the logbook —
     * which is the exact duplicate this field exists to prevent.
     */
    clientRequestId?: string;
  }
) {
  const queue = readQueue();
  const item: QueuedActivitySubmit = {
    ...entry,
    id: newId("q"),
    clientRequestId: entry.clientRequestId ?? newId("cr"),
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
  /**
   * Sports whose workout the SERVER has now accepted.
   *
   * The device draft mirror has to survive until this point, not until the
   * queue accepts the item — a queued workout is not a saved one, and the
   * queue can still give up on it. Reported per sport so the caller can clear
   * exactly the mirrors that are now redundant and leave the rest alone.
   */
  flushedSports: string[];
  /** Still queued, will be tried again. */
  failed: number;
  /** Given up on and removed — the workout is gone and the user should be told. */
  dropped: number;
}

export async function flushActivityQueue(userId?: string | null): Promise<FlushResult> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { flushed: 0, failed: 0, dropped: 0, flushedSports: [] };
  }

  const queue = readQueue().filter((item) => ownedBy(item, userId));
  if (queue.length === 0) return { flushed: 0, failed: 0, dropped: 0, flushedSports: [] };

  let flushed = 0;
  let failed = 0;
  let dropped = 0;
  const flushedSports = new Set<string>();

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
        const sport = (item.payload as { sport?: unknown } | null)?.sport;
        if (typeof sport === "string") flushedSports.add(sport);
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

  return { flushed, failed, dropped, flushedSports: [...flushedSports] };
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
