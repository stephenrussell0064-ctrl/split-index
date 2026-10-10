import { fetchHealthSamples, isHealthImportSupported, requestHealthAccess } from "@/lib/native/health-import";

/**
 * The client half of the Apple Health import: ask the phone, post to the
 * server, remember when.
 *
 * The cursor lives on the server (`health_import_state.last_sample_at`). The
 * sync reads from a few days BEFORE it on purpose — a watch syncs to the
 * phone hours after the run, and sleep is written in the morning for the
 * night before — and the server's per-sample record is what makes the
 * overlap harmless. A first sync reads ninety days: enough to seed the
 * recovery baseline and the race-prediction window, short enough not to
 * reshape ACWR with a year of history in one go (the plan's "baseline shock"
 * risk).
 */

export interface HealthImportState {
  connected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSampleAt: string | null;
}

export interface HealthSyncResult {
  workouts: { imported: number; skipped: number; duplicates: number; failed: number };
  hrvDays: number;
  restingHrDays: number;
  sleepNights: number;
  bodyMass: number;
  lastSampleAt: string | null;
}

const OVERLAP_DAYS = 3;
const FIRST_SYNC_DAYS = 90;
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const LAST_AUTO_SYNC_KEY = "split-index-health-auto-sync-at";
const CONNECTED_HINT_KEY = "split-index-health-connected";
const DAY_MS = 86_400_000;

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function getHealthImportState(): Promise<HealthImportState> {
  const state = await readJson<HealthImportState>(await fetch("/api/health/import", { cache: "no-store" }));
  rememberConnected(state.connected);
  return state;
}

/** Apple's permission sheet, then the connection on the server, then a first sync. */
export async function connectHealth(): Promise<HealthSyncResult> {
  await requestHealthAccess();
  const state = await readJson<HealthImportState>(await fetch("/api/health/import", { method: "PUT" }));
  rememberConnected(state.connected);
  return runHealthSync(state);
}

export async function disconnectHealth(): Promise<HealthImportState> {
  const state = await readJson<HealthImportState>(await fetch("/api/health/import", { method: "DELETE" }));
  rememberConnected(state.connected);
  return state;
}

/** Read from the phone and post to the server. Throws on the web, where there is nothing to read. */
export async function runHealthSync(known?: HealthImportState): Promise<HealthSyncResult> {
  const state = known ?? (await getHealthImportState());
  if (!state.connected) throw new Error("Apple Health is not connected.");
  const since = state.lastSampleAt
    ? new Date(Date.parse(state.lastSampleAt) - OVERLAP_DAYS * DAY_MS)
    : new Date(Date.now() - FIRST_SYNC_DAYS * DAY_MS);
  const samples = await fetchHealthSamples(since);
  const result = await readJson<HealthSyncResult>(
    await fetch("/api/health/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(samples),
    })
  );
  markAutoSynced();
  return result;
}

/*
 * The hint below is a per-device convenience, not state: it lets the app
 * shell skip a network round trip on every launch for the majority who have
 * never connected. The server is the truth, and a wrong hint costs one
 * request.
 */
function rememberConnected(connected: boolean) {
  try {
    if (connected) localStorage.setItem(CONNECTED_HINT_KEY, "1");
    else localStorage.removeItem(CONNECTED_HINT_KEY);
  } catch {
    /* storage unavailable: the shell asks the server instead */
  }
}

export function connectedHint(): boolean | null {
  try {
    const v = localStorage.getItem(CONNECTED_HINT_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function markAutoSynced() {
  try {
    localStorage.setItem(LAST_AUTO_SYNC_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Whether the shell should sync on its own right now: native iOS, not synced in the last quarter hour, and not known to be disconnected. */
export function shouldAutoSync(now = Date.now()): boolean {
  if (!isHealthImportSupported()) return false;
  if (connectedHint() === false) return false;
  try {
    const last = Number(localStorage.getItem(LAST_AUTO_SYNC_KEY) ?? 0);
    return !Number.isFinite(last) || now - last >= AUTO_SYNC_INTERVAL_MS;
  } catch {
    return true;
  }
}
