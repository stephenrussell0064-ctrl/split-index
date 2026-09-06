import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreActivity, computeExercise1RM, ScoringInputError } from "@/lib/scoring/service";
import { computeBodyBenchmarkEquivalentSeconds, mapSportToBenchmarkSport } from "@/lib/scoring/adapters";
import { buildScoringProfile } from "@/lib/activities/bodyweight";
import {
  upsertPersonalRecordsIfBetter,
  enduranceRecordCandidates,
  gymRecordCandidates,
  type PersonalRecordCandidate,
} from "@/lib/activities/personal-records";
import { ENDURANCE_SPORTS } from "@/lib/constants/sports";
import type { GymExerciseInput, SportType } from "@/types";

/**
 * Onboarding calibration (Slice 13) — user feedback: "When entering an
 * exercise to finish onboarding... do not log this as an activity just log
 * it as a stat for the user and calibrate a rough first score based off of
 * it. Allow the user to enter multiple stats as well such as all three of
 * their SBD and 5km run, 10km bike, 1km swim etc."
 *
 * Deliberately does NOT insert into `activities` — that table is the
 * athlete's real training history/logbook, and a synthetic "600-second gym
 * session" or a run that never actually happened at this exact timestamp
 * would misrepresent it. Instead this calls the same pure scoring function
 * (scoreActivity) the real logging route uses — no activity row required —
 * and persists only to `personal_records` (the stat itself, activity_id
 * null) and `predicted_benchmarks` (a sample_count=1 seed for cardio, so
 * race-ladder features have something immediately), plus one
 * `split_index_history` row so the dashboard isn't empty on first login.
 *
 * Multiple stats are supported by threading `recentActivityRows` forward
 * across calls within the same request — each subsequent scoreActivity()
 * call sees every earlier one, so the FINAL call's blended Lab+Engine
 * result already reflects everything entered, exactly like a real athlete
 * who logged all of these as separate sessions would end up with.
 */

const MIN_LIFT_KG = 0;
const MAX_LIFT_KG = 500;
const MIN_REPS = 1;
const MAX_REPS = 50;
const MIN_DISTANCE_METERS = 50;
const MAX_DISTANCE_METERS = 250_000;
const MIN_DURATION_SECONDS = 30;
const MAX_DURATION_SECONDS = 6 * 60 * 60;
/** Synthetic session length for the gym scoring call — DOTS/1RM/relative-strength are all set/weight/rep-derived, not duration-derived, so this only affects the (unused-here) load-score estimate. */
const GYM_SESSION_SECONDS_PER_LIFT = 300;

const SBD_EXERCISES: Record<"squat" | "bench" | "deadlift", { name: string; muscle: string }> = {
  squat: { name: "Squat", muscle: "Quads" },
  bench: { name: "Bench Press", muscle: "Chest" },
  deadlift: { name: "Deadlift", muscle: "Back" },
};

interface LiftInput {
  weightKg: number;
  reps: number;
}

interface CardioStatInput {
  sport: SportType;
  distanceMeters: number;
  durationSeconds: number;
}

function validLift(l: unknown): l is LiftInput {
  if (!l || typeof l !== "object") return false;
  const weightKg = Number((l as Record<string, unknown>).weightKg);
  const reps = Number((l as Record<string, unknown>).reps);
  return (
    Number.isFinite(weightKg) &&
    weightKg > MIN_LIFT_KG &&
    weightKg <= MAX_LIFT_KG &&
    Number.isFinite(reps) &&
    reps >= MIN_REPS &&
    reps <= MAX_REPS
  );
}

