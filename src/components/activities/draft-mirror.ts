import type { SportType } from "@/types";
import type { WorkoutFormState } from "./form-state";

/**
 * A copy of the in-progress draft on the device itself.
 *
 * THE ONLY PERSISTENCE WAS A NETWORK PUT. `useDraftAutosave` sends the form to
 * `PUT /api/activities/draft` and nowhere else, so offline the request throws,
 * the indicator turns to "error", and the half-typed session exists only in
 * React state. Kill the app and every set logged that gym session is gone. The
 * `retry` affordance re-attempts the same network call, so it cannot help — it
 * is the network that is missing.
 *
 * The gym timer's own comment argued for sessionStorage on the grounds that
 * "workout_drafts already covers the actual logged sets across a real
 * relaunch". True online and false offline, which is the half that matters:
 * the athlete most likely to lose a session to an app kill is the one in a
 * basement gym with no signal.
 *
 * WHY A MIRROR RATHER THAN A REPLACEMENT. The server draft is still the source
 * of truth, because it is the one that follows an athlete to another device.
 * This only wins when it is demonstrably newer — see `preferredDraft` — so a
 * session started on a phone and continued on a laptop still behaves the way
 * it does today.
 */

const KEY = "split_index_draft_mirror";

export interface MirroredDraft {
  savedAt: number;
  state: WorkoutFormState;
}

type MirrorStore = Partial<Record<SportType, MirroredDraft>>;

function read(): MirrorStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MirrorStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: MirrorStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // A full or disabled store must not throw out of an autosave — losing the
    // mirror leaves the athlete exactly where they were before it existed.
  }
}

/** Called on every autosave attempt, before the network is involved and whatever it answers. */
export function mirrorDraft(sport: SportType, state: WorkoutFormState, now = Date.now()) {
  write({ ...read(), [sport]: { savedAt: now, state } });
}

/** Called when a session is saved (or the draft deliberately discarded) — the mirror is not a history. */
export function clearMirroredDraft(sport: SportType) {
  const store = read();
  if (!(sport in store)) return;
  delete store[sport];
  write(store);
}

export function readMirroredDraft(sport: SportType): MirroredDraft | null {
  return read()[sport] ?? null;
}

/**
 * Which of the two drafts to hydrate the form from.
 *
 * The mirror wins only when it is NEWER than the server's copy. Both are
 * legitimate: the server draft is what another device would see, and the
 * mirror is what this device typed while it could not reach the server.
 * Preferring the mirror unconditionally would quietly undo a session
 * continued on a laptop; preferring the server unconditionally is the bug
 * this exists to fix.
 *
 * A server draft with no timestamp is treated as older than any mirror. That
 * is deliberate: `workout_drafts` rows written before this existed carry no
 * comparable time, and the mirror can only exist if this device typed it.
 */
export function preferredDraft(
  serverDraft: unknown,
  serverUpdatedAt: string | null | undefined,
  mirror: MirroredDraft | null
): { source: "mirror" | "server" | "none"; draft: unknown } {
  if (!mirror) return serverDraft ? { source: "server", draft: serverDraft } : { source: "none", draft: null };
  if (!serverDraft) return { source: "mirror", draft: mirror.state };

  const serverTime = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : NaN;
  if (!Number.isFinite(serverTime)) return { source: "mirror", draft: mirror.state };

  return mirror.savedAt > serverTime
    ? { source: "mirror", draft: mirror.state }
    : { source: "server", draft: serverDraft };
}
