import { describe, expect, it } from "vitest";
import { parseIntakeRow, resolveIntakeInputs } from "./intake-record";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import type { RunLog, LiftSet } from "./types";

/**
 * Several plans for one athlete, back to back.
 *
 * The owner's check for the hybrid plan was "make multiple plans and see
 * that it works". The intake-to-plan test proves one plan survives the
 * seams; this proves that the same athlete, changing their answers between
 * builds the way a real person does — a race date appears, the block gets
 * shorter, the priority flips to lifting — gets a complete, DIFFERENT block
 * each time, rather than the first plan again or a refusal.
 */

const BASE_ROW: Record<string, unknown> = {
  sections_completed: ["health", "fuelling", "goal", "availability", "history", "body", "training", "recovery"],
  parq_positive: false, chest_pain_on_exertion: false, current_injury_limiting: false,
  injury_last_12_weeks: false, injury_sites: [], surgery_last_6_months: false,
  pregnant_or_postpartum_12wk: false, medication_affecting_hr: false,
  lea_restricted_food: false, lea_trains_fasted: false, lea_unintended_weight_loss: false,
  lea_bone_stress_injury: false, lea_amenorrhoea: false,
  event_date: null, plan_timeframe_weeks: 12, events: ["5k"],
  target_5k_s: 1080, target_squat_kg: null, target_bench_kg: null, target_deadlift_kg: null,
  priority: 0.4, priority_user_set: true, same_day: false, intends_weight_cut: false,
  days_available: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  gym_access_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  max_sessions_per_week: 6, max_hours_per_week: 9, max_session_min: 90, min_rest_days: 1,
  am_hour: 7, pm_hour: 18, two_a_days_possible: false, availability_varies: false, day_windows: [],
  preferred_rest_day: "Sun", preferred_long_day: "Sat",
  current_run_min_per_week: 150, longest_recent_run_min: 75, endurance_training_years: 4,
  previous_max_volume: 220, current_strength_sessions_per_week: 3, strength_training_years: 5,
  max_hr_known: true, hr_runs_high: false, max_hr_override: 192, resting_hr_override: 48,
  squat_1rm_override: 150, bench_1rm_override: 105, deadlift_1rm_override: 190,
  has_gym_access: true, training_split: "ppl", primary_modality: "run",
  substitution_ok: true, surface_access: ["road", "track"],
  sleep_hours_typical: 7.5, shift_work: false, job_physicality: "sedentary", life_stress_now: 3,
};

const PREFILLED = {
  age: 32, sex: "male" as const, bodyweightKg: 78, heightCm: 178,
  restingHr: 60, maxHr: 188,
  oneRms: { squat: 140, bench: 100, deadlift: 180 },
  predicted5kS: 1105,
  predicted5kFromEffort: true, loggedWeeklyRunMinutes: 148, chronicLoad: 420,
};

const RUN_LOGS: RunLog[] = [
  ...Array.from({ length: 16 }, (_, i) => ({ dateIdx: i * 3, distanceKm: 9, durationS: 9 * 312, avgHr: 150 })),
  ...Array.from({ length: 6 }, (_, i) => ({ dateIdx: i * 9 + 1, distanceKm: 5, durationS: 5 * 221, avgHr: 181 })),
  ...Array.from({ length: 5 }, (_, i) => ({ dateIdx: i * 12 + 2, distanceKm: 18, durationS: 18 * 335, avgHr: 146 })),
];
const LIFT_SETS: LiftSet[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5, lift: "squat", loadKg: 135, reps: 5 })),
  ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5 + 1, lift: "bench", loadKg: 95, reps: 5 })),
  ...Array.from({ length: 9 }, (_, i) => ({ dateIdx: i * 6, lift: "deadlift", loadKg: 175, reps: 3 })),
];

function build(overrides: Record<string, unknown>) {
  const record = parseIntakeRow({ ...BASE_ROW, ...overrides });
  const { state, goal, constraints } = resolveIntakeInputs(record, PREFILLED);
  const profile = diagnose(RUN_LOGS, LIFT_SETS, state.oneRms, {
    priority: goal.priority, hrMax: state.maxHr ?? 190, hrRest: state.restingHr, hrMaxSource: "measured",
  });
  return { goal, constraints, plan: generatePlan({ state, goal, constraints, profile }) };
}

/** A stable fingerprint of what the block actually prescribes, week by week. */
function fingerprint(plan: ReturnType<typeof build>["plan"]): string {
  return plan.weeks
    .map((w) =>
      w.placements
        .map((p) => `${p.day ?? "?"}:${p.session.kind}:${Math.round(p.session.minutes)}`)
        .join(",")
    )
    .join("|");
}

describe("the same athlete builds several plans in a row", () => {
  const first = build({});
  const withRace = build({
    // A race appears nine weeks out, so the block shortens to reach it.
    event_date: new Date(Date.now() + 9 * 7 * 86_400_000).toISOString().slice(0, 10),
    plan_timeframe_weeks: null,
  });
  const liftingFirst = build({
    // Same athlete, now a lifter who runs: priority flips and the week is tighter.
    priority: 0.75,
    target_squat_kg: 170,
    target_deadlift_kg: 210,
    max_sessions_per_week: 5,
    max_hours_per_week: 7,
    days_available: ["Mon", "Tue", "Thu", "Fri", "Sat"],
    gym_access_days: ["Mon", "Tue", "Thu", "Fri"],
  });

  it("generates every one of them, complete to the chosen horizon", () => {
    for (const { goal, plan } of [first, withRace, liftingFirst]) {
      expect(plan.generated).toBe(true);
      expect(plan.weeks).toHaveLength(goal.weeksOut);
      for (const week of plan.weeks) {
        expect(week.placements.length).toBeGreaterThan(0);
      }
    }
  });

  it("builds a genuinely different block when the goal changes, not the first one again", () => {
    const prints = [first, withRace, liftingFirst].map(({ plan }) => fingerprint(plan));
    expect(new Set(prints).size).toBe(3);
    // The race block is shorter than the open-ended one.
    expect(withRace.plan.weeks.length).toBeLessThan(first.plan.weeks.length);
    expect(withRace.goal.horizonSource).not.toBe("chosen_timeframe");
  });

  it("follows the new constraints, so the rebuilt plan is the athlete's and not a template", () => {
    const week = liftingFirst.plan.weeks[2]!;
    const days = new Set(week.placements.map((p) => p.day));
    // Wednesday and Sunday were removed from availability for the third build.
    expect(days.has("Wed")).toBe(false);
    expect(days.has("Sun")).toBe(false);
    // And the week respects the tighter session cap.
    expect(week.placements.length).toBeLessThanOrEqual(5);
    // While the original plan still used the full week it was given.
    const firstDays = new Set(first.plan.weeks[2]!.placements.map((p) => p.day));
    expect(firstDays.has("Wed")).toBe(true);
  });

  it("is deterministic: rebuilding with identical answers reproduces the same block", () => {
    const again = build({});
    expect(fingerprint(again.plan)).toBe(fingerprint(first.plan));
  });
});