function validCardioStat(s: unknown): s is CardioStatInput {
  if (!s || typeof s !== "object") return false;
  const row = s as Record<string, unknown>;
  const distanceMeters = Number(row.distanceMeters);
  const durationSeconds = Number(row.durationSeconds);
  return (
    typeof row.sport === "string" &&
    (ENDURANCE_SPORTS as string[]).includes(row.sport) &&
    Number.isFinite(distanceMeters) &&
    distanceMeters >= MIN_DISTANCE_METERS &&
    distanceMeters <= MAX_DISTANCE_METERS &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= MIN_DURATION_SECONDS &&
    durationSeconds <= MAX_DURATION_SECONDS
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sbdInput = (body.sbd ?? {}) as Record<"squat" | "bench" | "deadlift", unknown>;
  const cardioInput = Array.isArray(body.cardio) ? body.cardio : [];

  const lifts = (["squat", "bench", "deadlift"] as const)
    .filter((key) => validLift(sbdInput[key]))
    .map((key) => ({ key, ...(sbdInput[key] as LiftInput) }));
  const cardioStats = cardioInput.filter(validCardioStat) as CardioStatInput[];

  if (lifts.length === 0 && cardioStats.length === 0) {
    return NextResponse.json(
      { error: "Enter at least one lift or cardio result to calibrate your score." },
      { status: 400 }
    );
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profileRow) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const scoringProfile = buildScoringProfile(profileRow, profileRow.weight_kg, profileRow.max_hr);
  const now = new Date().toISOString();

  const recentActivityRows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown?: Record<string, unknown> | null;
  }> = [];
  const recordCandidates: PersonalRecordCandidate[] = [];
  let lastResult: ReturnType<typeof scoreActivity> | null = null;

  try {
    if (lifts.length > 0) {
      const exercises: GymExerciseInput[] = lifts.map((l, i) => ({
        exercise_name: SBD_EXERCISES[l.key].name,
        muscle_group: SBD_EXERCISES[l.key].muscle,
        sets: [{ weight_kg: l.weightKg, reps: l.reps }],
        order_index: i,
      }));

      const result = scoreActivity(
        {
          sport: "gym",
          durationSeconds: GYM_SESSION_SECONDS_PER_LIFT * exercises.length,
          exercises,
          profile: scoringProfile,
          recentLoads: { acute: 0, chronic: 1 },
          startedAt: now,
        },
        { enduranceIndices: [], strengthIndices: [], splitIndices: [] },
        recentActivityRows
      );
      lastResult = result;
      recentActivityRows.push({
        sport: "gym",
        sport_index: result.sportIndex,
        started_at: now,
        score_breakdown: result.breakdown as unknown as Record<string, unknown>,
      });

      if (result.strengthScoreRows) {
        recordCandidates.push(
          ...gymRecordCandidates({
            activityId: null,
            achievedAt: now,
            exercises: result.strengthScoreRows.map((r) => ({
              exercise_name: r.exercise_name,
              estimated_1rm_kg: r.estimated_1rm_kg,
            })),
          })
        );
      } else {
        // Fallback if strengthScoreRows wasn't populated for some reason —
        // still record the raw estimated 1RM per lift directly.
        recordCandidates.push(
          ...gymRecordCandidates({
            activityId: null,
            achievedAt: now,
            exercises: lifts.map((l) => ({
              exercise_name: SBD_EXERCISES[l.key].name,
              estimated_1rm_kg: computeExercise1RM(l.weightKg, l.reps),
            })),
          })
        );
      }
    }

    for (const stat of cardioStats) {
      const result = scoreActivity(
        {
          sport: stat.sport,
          durationSeconds: stat.durationSeconds,
          distanceMeters: stat.distanceMeters,
          profile: scoringProfile,
          recentLoads: { acute: 0, chronic: 1 },
          startedAt: now,
        },
        { enduranceIndices: [], strengthIndices: [], splitIndices: [] },
        recentActivityRows
      );
      lastResult = result;
      recentActivityRows.push({
        sport: stat.sport,
        sport_index: result.sportIndex,
        started_at: now,
        score_breakdown: result.breakdown as unknown as Record<string, unknown>,
      });

      const benchmarkSport = mapSportToBenchmarkSport(stat.sport);
      const benchmarkEquivalentSeconds = computeBodyBenchmarkEquivalentSeconds(benchmarkSport, {
        distance_meters: stat.distanceMeters,
        duration_seconds: stat.durationSeconds,
      });

      if (benchmarkEquivalentSeconds != null && benchmarkEquivalentSeconds > 0) {
        await supabase.from("predicted_benchmarks").upsert(
          {
            user_id: user.id,
            sport: benchmarkSport,
            benchmark_seconds: benchmarkEquivalentSeconds,
            sample_count: 1,
            updated_at: now,
          },
          { onConflict: "user_id,sport" }
        );
      }

      recordCandidates.push(
        ...enduranceRecordCandidates({
          sport: stat.sport,
          activityId: null,
          achievedAt: now,
          distanceMeters: stat.distanceMeters,
          durationSeconds: stat.durationSeconds,
          benchmarkEquivalentSeconds,
        })
      );
    }
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (!lastResult) {
    // Unreachable given the length check above, but keeps TS satisfied.
    return NextResponse.json({ error: "Nothing to calibrate" }, { status: 400 });
  }

  await upsertPersonalRecordsIfBetter(supabase, user.id, recordCandidates);

  /*
    ONE estimate per athlete, and it is marked as one.

    Re-running calibration used to stack another undeletable row on top of the
    last, because nothing in the app could find either of them: every other
    writer of this table deletes by activity_id, and these rows have none.

    `is_provisional` (migration 059) is what makes them findable and what keeps
    them from outranking real training. Without it this row — stamped with
    signup time, while every real session carries its own back-dated date —
    stayed the newest row the athlete would ever have, so the profile's public
    index was pinned to a number typed into a form and could never be moved.
  */
  await supabase
    .from("split_index_history")
    .delete()
    .eq("user_id", user.id)
    .eq("is_provisional", true);

  const { error: historyError } = await supabase.from("split_index_history").insert({
    user_id: user.id,
    split_index: lastResult.splitIndex,
    endurance_index: lastResult.enduranceIndex,
    strength_index: lastResult.strengthIndex,
    fatigue_score: 0,
    recovery_score: 100,
    predicted_index_7d: lastResult.predictedIndex,
    activity_id: null,
    is_provisional: true,
  });

  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  return NextResponse.json({
    headline: lastResult.headline,
    headlineLabel: lastResult.headlineLabel,
    splitIndex: lastResult.splitIndex,
  });
}
