/**
 * Session-level behaviour for the movements with no reps: planks and carries.
 *
 * These go through the real entry point (`scoreActivityWithEngines`) rather
 * than the model in isolation, because every one of the bugs being pinned
 * here lived in the WIRING — the model was never reached at all:
 *   - a plank arrived at the rep-based engine as `weight_kg: 0, reps: 1`,
 *     scored the floor of 1, and was then dropped from `labIndex` by its
 *     `oneRM > 0` filter, so a core-only session's Lab Index was 1;
 *   - a sled push arrived as `weight_kg: 100, reps: 1` and was read as a
 *     100 kg ONE-REP MAX, scoring 979 — "World Class", above every real lift
 *     in the catalogue.
 */

import { describe, expect, it } from "vitest";
import {
  scoreActivityWithEngines,
  type ActivityScoreContext,
} from "@/lib/scoring/activity-scorer";
import type { GymExerciseInput, GymExerciseSet } from "@/types";

const PROFILE: ActivityScoreContext["profile"] = {
  weight_kg: 80,
  age: 30,
  gender: "male",
  experience: "intermediate",
  preferred_sports: ["gym"],
  split_endurance_weight: 0.5,
  max_hr: 190,
  resting_hr: 55,
};

function scoreSession(exercises: GymExerciseInput[]) {
  const context: ActivityScoreContext = {
    sport: "gym",
    durationSeconds: 3600,
    exercises,
    profile: PROFILE,
    recentLoads: { acute: 100, chronic: 100 },
  };
  return scoreActivityWithEngines(context, [], []);
}

function exercise(
  name: string,
  muscle: string,
  sets: GymExerciseSet[],
  orderIndex = 0
): GymExerciseInput {
  return { exercise_name: name, muscle_group: muscle, sets, order_index: orderIndex };
}

const plank = (durationSeconds: number, weightKg = 0): GymExerciseSet => ({
  // reps: 1 / weight_kg: 0 is what actually lands in the database — the
  // gym_exercises table has reps NOT NULL CHECK (reps > 0).
  weight_kg: weightKg,
  reps: 1,
  duration_seconds: durationSeconds,
});
const carry = (weightKg: number, distanceMeters: number): GymExerciseSet => ({
  weight_kg: weightKg,
  reps: 1,
  distance_meters: distanceMeters,
});
const lift = (weightKg: number, reps: number): GymExerciseSet => ({ weight_kg: weightKg, reps });

const SQUAT_SESSION = [exercise("Squat", "Quads", [lift(140, 5), lift(140, 5), lift(140, 5)])];

describe("a core-only session", () => {
  it("no longer scores 1", () => {
    const result = scoreSession([
      exercise("Plank", "Core", [plank(90), plank(75)]),
      exercise("Side Plank", "Core", [plank(60)], 1),
    ]);
    expect(result.sportIndex).toBeGreaterThan(300);
    expect(result.strengthComponent).toBe(result.sportIndex);
  });

  it("scores harder core work higher", () => {
    const easy = scoreSession([exercise("Plank", "Core", [plank(45)])]).sportIndex;
    const solid = scoreSession([exercise("Plank", "Core", [plank(150)])]).sportIndex;
    const loaded = scoreSession([
      exercise("Weighted Plank", "Core", [plank(150, 30)]),
    ]).sportIndex;
    expect(solid).toBeGreaterThan(easy);
    expect(loaded).toBeGreaterThan(solid);
  });

  it("records a real training load, where weight x reps recorded none", () => {
    const result = scoreSession([exercise("Plank", "Core", [plank(120), plank(120), plank(90)])]);
    // Every one of those sets is weight_kg 0, so the legacy volume metric
    // (weight x reps / 800) is exactly 0 and the session never touched ACWR.
    expect(result.loadScore).toBeGreaterThan(0);
  });

  it("does not fabricate a 1RM for the personal-records path", () => {
    const rows = scoreSession([exercise("Plank", "Core", [plank(120)])]).strengthScoreRows ?? [];
    expect(rows).toHaveLength(1);
    // gymRecordCandidates filters on estimated_1rm_kg > 0, so 0 keeps holds
    // out of the PR table rather than inventing a "1RM plank".
    expect(rows[0].estimated_1rm_kg).toBe(0);
    expect(rows[0].strength_index).toBeGreaterThan(0);
    expect(rows[0].volume_load_kg).toBeGreaterThan(0);
  });
});

describe("a carry-only session", () => {
  it("scores meaningfully instead of at the floor", () => {
    const result = scoreSession([
      exercise("Farmer's Carry", "Core", [carry(40, 20), carry(40, 20)]),
    ]);
    expect(result.sportIndex).toBeGreaterThan(400);
  });

  it("reads the load as per hand, so 40s in both hands is 80kg carried", () => {
    // weight-entry.ts defaults carries to perHand; the anchors are defined on
    // total load. Entering 40 therefore means 80kg carried, and must score
    // the same as explicitly logging 80kg total.
    const perHand = scoreSession([exercise("Farmer's Carry", "Core", [carry(40, 30)])]);
    const total = scoreSession([
      {
        ...exercise("Farmer's Carry", "Core", [carry(80, 30)]),
        weight_entry_mode: "total",
      },
    ]);
    expect(perHand.sportIndex).toBe(total.sportIndex);
  });

  it("closes the sled-push scoring exploit", () => {
    // Before: a 100kg sled push was read as a 100kg one-rep max and scored
    // 979 — past NEAR_RECORD_THRESHOLD, above any real lift.
    const sled = scoreSession([exercise("Sled Push", "Quads", [carry(100, 20)])]);
    expect(sled.sportIndex).toBeLessThan(500);
    expect(sled.sportIndex).toBeGreaterThan(200);
  });
});

