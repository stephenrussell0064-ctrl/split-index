/**
 * WP8, Rev 2 addition: "the diagnostic re-runs every four weeks against
 * accumulating data. If the emphasis vector shifts by more than 0.10 on any
 * dimension, the remaining macrocycle is regenerated and the athlete is shown
 * what changed and why."
 *
 * Before persistence existed, `compareEmphasis` was correct code that could
 * never fire — there was nothing stored to compare against. These tests exist
 * to keep it firing.
 */

import { describe, expect, it } from "vitest";
import { evaluateRerun, loadLatestStoredPlan, type StoredProfileSummary } from "./persistence";
import { DIAGNOSTIC_RERUN_WEEKS, EMPHASIS_KEYS, HPE_CONSTANTS_VERSION, type EmphasisKey } from "./constants";
import type { AthleteProfile, EmphasisVector } from "./types";

function vector(overrides: Partial<Record<EmphasisKey, number>> = {}): EmphasisVector {
  const even = 1 / EMPHASIS_KEYS.length;
  const base = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, even])) as EmphasisVector;
  return { ...base, ...overrides };
}

function storedProfile(overrides: Partial<StoredProfileSummary> = {}): StoredProfileSummary {
  return {
    id: "profile-1",
    generatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    constantsVersion: HPE_CONSTANTS_VERSION,
    tier: 2,
    emphasis: vector(),
    ...overrides,
  };
}

function nextProfile(emphasis: EmphasisVector, overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    constantsVersion: HPE_CONSTANTS_VERSION,
    tier: 2,
    emphasis,
    ...overrides,
  } as AthleteProfile;
}

const FOUR_WEEKS_LATER = new Date("2026-01-29T00:00:00Z");
const ONE_WEEK_LATER = new Date("2026-01-08T00:00:00Z");

describe("WP8 — the four-weekly diagnostic re-run", () => {
  it("does not regenerate before four weeks have passed, however far the vector moved", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 })),
      ONE_WEEK_LATER
    );
    expect(decision.due).toBe(false);
    expect(decision.shouldRegenerate).toBe(false);
    // The drift is still computed and reported — it is the ACTION that waits,
    // not the observation.
    expect(decision.drift!.shouldRegenerate).toBe(true);
  });

  it("regenerates when a dimension has shifted past the threshold and four weeks have passed", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 })),
      FOUR_WEEKS_LATER
    );
    expect(decision.due).toBe(true);
    expect(decision.shouldRegenerate).toBe(true);
    // "the athlete is shown what changed and why" — the explanation is not
    // optional garnish, it is the half of the requirement that distinguishes
    // a plan that adapts from a plan that silently changes.
    expect(decision.explanations.join(" ")).toMatch(/aerobic base up/);
    expect(decision.explanations.join(" ")).toMatch(/your own data/);
  });

  it("leaves the plan alone when the vector has barely moved", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 1 / EMPHASIS_KEYS.length + 0.02 })),
      FOUR_WEEKS_LATER
    );
    expect(decision.due).toBe(true);
    expect(decision.shouldRegenerate).toBe(false);
  });

  it("regenerates on a constants-version change regardless of drift, and says so", () => {
    const decision = evaluateRerun(
      storedProfile({ constantsVersion: "1.9.0" }),
      nextProfile(vector()),
      FOUR_WEEKS_LATER
    );
    expect(decision.shouldRegenerate).toBe(true);
    expect(decision.explanations.join(" ")).toMatch(/training-logic constants moved from 1\.9\.0/);
  });

  it("tells the athlete when their data-sufficiency tier has risen", () => {
    const decision = evaluateRerun(
      storedProfile({ tier: 2 }),
      nextProfile(vector(), { tier: 3 }),
      FOUR_WEEKS_LATER
    );
    expect(decision.shouldRegenerate).toBe(true);
    expect(decision.explanations.join(" ")).toMatch(/tier rose from 2 to 3/);
    expect(decision.explanations.join(" ")).toMatch(/bands narrow/);
  });

  it("treats a first run as due with no drift — absent history is not zero drift", () => {
    const decision = evaluateRerun(null, nextProfile(vector()), FOUR_WEEKS_LATER);
    expect(decision.due).toBe(true);
    expect(decision.drift).toBeNull();
    expect(decision.shouldRegenerate).toBe(false);
    expect(decision.explanations).toEqual([]);
  });

  it("uses the constant rather than a hardcoded interval", () => {
    const justUnder = new Date(
      new Date("2026-01-01T00:00:00Z").getTime() + (DIAGNOSTIC_RERUN_WEEKS * 7 - 1) * 86_400_000
    );
    const justOver = new Date(
      new Date("2026-01-01T00:00:00Z").getTime() + (DIAGNOSTIC_RERUN_WEEKS * 7 + 1) * 86_400_000
    );
    const moved = nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 }));
    expect(evaluateRerun(storedProfile(), moved, justUnder).due).toBe(false);
    expect(evaluateRerun(storedProfile(), moved, justOver).due).toBe(true);
  });
});

