import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedGymTimerState,
  loadPersistedTimerState,
  persistTimerState,
  MAX_RESTORE_AGE_MS,
  type PersistedTimerState,
} from "./gym-timer-storage";

/**
 * FORTY MINUTES INTO A SESSION, THE PHONE RINGS.
 *
 * The timer persisted to sessionStorage, on the reasoning that it is ephemeral
 * state and `workout_drafts` already covers the logged sets across a relaunch.
 * The sets, yes — but not the clock. iOS reclaims a backgrounded WebView
 * routinely, and sessionStorage dies with it, so the athlete came back to their
 * sets intact and the workout clock at 0:00. That clock is the one number this
 * component exists to produce: its whole job is handing an elapsed time to the
 * duration field so nobody has to estimate it after the fact.
 *
 * localStorage survives the kill. What it does not do is expire, which
 * sessionStorage got for free — hence the age guard these tests are mostly
 * about.
 */

const store = new Map<string, string>();
const KEY = "split-index-gym-timer";

const MID_WORKOUT: PersistedTimerState = {
  running: true,
  pausedElapsedMs: 0,
  effectiveStartMs: 1_000_000,
  restEndMs: null,
  hasLiveActivity: true,
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  vi.stubGlobal("localStorage", (globalThis as unknown as { window: Window }).window.localStorage);
});

afterEach(() => vi.unstubAllGlobals());

describe("a workout the app was killed during", () => {
  it("comes back with its clock", () => {
    const savedAtMs = 5_000_000;
    persistTimerState({ ...MID_WORKOUT, savedAtMs });

    // An hour later, on a fresh launch.
    const restored = loadPersistedTimerState(savedAtMs + 60 * 60 * 1000);

    expect(restored).toMatchObject({ running: true, effectiveStartMs: 1_000_000 });
  });

  it("keeps a rest countdown that has not finished", () => {
    const savedAtMs = 5_000_000;
    persistTimerState({ ...MID_WORKOUT, restEndMs: savedAtMs + 90_000, savedAtMs });
    expect(loadPersistedTimerState(savedAtMs + 30_000)?.restEndMs).toBe(savedAtMs + 90_000);
  });
});

describe("a workout that was abandoned rather than interrupted", () => {
  it("is not restored the next day", () => {
    // Without this, The Lab opens with a clock reading nineteen hours and a
    // Live Activity nobody asked for.
    const savedAtMs = 5_000_000;
    persistTimerState({ ...MID_WORKOUT, savedAtMs });

    expect(loadPersistedTimerState(savedAtMs + MAX_RESTORE_AGE_MS + 1)).toBeNull();
  });

  it("is cleared, not just ignored", () => {
    const savedAtMs = 5_000_000;
    persistTimerState({ ...MID_WORKOUT, savedAtMs });

    loadPersistedTimerState(savedAtMs + MAX_RESTORE_AGE_MS + 1);

    expect(store.get(KEY)).toBeUndefined();
  });

  it("survives right up to the cutoff", () => {
    const savedAtMs = 5_000_000;
    persistTimerState({ ...MID_WORKOUT, savedAtMs });
    expect(loadPersistedTimerState(savedAtMs + MAX_RESTORE_AGE_MS)).not.toBeNull();
  });
});

describe("a record written before the store moved", () => {
  it("is aged from the clock's own start, since it has no savedAtMs", () => {
    store.set(KEY, JSON.stringify({ ...MID_WORKOUT, effectiveStartMs: 1_000_000 }));

    expect(loadPersistedTimerState(1_000_000 + 60_000)).not.toBeNull();
    expect(loadPersistedTimerState(1_000_000 + MAX_RESTORE_AGE_MS + 1)).toBeNull();
  });

  it("is kept when it has no anchor at all — a paused timer is still someone's session", () => {
    store.set(KEY, JSON.stringify({ ...MID_WORKOUT, running: false, effectiveStartMs: null }));
    expect(loadPersistedTimerState(Date.now())).not.toBeNull();
  });
});

describe("nothing to restore", () => {
  it("is not an error", () => {
    expect(loadPersistedTimerState()).toBeNull();
  });

  it("survives a corrupted record", () => {
    store.set(KEY, "{not json");
    expect(loadPersistedTimerState()).toBeNull();
  });

  it("is what a finished workout leaves behind", () => {
    persistTimerState({ ...MID_WORKOUT, savedAtMs: Date.now() });
    clearPersistedGymTimerState();
    expect(loadPersistedTimerState()).toBeNull();
  });
});
