import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkoutFormState } from "./form-state";

/**
 * THE ONLY PERSISTENCE FOR A HALF-LOGGED SESSION WAS A NETWORK PUT.
 *
 * `useDraftAutosave` sent the form to `PUT /api/activities/draft` and nowhere
 * else. Offline the request throws, the indicator turns to "error", and the
 * session exists only in React state — kill the app and every set logged that
 * gym session is gone. The `retry` affordance re-attempts the same call, so it
 * cannot help: it is the network that is missing. The athlete most likely to
 * lose a session this way is the one in a basement gym with no signal.
 *
 * The mirror is not a replacement for the server draft, and these tests are
 * mostly about that boundary. Preferring the mirror always would quietly undo
 * a session continued on another device; preferring the server always is the
 * bug. It wins only when it is provably newer.
 */

const store = new Map<string, string>();
const KEY = "split_index_draft_mirror";

const STATE = { distance: "10", hours: "", minutes: "48" } as unknown as WorkoutFormState;
const OTHER = { distance: "5", hours: "", minutes: "22" } as unknown as WorkoutFormState;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("a draft typed while offline", () => {
  it("survives on the device", async () => {
    const { mirrorDraft, readMirroredDraft } = await import("./draft-mirror");
    mirrorDraft("running", STATE, 1_000);
    expect(readMirroredDraft("running")?.state).toEqual(STATE);
  });

  it("is kept per sport, so logging a run does not overwrite a gym session", async () => {
    const { mirrorDraft, readMirroredDraft } = await import("./draft-mirror");
    mirrorDraft("running", STATE, 1_000);
    mirrorDraft("gym", OTHER, 2_000);
    expect(readMirroredDraft("running")?.state).toEqual(STATE);
    expect(readMirroredDraft("gym")?.state).toEqual(OTHER);
  });

  it("reads as absent when there is nothing, rather than throwing", async () => {
    const { readMirroredDraft } = await import("./draft-mirror");
    expect(readMirroredDraft("running")).toBeNull();
  });

  it("survives a corrupted store", async () => {
    store.set(KEY, "{not json");
    const { readMirroredDraft } = await import("./draft-mirror");
    expect(readMirroredDraft("running")).toBeNull();
  });
});

describe("which draft the form hydrates from", () => {
  const server = { distance: "99" };

  it("prefers the mirror when this device typed more recently", async () => {
    // The offline case: the PUT never landed, so the server row is stale.
    const { preferredDraft } = await import("./draft-mirror");
    const got = preferredDraft(server, "2026-01-01T10:00:00Z", {
      savedAt: new Date("2026-01-01T10:05:00Z").getTime(),
      state: STATE,
    });
    expect(got).toEqual({ source: "mirror", draft: STATE });
  });

  it("prefers the server when it is newer, so another device still wins", async () => {
    // Started on a phone, continued on a laptop. Preferring the mirror here
    // would silently undo the laptop's work.
    const { preferredDraft } = await import("./draft-mirror");
    const got = preferredDraft(server, "2026-01-01T11:00:00Z", {
      savedAt: new Date("2026-01-01T10:05:00Z").getTime(),
      state: STATE,
    });
    expect(got).toEqual({ source: "server", draft: server });
  });

  it("uses the mirror when the server has no draft at all", async () => {
    const { preferredDraft } = await import("./draft-mirror");
    expect(preferredDraft(null, null, { savedAt: 5, state: STATE })).toEqual({
      source: "mirror",
      draft: STATE,
    });
  });

  it("uses the server when there is no mirror", async () => {
    const { preferredDraft } = await import("./draft-mirror");
    expect(preferredDraft(server, "2026-01-01T10:00:00Z", null)).toEqual({
      source: "server",
      draft: server,
    });
  });

  it("reports neither when there is nothing to restore", async () => {
    const { preferredDraft } = await import("./draft-mirror");
    expect(preferredDraft(null, null, null)).toEqual({ source: "none", draft: null });
  });

  it("prefers the mirror over a server row with an unreadable timestamp", async () => {
    // Rows written before `updated_at` was projected carry nothing comparable,
    // and a mirror can only exist because this device typed it.
    const { preferredDraft } = await import("./draft-mirror");
    expect(preferredDraft(server, undefined, { savedAt: 5, state: STATE })).toEqual({
      source: "mirror",
      draft: STATE,
    });
  });
});

describe("a session that has been saved", () => {
  it("takes its mirror with it", async () => {
    // A mirror outliving its session would hydrate the next visit with a
    // workout already in the logbook — the same data problem as a duplicate.
    const { mirrorDraft, clearMirroredDraft, readMirroredDraft } = await import("./draft-mirror");
    mirrorDraft("running", STATE, 1_000);
    clearMirroredDraft("running");
    expect(readMirroredDraft("running")).toBeNull();
  });

  it("leaves other sports' drafts alone", async () => {
    const { mirrorDraft, clearMirroredDraft, readMirroredDraft } = await import("./draft-mirror");
    mirrorDraft("running", STATE, 1_000);
    mirrorDraft("gym", OTHER, 1_000);
    clearMirroredDraft("running");
    expect(readMirroredDraft("gym")?.state).toEqual(OTHER);
  });
});
