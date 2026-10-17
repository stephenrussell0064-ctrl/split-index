/**
 * A restored draft from another day does not carry its date into today.
 *
 * A run form abandoned on 23 September was restored three weeks later with
 * its original start time; the athlete typed that morning's 20km into it and
 * the session went into the logbook twenty-four days in the past.
 */
import { describe, expect, it } from "vitest";
import { createDefaultState, isStaleDraft, restoreDraftState, STALE_DRAFT_MS } from "./form-state";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-17T11:45:00").getTime();

describe("isStaleDraft", () => {
  it("is stale past the window, fresh inside it, and never stale without a timestamp", () => {
    expect(isStaleDraft(NOW - STALE_DRAFT_MS - 1, NOW)).toBe(true);
    expect(isStaleDraft(NOW - 2 * HOUR, NOW)).toBe(false);
    expect(isStaleDraft(null, NOW)).toBe(false);
    expect(isStaleDraft(undefined, NOW)).toBe(false);
  });
});

describe("restoreDraftState and the start time", () => {
  const draft = { ...createDefaultState("running", 78), startedAt: "2026-09-23T16:44", distance: "20", hours: "1", minutes: "30" };

  it("resets the date on a draft last saved weeks ago, and keeps everything else", () => {
    const restored = restoreDraftState("running", draft, 78, { savedAt: NOW - 24 * 24 * HOUR, now: NOW });
    expect(restored.startedAt).not.toBe("2026-09-23T16:44");
    expect(restored.startedAt.slice(0, 10)).toBe(createDefaultState("running", 78).startedAt.slice(0, 10));
    expect(restored.distance).toBe("20");
    expect(restored.hours).toBe("1");
    expect(restored.minutes).toBe("30");
  });

  it("keeps the date on a draft from earlier today", () => {
    const restored = restoreDraftState("running", draft, 78, { savedAt: NOW - HOUR, now: NOW });
    expect(restored.startedAt).toBe("2026-09-23T16:44");
  });

  it("keeps the date when nobody knows how old the draft is", () => {
    expect(restoreDraftState("running", draft, 78).startedAt).toBe("2026-09-23T16:44");
  });
});
