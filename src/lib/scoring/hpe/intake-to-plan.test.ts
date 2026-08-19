import { describe, expect, it } from "vitest";
import { parseIntakeRow, resolveIntakeInputs } from "./intake-record";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import type { RunLog, LiftSet } from "./types";


/**
 * The whole intake, end to end, through the exact path the route takes:
 * parseIntakeRow -> resolveIntakeInputs -> diagnose -> generatePlan.
 *
 * Every unit here is covered elsewhere. What this catches is the seams between
 * them, which is where every defect in this engine has actually lived — a
 * value the athlete supplied reaching one stage and not the next. It was
 * written as a throwaway probe to test the regrouped intake and immediately
 * found five: strength sessions displaying as 0 minutes, the chosen split not
 * reaching the session label, a stall rationale rendering as an exercise, a
 * stall variation contradicting the exercise it was attached to, and two
 * scheduling preferences that were collected and parsed and never wired to
 * anything. It earns its place.
 */
describe("intake to plan, end to end", () => {
  it("carries every answer through to the plan", () => {
    // Exactly what the wizard writes after every section is completed.
    const row: Record<string, unknown> = {
      sections_completed: ["health", "fuelling", "goal", "availability", "history", "body", "training", "recovery"],
      // health
      parq_positive: false, chest_pain_on_exertion: false, current_injury_limiting: false,
      injury_last_12_weeks: false, injury_sites: [], surgery_last_6_months: false,
      pregnant_or_postpartum_12wk: false, medication_affecting_hr: false,
      // fuelling — trains fasted, which must NOT count against him
      lea_restricted_food: false, lea_trains_fasted: true, lea_unintended_weight_loss: false,
      lea_bone_stress_injury: false, lea_amenorrhoea: false,
      // goal — no event, just training, 12-week block, sub-18 5k
      event_date: null, plan_timeframe_weeks: 12, events: ["5k"],
      target_5k_s: 1080, target_squat_kg: null, target_bench_kg: null, target_deadlift_kg: null,
      priority: 0.4, priority_user_set: true, same_day: false, intends_weight_cut: false,
      // availability
      days_available: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      gym_access_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      max_sessions_per_week: 6, max_hours_per_week: 9, max_session_min: 90, min_rest_days: 1,
      am_hour: 7, pm_hour: 18, two_a_days_possible: false, availability_varies: false, day_windows: [],
      preferred_rest_day: "Sun", preferred_long_day: "Sat",
      // history
      current_run_min_per_week: 150, longest_recent_run_min: 75, endurance_training_years: 4,
      previous_max_volume: 220, current_strength_sessions_per_week: 3, strength_training_years: 5,
      // body — corrects the engine's guesses
      max_hr_known: true, hr_runs_high: false, max_hr_override: 192, resting_hr_override: 48,
      squat_1rm_override: 150, bench_1rm_override: 105, deadlift_1rm_override: 190,
      // training
      has_gym_access: true, training_split: "ppl", primary_modality: "run",
      substitution_ok: true, surface_access: ["road", "track"],
      // recovery
      sleep_hours_typical: 7.5, shift_work: false, job_physicality: "sedentary", life_stress_now: 3,
    };

    const record = parseIntakeRow(row);
    const prefilled = {
      age: 32, sex: "male" as const, bodyweightKg: 78, heightCm: 178,
      restingHr: 60, maxHr: 188, // deliberately wrong — the overrides must win
      oneRms: { squat: 140, bench: 100, deadlift: 180 },
      predicted5kS: 1105, loggedWeeklyRunMinutes: 148, chronicLoad: 420,
    };

    const { state, goal, constraints, assumed, missingSections } = resolveIntakeInputs(record, prefilled);

    const runLogs: RunLog[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ dateIdx: i * 3, distanceKm: 9, durationS: 9 * 312, avgHr: 150 })),
      ...Array.from({ length: 6 }, (_, i) => ({ dateIdx: i * 9 + 1, distanceKm: 5, durationS: 5 * 221, avgHr: 181 })),
      ...Array.from({ length: 5 }, (_, i) => ({ dateIdx: i * 12 + 2, distanceKm: 18, durationS: 18 * 335, avgHr: 146 })),
    ];
    const liftSets: LiftSet[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5, lift: "squat", loadKg: 135, reps: 5 })),
      ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5 + 1, lift: "bench", loadKg: 95, reps: 5 })),
      ...Array.from({ length: 9 }, (_, i) => ({ dateIdx: i * 6, lift: "deadlift", loadKg: 175, reps: 3 })),
    ];
    const profile = diagnose(runLogs, liftSets, state.oneRms, {
      priority: goal.priority, hrMax: state.maxHr ?? 190, hrRest: state.restingHr, hrMaxSource: "measured",
    });

    const plan = generatePlan({ state, goal, constraints, profile });

    // ---- what the athlete typed must survive to the plan -----------------
    expect(missingSections).toEqual([]);
    // The engine reports what it had to assume rather than guessing silently.
    expect(assumed.join(" ")).toMatch(/your logs show 148/);
    // Overrides beat the profile's own numbers, which are deliberately wrong here.
    expect(state.maxHr).toBe(192);
    expect(state.restingHr).toBe(48);
    expect(state.oneRms).toMatchObject({ squat: 150, bench: 105, deadlift: 190 });
    // Training fasted must not count as a low-energy-availability flag.
    expect(state.safety.leaRiskFlags).toBe(0);
    expect(state.safety.leaScreenAnswered).toBe(true);
    // No event, so the chosen block length governs.
    expect(goal.weeksOut).toBe(12);
    expect(goal.horizonSource).toBe("chosen_timeframe");
    // Gym access implies a barbell without the athlete ticking a list.
    expect(constraints.trainingSplit).toBe("ppl");
    expect(constraints.equipment).toContain("barbell");

    expect(plan.generated).toBe(true);
    expect(plan.weeks).toHaveLength(12);
    // Nothing in the health screen was flagged, so nothing is capped.
    expect(plan.safety.intensityCeiling).toBe(1);
    expect(plan.feasibility!.messages.join(" ")).toMatch(/not improve in a straight line/);

    const w = plan.weeks[3];
    const strength = w.sessions.filter((x) => x.domain === "strength");
    expect(strength.length).toBeGreaterThan(0);
    for (const x of strength) {
      // Labelled the way the athlete thinks of it, not "bench_volume".
      // Labelled the way the athlete thinks of it, not "bench_volume". The
      // weak-lift session sits outside the split and says so.
      expect(x.label).toBeTruthy();
      expect(["Push", "Pull", "Legs"].includes(x.label!) || /^Extra /.test(x.label!)).toBe(true);
      // A session that takes no time cannot be budgeted against the hours the
      // athlete said they had.
      expect(x.minutes).toBeGreaterThan(30);
      // Rationale lives in notes, so every entry here is an exercise.
      expect(x.prescription.text.split("·").length).toBeGreaterThanOrEqual(5);
      expect(x.prescription.text).not.toMatch(/replaces the competition/);
      // The lead exercise and any note about it must name the same lift.
      const lead = x.prescription.text.split("·")[0];
      for (const n of x.prescription.notes ?? []) {
        const named = n.match(/^([A-Z][A-Za-z- ]+?) replaces/);
        if (named) expect(lead).toContain(named[1]);
      }
    }

    // Soft preferences: collected, parsed, and now actually honoured.
    const days = new Set(w.placements.map((x) => x.day));
    expect(days.has("Sun")).toBe(false);
    expect(w.placements.find((x) => x.session.kind === "long_run")?.day).toBe("Sat");
  });
});
