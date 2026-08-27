import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These cover the two defects behind the athlete's report that pausing a GPS
 * run "only stops the run permanently", both of which live in this file's
 * handling of the persisted session rather than in the pause UI itself.
 */

// ---------------------------------------------------------------------------
// Fakes for the native layer
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

/** Every Preferences call resolves on a later microtask, like a real bridge round-trip — which is what makes an unserialized read-modify-write lose writes. */
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      await Promise.resolve();
      return { value: store.has(key) ? store.get(key)! : null };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      await Promise.resolve();
      store.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      await Promise.resolve();
      store.delete(key);
    },
  },
}));

type WatcherCallback = (position?: Record<string, unknown>, error?: unknown) => void;

const watcher: {
  callback: WatcherCallback | null;
  added: string[];
  removed: string[];
} = { callback: null, added: [], removed: [] };

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    addWatcher: async (_options: unknown, callback: WatcherCallback) => {
      watcher.callback = callback;
      const id = `watcher-${watcher.added.length}`;
      watcher.added.push(id);
      return id;
    },
    removeWatcher: async ({ id }: { id: string }) => {
      watcher.removed.push(id);
    },
  }),
}));

vi.mock("./platform", () => ({
  isNativePlatform: () => true,
  getNativePlatform: () => "ios",
}));

import {
  startGpsSession,
  pauseGpsSession,
  resumeGpsSession,
  recoverOrphanedSession,
  rejoinGpsSession,
  stopGpsSession,
} from "./gps-tracking";

const SESSION_KEY = "gps-tracking-session";

function storedSession() {
  const raw = store.get(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function fixAt(latOffsetMeters: number, time: number) {
  return {
    latitude: 51.5 + latOffsetMeters / 111_320,
    longitude: -0.12,
    accuracy: 5,
    altitude: 10,
    altitudeAccuracy: 3,
    time,
  };
}

beforeEach(() => {
  store.clear();
  watcher.callback = null;
  watcher.added = [];
  watcher.removed = [];
});

describe("session persistence under concurrent fixes", () => {
  it("keeps every fix when several arrive before any write completes", async () => {
    await startGpsSession();
    const t0 = Date.now();

    // The measured failure: ten callbacks that all read the record before any
    // of them writes it back. Unserialized, ten "start + one point" writes
    // raced and the last one won, persisting ONE point while the live HUD —
    // which reads React state, not storage — happily showed all ten.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => watcher.callback!(fixAt(i * 40, t0 + i * 10_000)))
    );

    expect(storedSession().points).toHaveLength(10);
  });

  it("does not let a fix arriving mid-pause erase the pause", async () => {
    await startGpsSession();
    const t0 = Date.now();
    await watcher.callback!(fixAt(0, t0));

    // Both mutate the same record. Whichever loses the race would otherwise
    // silently drop the other's change — an un-paused pause, or a lost fix.
    await Promise.all([watcher.callback!(fixAt(40, t0 + 10_000)), pauseGpsSession(t0 + 10_500)]);

    const session = storedSession();
    expect(session.points).toHaveLength(2);
    expect(session.pauses).toEqual([{ startTime: t0 + 10_500, endTime: null }]);
  });

  it("does not stack a second pause on a double-tap", async () => {
    await startGpsSession();
    const t0 = Date.now();
    await Promise.all([pauseGpsSession(t0), pauseGpsSession(t0 + 5)]);
    expect(storedSession().pauses).toHaveLength(1);
  });

  it("closes the open pause on resume", async () => {
    await startGpsSession();
    const t0 = Date.now();
    await pauseGpsSession(t0);
    await resumeGpsSession(t0 + 60_000);
    expect(storedSession().pauses).toEqual([{ startTime: t0, endTime: t0 + 60_000 }]);
  });
});

describe("recovering a session the WebView lost", () => {
  /** Seeds storage directly, standing in for whatever the previous JS context left behind. */
  function seedSession(opts: {
    startedAt: number;
    pointTimes: number[];
    pauses?: { startTime: number; endTime: number | null }[];
    permissionRevoked?: boolean;
  }) {
    store.set(
      SESSION_KEY,
      JSON.stringify({
        points: opts.pointTimes.map((t, i) => fixAt(i * 40, t)),
        startedAt: opts.startedAt,
        permissionRevoked: opts.permissionRevoked ?? false,
        pauses: opts.pauses ?? [],
      })
    );
    store.set("gps-tracking-watcher-id", "stale-watcher");
  }

  it("offers a run that was paused moments ago back as resumable", async () => {
    const now = Date.now();
    const startedAt = now - 200_000;
    seedSession({
      startedAt,
      pointTimes: [startedAt, startedAt + 50_000, startedAt + 100_000],
      // Paused, and then the WebView was thrown away before it could be closed.
      pauses: [{ startTime: startedAt + 110_000, endTime: null }],
    });

    const recovered = await recoverOrphanedSession();

    expect(recovered).not.toBeNull();
    expect(recovered!.resumable).toBe(true);
    expect(recovered!.wasPaused).toBe(true);
    expect(recovered!.startedAt).toBe(startedAt);
    // Still open, because from the athlete's side they are still standing in it.
    expect(recovered!.livePauses[0].endTime).toBeNull();
  });

  it("closes the open pause at the last recorded fix for the save-as-partial path", async () => {
    const now = Date.now();
    const startedAt = now - 200_000;
    const lastFix = startedAt + 100_000;
    seedSession({
      startedAt,
      pointTimes: [startedAt, startedAt + 50_000, lastFix],
      pauses: [{ startTime: startedAt + 60_000, endTime: null }],
    });

    const recovered = await recoverOrphanedSession();

    // A pause with no end can only honestly have lasted until the last thing
    // actually recorded — anything later is time nobody has evidence about.
    expect(recovered!.pauses).toEqual([{ startTime: startedAt + 60_000, endTime: lastFix }]);
  });

  it("does not offer to resume a run abandoned hours ago", async () => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    seedSession({
      startedAt: dayAgo,
      pointTimes: [dayAgo, dayAgo + 50_000, dayAgo + 100_000],
      pauses: [{ startTime: dayAgo + 60_000, endTime: null }],
    });

    const recovered = await recoverOrphanedSession();
    expect(recovered!.resumable).toBe(false);
  });

  it("does not offer to resume a run whose location permission was pulled", async () => {
    const now = Date.now();
    seedSession({
      startedAt: now - 60_000,
      pointTimes: [now - 60_000, now - 30_000],
      permissionRevoked: true,
    });

    const recovered = await recoverOrphanedSession();
    expect(recovered!.resumable).toBe(false);
  });

  it("tears down the watcher left behind by the dead JS context", async () => {
    const now = Date.now();
    seedSession({ startedAt: now - 60_000, pointTimes: [now - 60_000, now - 30_000] });

    await recoverOrphanedSession();

    // Its callback can never fire again, but on iOS the native subscription can
    // outlive the WebView and keep costing battery with nobody listening.
    expect(watcher.removed).toContain("stale-watcher");
    expect(store.has(SESSION_KEY)).toBe(false);
  });
});