describe("holds and carries cannot out-score real lifting", () => {
  const squat = scoreSession(SQUAT_SESSION).sportIndex;

  it("a heavy squat session beats the best possible plank session", () => {
    const marathonPlank = scoreSession([
      exercise("Plank", "Core", [plank(1800, 100)]),
    ]).sportIndex;
    expect(marathonPlank).toBeLessThan(squat);
  });

  it("a heavy squat session beats the best possible carry/sled session", () => {
    const monsterCarry = scoreSession([
      exercise("Farmer's Carry", "Core", [carry(200, 200)]),
      exercise("Sled Push", "Quads", [carry(400, 200)], 1),
    ]).sportIndex;
    expect(monsterCarry).toBeLessThan(squat);
  });

  it("holds a 30-minute plank flat against a five-minute one", () => {
    expect(scoreSession([exercise("Plank", "Core", [plank(1800)])]).sportIndex).toBe(
      scoreSession([exercise("Plank", "Core", [plank(300)])]).sportIndex
    );
  });
});

describe("a mixed session is not diluted by its accessory work", () => {
  const squatOnly = scoreSession(SQUAT_SESSION);

  it("scores identically with a plank and a carry bolted on", () => {
    const mixed = scoreSession([
      ...SQUAT_SESSION,
      exercise("Plank", "Core", [plank(60)], 1),
      exercise("Farmer's Carry", "Core", [carry(30, 20)], 2),
    ]);
    expect(mixed.sportIndex).toBe(squatOnly.sportIndex);
    // ...including when the accessory work is at the family cap, so this is a
    // rule about which results aggregate, not a coincidence of magnitudes.
    const withCappedCarry = scoreSession([
      ...SQUAT_SESSION,
      exercise("Sled Push", "Quads", [carry(400, 200)], 1),
    ]);
    expect(withCappedCarry.sportIndex).toBe(squatOnly.sportIndex);
  });

  it("still records and displays the accessory work per exercise", () => {
    const mixed = scoreSession([
      ...SQUAT_SESSION,
      exercise("Plank", "Core", [plank(120)], 1),
    ]);
    const activities = mixed.strengthActivities ?? [];
    expect(activities).toHaveLength(2);
    const hold = activities.find((r) => r.flags.includes("isometric-hold"));
    expect(hold?.score).toBe(500);
    expect(hold?.exerciseIndex).toBe(1);
    expect(mixed.strengthScoreRows).toHaveLength(2);
  });

  it("adds the accessory work to training load even though it does not move the index", () => {
    const mixed = scoreSession([
      ...SQUAT_SESSION,
      exercise("Plank", "Core", [plank(120), plank(120)], 1),
    ]);
    expect(mixed.loadScore).toBeGreaterThan(squatOnly.loadScore);
  });

  it("no longer lets a plank drag down the session's confidence", () => {
    // The plank used to return oneRMConfidence 0 (its "no-valid-set" early
    // return), which was averaged into the session confidence that
    // index-engine weights the whole Lab Index by.
    const mixed = scoreSession([...SQUAT_SESSION, exercise("Plank", "Core", [plank(60)], 1)]);
    expect(mixed.activityConfidence).toBe(squatOnly.activityConfidence);
  });
});

describe("rep-based sessions are untouched", () => {
  it("scores a barbell session exactly as before", () => {
    const result = scoreSession([
      exercise("Squat", "Quads", [lift(140, 5)]),
      exercise("Bench Press", "Chest", [lift(100, 5)], 1),
      exercise("Barbell Row", "Back", [lift(80, 8)], 2),
    ]);
    // 787 -> 828 in the Strength-Level anchor-table pass. This assertion is
    // what it says on the describe block — a guard that the HOLD/CARRY work
    // leaves rep-based sessions alone — and that still holds: nothing in the
    // hold/carry path moved it. The number itself is a calibration snapshot,
    // and Squat and Barbell Row both moved onto real anchor tables in that
    // pass, so the fixture is re-taken rather than defended. Bench Press is
    // unchanged, and this athlete is 30 so no age coefficient applies either:
    // the whole delta is Squat and Barbell Row moving onto their own tables.
    expect(result.sportIndex).toBe(828);
    expect(result.strengthActivities).toHaveLength(3);
    expect(result.strengthActivities?.every((r) => r.oneRM > 0)).toBe(true);
  });
});

describe("a hold or carry logged without its measurement", () => {
  // Only reachable by a client that posts set_details without
  // duration_seconds/distance_meters — the gym form always sends them.
  it("is recorded but not scored, and never re-read as a one-rep max", () => {
    const result = scoreSession([exercise("Sled Push", "Quads", [{ weight_kg: 100, reps: 1 }])]);
    // The pre-fix reading of this exact payload was 979.
    expect(result.sportIndex).toBeLessThan(100);
    const rows = result.strengthScoreRows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].strength_index).toBe(0);
    expect(result.strengthActivities?.[0].flags).toContain("hold-carry-measurement-missing");
  });
});
