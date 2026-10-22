import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_LIMITS,
  computeHeadroom,
  formatBytes,
  levelFor,
  overallLevel,
  pauseRisk,
  type HeadroomRaw,
} from "./supabase-headroom";

const NOW = new Date("2026-10-22T12:00:00Z");

function raw(over: Partial<HeadroomRaw> = {}): HeadroomRaw {
  return {
    database_bytes: 120 * 1024 * 1024,
    storage_bytes: 40 * 1024 * 1024,
    storage_objects: 30,
    users_total: 140,
    users_active_calendar_month: 55,
    users_active_30d: 70,
    users_onboarded: 120,
    activities_total: 3200,
    last_activity_at: "2026-10-22T09:00:00Z",
    measured_at: "2026-10-22T12:00:00Z",
    ...over,
  };
}

describe("levels", () => {
  it("turn amber at half and red at Supabase's own 80% email line", () => {
    expect(levelFor(0.49)).toBe("ok");
    expect(levelFor(0.5)).toBe("warn");
    expect(levelFor(0.8)).toBe("critical");
    expect(levelFor(1.3)).toBe("critical");
  });
});

describe("the pause check", () => {
  it("counts quiet days against the seven-day limit", () => {
    const r = pauseRisk("2026-10-18T12:00:00Z", NOW);
    expect(r.quietDays).toBe(4);
    expect(r.daysUntilPause).toBe(3);
    expect(r.level).toBe("warn");
    expect(r.note).toContain("4 quiet days");
  });

  it("is red from five quiet days, and never reports a negative countdown", () => {
    expect(pauseRisk("2026-10-16T12:00:00Z", NOW).level).toBe("critical");
    const past = pauseRisk("2026-10-01T00:00:00Z", NOW);
    expect(past.daysUntilPause).toBe(0);
  });

  it("is calm when something happened today", () => {
    const r = pauseRisk("2026-10-22T09:00:00Z", NOW);
    expect(r.level).toBe("ok");
    expect(r.note).toMatch(/today/);
  });

  it("treats no activity at all as the worst case", () => {
    expect(pauseRisk(null, NOW).level).toBe("critical");
  });
});

describe("computeHeadroom", () => {
  it("builds the three meters against the free-plan limits", () => {
    const h = computeHeadroom(raw(), NOW);
    const [mau, db, storage] = h.meters;
    expect(mau!.used).toBe(55);
    expect(mau!.limit).toBe(FREE_PLAN_LIMITS.monthlyActiveUsers);
    expect(mau!.level).toBe("ok");
    expect(db!.display).toBe("120.0 MB of 500.0 MB");
    expect(db!.fraction).toBeCloseTo(0.24);
    expect(storage!.display).toBe("40.0 MB of 1.00 GB");
  });

  it("uses the calendar-month figure for MAU, which is what Supabase bills", () => {
    const h = computeHeadroom(raw({ users_active_calendar_month: 10, users_active_30d: 99 }), NOW);
    expect(h.meters[0]!.used).toBe(10);
    expect(h.counts.usersActive30d).toBe(99);
  });

  it("lets a breach read as more than 100% rather than clamping", () => {
    const h = computeHeadroom(raw({ database_bytes: 600 * 1024 * 1024 }), NOW);
    expect(h.meters[1]!.fraction).toBeGreaterThan(1);
    expect(h.meters[1]!.level).toBe("critical");
  });
});

describe("overallLevel", () => {
  it("is the worst of the meters and the pause check", () => {
    expect(overallLevel(computeHeadroom(raw(), NOW))).toBe("ok");
    expect(overallLevel(computeHeadroom(raw({ last_activity_at: "2026-10-16T00:00:00Z" }), NOW))).toBe("critical");
    expect(overallLevel(computeHeadroom(raw({ storage_bytes: 600 * 1024 * 1024 }), NOW))).toBe("warn");
  });
});

describe("formatBytes", () => {
  it("picks the unit a person would", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.00 GB");
  });
});