describe("rejoining a recovered run", () => {
  it("restores the run's own start, fixes and open pause, and attaches a fresh watcher", async () => {
    const now = Date.now();
    const startedAt = now - 200_000;
    const points = [fixAt(0, startedAt), fixAt(40, startedAt + 50_000)];
    const pauses = [{ startTime: startedAt + 60_000, endTime: null }];

    await rejoinGpsSession({ points, pauses, startedAt });

    const session = storedSession();
    expect(session.startedAt).toBe(startedAt);
    expect(session.points).toHaveLength(2);
    expect(session.pauses).toEqual(pauses);
    expect(watcher.added).toHaveLength(1);

    // And the run carries on: a new fix lands on top of what was restored.
    await watcher.callback!(fixAt(80, startedAt + 200_000));
    expect(storedSession().points).toHaveLength(3);
  });

  it("saves a rejoined run as a complete effort, with the pause excluded from its duration", async () => {
    const startedAt = Date.now() - 400_000;
    const points = [fixAt(0, startedAt), fixAt(40, startedAt + 30_000), fixAt(80, startedAt + 60_000)];
    // Five minutes standing still — comfortably past the acceptable-gap limit,
    // so without deducting it the run would be flagged as an interrupted one.
    const pauses = [{ startTime: startedAt + 60_000, endTime: startedAt + 360_000 }];

    await rejoinGpsSession({ points, pauses, startedAt });
    await watcher.callback!(fixAt(120, startedAt + 390_000));

    const summary = await stopGpsSession();

    expect(summary.isPartial).toBe(false);
    // 390s of wall clock less the 300s pause.
    expect(summary.durationSeconds).toBe(90);
  });
});