/**
 * The kill switch is a pause on GENERATION, not a revocation of the plan the
 * athlete is already following.
 *
 * When the switch was thrown mid-block, the screen said "Not yet — your
 * existing plan is still available and unchanged" and then showed no plan at
 * all, which made the reassurance a lie. The stored plan existed the whole
 * time; nothing read it back.
 */
describe("loadLatestStoredPlan", () => {
  /** Table-aware, because the loader now reads four of them. */
  function supabaseWith(opts: {
    plan?: unknown;
    sessions?: unknown[];
    profile?: unknown;
    findings?: unknown[];
  }) {
    const chain = (single: unknown, list: unknown[]) => {
      const thenable = {
        select: () => thenable,
        eq: () => thenable,
        order: () => thenable,
        limit: () => thenable,
        maybeSingle: async () => ({ data: single ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: list, error: null }),
      };
      return thenable;
    };
    return {
      from: (table: string) => {
        if (table === "hpe_plans") return chain(opts.plan ?? null, []);
        if (table === "hpe_sessions") return chain(null, opts.sessions ?? []);
        if (table === "hpe_athlete_profile") return chain(opts.profile ?? null, []);
        if (table === "hpe_findings") return chain(null, opts.findings ?? []);
        return chain(null, []);
      },
    } as never;
  }

  const storedProfileRow = {
    id: "profile-1",
    generated_at: "2026-08-01T00:00:00Z",
    constants_version: HPE_CONSTANTS_VERSION,
    tier: 2,
    emphasis: vector(),
  };
  const findingRows = [
    { finding_key: "F1", body: "Your aerobic base carries your 5k.", ordinal: 0 },
    { finding_key: "F3", body: "Your squat lags your deadlift.", ordinal: 1 },
  ];

  it("reconstructs weeks and placements a paused athlete can still read", async () => {
    const plan = { id: "plan-1", generated_at: "2026-08-01T00:00:00Z", constants_version: HPE_CONSTANTS_VERSION, weeks_out: 2 };
    const sessions = [
      { week: 1, phase: "base", is_deload: false, day_of_week: "Mon", slot: "pm", kind: "easy_run", domain: "endurance", emphasis_key: "aerobic_base", is_quality: false, minutes: 45, prescription: "Easy 8km", finding_id: "F1" },
      { week: 1, phase: "base", is_deload: false, day_of_week: "Tue", slot: "pm", kind: "strength_lower", domain: "strength", emphasis_key: "max_strength", is_quality: true, minutes: 60, prescription: "Squat 4x6", finding_id: "F3" },
      { week: 2, phase: "base", is_deload: true, day_of_week: "Mon", slot: "pm", kind: "long_run", domain: "endurance", emphasis_key: "aerobic_base", is_quality: true, minutes: 90, prescription: "Long 16km", finding_id: "F1" },
    ];

    const stored = await loadLatestStoredPlan(
      supabaseWith({ plan, sessions, profile: storedProfileRow, findings: findingRows }),
      "user-1"
    );

    expect(stored).not.toBeNull();
    expect(stored!.constantsVersion).toBe(HPE_CONSTANTS_VERSION);
    expect(stored!.weeks).toHaveLength(2);

    const [w1, w2] = stored!.weeks as Array<Record<string, unknown>>;
    expect((w1.placements as unknown[]).length).toBe(2);
    // Only the running session's minutes count toward endurance volume.
    expect(w1.enduranceMin).toBe(45);
    expect(w2.deload).toBe(true);
    expect(w2.enduranceMin).toBe(90);
  });

  it("returns null rather than an empty shell when nothing was ever stored", async () => {
    expect(await loadLatestStoredPlan(supabaseWith({}), "user-1")).toBeNull();
  });

  it("carries the profile and findings, without which the paused screen cannot render", async () => {
    const plan = { id: "plan-1", generated_at: "2026-08-01T00:00:00Z", constants_version: HPE_CONSTANTS_VERSION, weeks_out: 1 };
    const sessions = [
      { week: 1, phase: "base", is_deload: false, day_of_week: "Mon", slot: "pm", kind: "easy_run", domain: "endurance", emphasis_key: "aerobic_base", is_quality: false, minutes: 45, prescription: "Easy 8km", finding_id: "F1" },
    ];
    const stored = await loadLatestStoredPlan(
      supabaseWith({ plan, sessions, profile: storedProfileRow, findings: findingRows }),
      "user-1"
    );

    // The plan view resolves each session's finding id against this list. An
    // empty one turns a traceable block into an unexplained calendar.
    expect(stored!.profile).not.toBeNull();
    expect(stored!.profile!.findings.map((f) => f.id)).toEqual(["F1", "F3"]);
    expect(stored!.profile!.findings[0].text).toMatch(/aerobic base/);
    expect(stored!.profile!.tier).toBe(2);
  });

  it("satisfies the exact condition the paused screen branches on", async () => {
    const plan = { id: "plan-1", generated_at: "2026-08-01T00:00:00Z", constants_version: HPE_CONSTANTS_VERSION, weeks_out: 1 };
    const sessions = [
      { week: 1, phase: "base", is_deload: false, day_of_week: "Mon", slot: "pm", kind: "easy_run", domain: "endurance", emphasis_key: "aerobic_base", is_quality: false, minutes: 45, prescription: "Easy 8km", finding_id: "F1" },
    ];
    const stored = await loadLatestStoredPlan(
      supabaseWith({ plan, sessions, profile: storedProfileRow, findings: findingRows }),
      "user-1"
    );

    // This mirrors the route's paused response and the screen's guard:
    //   !generated && paused && weeks.length > 0 && profile
    //
    // The guard was unsatisfiable. The route sent weeks but set the profile to
    // null, so the branch never ran and the screen fell through to the refusal
    // path — printing "Not yet" over a plan sitting in the database. Both
    // halves are asserted here because either one alone passes while the
    // screen still shows nothing.
    const response = {
      generated: false,
      paused: true,
      weeks: stored?.weeks ?? [],
      profile: stored?.profile ?? null,
    };
    const pausedViewRenders =
      !response.generated && response.paused && response.weeks.length > 0 && response.profile != null;
    expect(pausedViewRenders).toBe(true);
  });

  it("falls back to the refusal screen when there genuinely is no stored plan", async () => {
    const stored = await loadLatestStoredPlan(supabaseWith({ profile: storedProfileRow }), "user-1");
    const response = { generated: false, paused: true, weeks: stored?.weeks ?? [], profile: stored?.profile ?? null };
    expect(!response.generated && response.paused && response.weeks.length > 0 && response.profile != null).toBe(false);
  });
});
