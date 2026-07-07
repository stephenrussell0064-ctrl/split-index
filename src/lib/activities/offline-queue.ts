const QUEUE_KEY = "split_index_pending_activities";

export interface QueuedActivitySubmit {
  id: string;
  url: string;
  method: "POST" | "PATCH";
  payload: unknown;
  createdAt: string;
  label?: string;
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
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function getPendingActivityCount(): number {
  return readQueue().length;
}

export function enqueueActivitySubmit(entry: Omit<QueuedActivitySubmit, "id" | "createdAt">) {
  const queue = readQueue();
  const item: QueuedActivitySubmit = {
    ...entry,
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  writeQueue(queue);
  return item;
}

export function removeQueuedActivity(id: string) {
  writeQueue(readQueue().filter((q) => q.id !== id));
}

export async function flushActivityQueue(): Promise<{
  flushed: number;
  failed: number;
}> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { flushed: 0, failed: 0 };
  }

  const queue = readQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (!res.ok) {
        failed += 1;
        continue;
      }
      removeQueuedActivity(item.id);
      flushed += 1;
    } catch {
      failed += 1;
    }
  }

  return { flushed, failed };
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
