import {
  scoreActivityWithEngines,
  type ActivityScoreContext,
  type ActivityScoreOutput,
} from "@/lib/scoring/activity-scorer";
import { computeRecentLoads } from "@/lib/scoring/service";
import { computeIndexes, type ActivityScore } from "@/lib/scoring/index-engine";
import { calculateACWR } from "@/lib/scoring/engine";
import { injuryRisk, type InjuryRiskResult } from "@/lib/scoring/injury-risk";
import {
  mapSportToBenchmarkSport,
  computeBodyBenchmarkEquivalentSeconds,
} from "@/lib/scoring/adapters";
import {
  blendPredictedBenchmark,
  effectiveStoredPrediction,
  sessionCountsAsQuality,
  personalEasyEffortBaselineEF,
  personalEasyEffortBaselinePaceSeconds,
  personalRecentHardEffortBenchmarkSeconds,
  terrainAdjustedSessionEF,
  isDirectBenchmarkDistance,
  RELATIVE_EFFORT_SESSION_TYPES,
} from "@/lib/scoring/cardio-predictions";
import {
  personalizeRiegelKFromWindow,
  computeWindowedTier2Seconds,
  type HistorySession,
} from "@/lib/scoring/cardio/race-prediction";
import { BENCHMARK_DISTANCE_METERS } from "@/lib/scoring/cardio-benchmarks";
import { normalizeName, type LoggedSet } from "@/lib/scoring/split-strength-engine";
import type { GymExerciseInput, SportType, SessionType } from "@/types";
import type { Persona, WeeklyPattern } from "./personas";

/**
 * Drives a persona through the app the way the app actually runs.
 *
 * The important design constraint: this calls the REAL engines
 * (`scoreActivityWithEngines`, `computeIndexes`, `computeRecentLoads`,
 * `calculateACWR`) in the same order and with the same accumulating state that
 * `api/activities/route.ts` uses when a person taps Save. It is not a
 * re-implementation with the answers written in. If the engines are wrong, this
 * is wrong in exactly the same way, which is the point — a bot that computes
 * its own expected values only tests the bot.
 *
 * What it deliberately does NOT do is touch Supabase, the network or a browser.
 * A UAT suite that needs a seeded database and a running dev server does not
 * run at 3am unattended, and one that never runs finds nothing.
 *
 * Randomness is seeded, so a failure is reproducible from the persona id alone.
 */

/** Deterministic PRNG — mulberry32. Same persona, same sessions, every run. */
function seeded(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

export interface SimulatedSession {
  index: number;
  week: number;
  date: string;
  sport: SportType;
  sessionType: SessionType;
  /** The engine's output for this session — the real thing, unmodified. */
  output: ActivityScoreOutput;
  /** The athlete's headline index AFTER this session, as the dashboard would show. */
  splitIndex: number;
  acwr: number;
  risk: InjuryRiskResult;
}

export interface SimulationResult {
  persona: Persona;
  sessions: SimulatedSession[];
  /** Anything that threw. An empty array is the only acceptable value. */
  failures: Array<{ sessionIndex: number; sport: SportType; error: string }>;
  finalIndex: number;
  firstIndex: number;
  peakAcwr: number;
  minAcwr: number;
}

/**
 * How hard this athlete is going in a given week, as a multiplier on their
 * baseline. The trajectories are shaped to be realistic rather than tidy: real
 * improvement is noisy and decelerating, not a straight line.
 */
function performanceFactor(persona: Persona, week: number, rand: () => number): number {
  const progress = persona.weeks <= 1 ? 0 : week / (persona.weeks - 1);
  const noise = 1 + (rand() - 0.5) * 0.04;

  switch (persona.trajectory) {
    case "improving":
      // Decelerating gains — most of the improvement arrives early.
      return (1 + 0.12 * Math.sqrt(progress)) * noise;
    case "plateau":
      return noise;
    case "overreaching":
      // Performance actually dips as fatigue accumulates, which is the point:
      // the athlete is doing more and getting worse.
      return (1 - 0.05 * progress) * noise;
    case "detrained-returning": {
      // Six weeks off has already happened before week 0; they start well down
      // and climb back, without quite reaching where they were.
      const recovery = Math.min(1, progress * 1.6);
      return (0.82 + 0.15 * recovery) * noise;
    }
  }
}

/** Weekly volume multiplier — separate from performance, because they diverge. */
function volumeFactor(persona: Persona, week: number): number {
  const progress = persona.weeks <= 1 ? 0 : week / (persona.weeks - 1);
  switch (persona.trajectory) {
    case "overreaching":
      // 40km to 90km in a few weeks. This is what must trip the risk index.
      return 1 + 1.3 * Math.min(1, progress * 2.5);
    case "detrained-returning":
      return 0.45 + 0.55 * progress;
    default:
      return 1;
  }
}

const GYM_TEMPLATE: Array<{ name: string; group: string; key: keyof Persona["baseline"] }> = [
  { name: "Back Squat", group: "legs", key: "squat1RM" },
  { name: "Bench Press", group: "chest", key: "bench1RM" },
  { name: "Deadlift", group: "back", key: "deadlift1RM" },
];

function buildGymExercises(
  persona: Persona,
  factor: number,
  rand: () => number
): GymExerciseInput[] {
  return GYM_TEMPLATE.filter((t) => persona.baseline[t.key] != null).map((t, i) => {
    const oneRm = (persona.baseline[t.key] as number) * factor;
    // A working set the athlete would actually do: 5 reps at about 80% of 1RM,
    // rounded to a plate increment because nobody loads 83.7kg.
    const reps = 5;
    const target = oneRm * 0.8;
    const weight = Math.round((target * (1 + (rand() - 0.5) * 0.03)) / 2.5) * 2.5;
    return {
      exercise_name: t.name,
      muscle_group: t.group,
      order_index: i,
      sets: [
        { weight_kg: weight, reps, rpe: 8 },
        { weight_kg: weight, reps, rpe: 8.5 },
        { weight_kg: weight, reps: reps - 1, rpe: 9 },
      ],
    };
  });
}

/** Distance and duration for one endurance session, in the athlete's own terms. */
function buildEnduranceSession(
  persona: Persona,
  pattern: WeeklyPattern,
  factor: number,
  volume: number,
  rand: () => number
): { distanceMeters: number; durationSeconds: number; avgHeartRate: number } {
  const basePace = persona.baseline.easyPaceSecPerKm ?? 300;

  // Session shape. Faster sessions are shorter; long runs are slower.
  const shape: Record<string, { paceMult: number; km: number }> = {
    easy: { paceMult: 1.0, km: 8 },
    recovery: { paceMult: 1.08, km: 6 },
    long: { paceMult: 1.05, km: 18 },
    tempo: { paceMult: 0.9, km: 10 },
    threshold: { paceMult: 0.88, km: 8 },
    interval: { paceMult: 0.82, km: 9 },
    fartlek: { paceMult: 0.9, km: 9 },
    race: { paceMult: 0.78, km: 10 },
    other: { paceMult: 1.0, km: 8 },
  };
  const s = shape[pattern.sessionType] ?? shape.other;

  // Sport distance scales: you do not swim 18km or cycle 8km.
  const sportKmScale: Partial<Record<SportType, number>> = {
    swimming: 0.18,
    outdoor_cycling: 4.0,
    indoor_cycling: 2.6,
    bike_erg: 2.6,
    rowing: 0.9,
    ski_erg: 0.7,
    walking: 0.7,
  };
  const km = s.km * (sportKmScale[pattern.sport] ?? 1) * volume * (1 + (rand() - 0.5) * 0.1);

  // Faster athlete = lower pace number, so improvement divides.
  const pace = (basePace * s.paceMult) / factor;
  const durationSeconds = Math.round(km * pace);

  const maxHr = persona.profile.max_hr ?? 220 - persona.profile.age;
  const hrFraction: Record<string, number> = {
    recovery: 0.65,
    easy: 0.72,
    long: 0.75,
    tempo: 0.85,
    threshold: 0.88,
    interval: 0.91,
    fartlek: 0.86,
    race: 0.93,
    other: 0.75,
  };
  const avgHeartRate = Math.round(
    maxHr * (hrFraction[pattern.sessionType] ?? 0.75) * (1 + (rand() - 0.5) * 0.03)
  );

  return {
    distanceMeters: Math.round(km * 1000),
    durationSeconds,
    avgHeartRate,
  };
}

/** Expand a weekly pattern into the actual sessions for one week. */
function sessionsForWeek(persona: Persona, week: number, rand: () => number): WeeklyPattern[] {
  const out: WeeklyPattern[] = [];
  for (const p of persona.pattern) {
    const whole = Math.floor(p.perWeek);
    for (let i = 0; i < whole; i++) out.push(p);
    // A 0.5/week pattern happens in about half of weeks — this is what makes
    // the sporadic athlete's data genuinely gappy rather than evenly thin.
    if (p.perWeek % 1 > 0 && rand() < p.perWeek % 1) out.push(p);
  }
  return out;
}

export function simulate(persona: Persona, now = Date.parse("2026-06-01T07:00:00Z")): SimulationResult {
  const rand = seeded(persona.id);
  const sessions: SimulatedSession[] = [];
  const failures: SimulationResult["failures"] = [];

  // Accumulating athlete state, exactly as the API route accumulates it.
  const loadScores: { load_score: number; created_at: string }[] = [];
  const recentRows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown?: Record<string, unknown> | null;
  }> = [];
  const activityScores: ActivityScore[] = [];
  /**
   * The athlete's full logged history per exercise, which is what the premium
   * adaptive 1RM model reads.
   *
   * Two details here are load-bearing and both were wrong first time round, in
   * a way nothing caught: the keys must be `normalizeName`d, and the values are
   * `LoggedSet` — camelCase `weightKg`, and a REQUIRED `performedAt`, because
   * the model decays old sets by recency. Feeding it the snake_case
   * `GymExerciseSet` shape from the logging form instead handed it `undefined`
   * weights and no dates, and every gym score across every persona decayed to
   * 1 over a few weeks. That looked exactly like a real bug in strength
   * scoring, and was entirely this harness.
   */
  const exerciseHistory: Record<string, LoggedSet[]> = {};

  /**
   * Stands in for the `predicted_benchmarks` row plus the 90-day same-sport
   * window the route re-reads on every save. Keyed by benchmark sport, because
   * that is how the route keys it — running and walking share one, the ergs do
   * not.
   */
  const benchmarkState: Record<
    string,
    {
      window: HistorySession[];
      easyScores: number[];
      predictionSeconds: number | null;
      updatedAt: string;
      lastQualityAt: string;
      riegelK: number | null;
    }
  > = {};

  const startedAtMs = now - persona.weeks * 7 * DAY;
  let index = 0;

  for (let week = 0; week < persona.weeks; week++) {
    const factor = performanceFactor(persona, week, rand);
    const volume = volumeFactor(persona, week);
    const weekSessions = sessionsForWeek(persona, week, rand);

    weekSessions.forEach((pattern, dayIdx) => {
      // Spread sessions across the week rather than stacking them on one day.
      const dayOffset = Math.floor((dayIdx * 7) / Math.max(weekSessions.length, 1));
      const at = startedAtMs + week * 7 * DAY + dayOffset * DAY;
      const startedAt = new Date(at).toISOString();

      const recentLoads = computeRecentLoads(loadScores, at);

      let ctx: ActivityScoreContext;
      // Set by the endurance branch; appended to the window only AFTER the
      // session scores, so a session never personalises against itself.
      let pendingWindowEntry: { benchmarkSport: string; session: HistorySession } | null = null;

      if (pattern.sport === "gym") {
        const exercises = buildGymExercises(persona, factor, rand);
        ctx = {
          sport: "gym",
          durationSeconds: 60 * 60,
          sessionType: pattern.sessionType,
          exercises,
          exerciseHistory,
          isPremium: true,
          profile: persona.profile,
          recentLoads,
          startedAt,
        };
      } else {
        const e = buildEnduranceSession(persona, pattern, factor, volume, rand);

        /*
         * Everything from here to the end of this branch reproduces what
         * `api/activities/route.ts` does before it calls the scorer, using the
         * same helpers in the same order.
         *
         * This is not optional detail. Without it the engines see an athlete
         * with no personal baseline on every single session, and endurance
         * scores drift in a way that looks exactly like a calibration bug —
         * the first version of this simulator "found" a swimmer's index
         * falling 957 → 296 over eight weeks of improvement, and the entire
         * effect was the missing personalisation, not the app.
         *
         * A bot that does not reproduce production faithfully does not report
         * findings, it manufactures them, and manufactured findings are worse
         * than none because somebody spends a day chasing them.
         */
        const benchmarkSport = mapSportToBenchmarkSport(pattern.sport);
        const state = (benchmarkState[benchmarkSport] ??= {
          window: [],
          easyScores: [],
          predictionSeconds: null,
          updatedAt: startedAt,
          lastQualityAt: startedAt,
          riegelK: null,
        });

        // The route reads a rolling 90-day, same-benchmark-sport window.
        const cutoff = at - 90 * DAY;
        state.window = state.window.filter((s) => new Date(s.startedAt).getTime() >= cutoff);

        const personalizedK = personalizeRiegelKFromWindow(state.window, state.riegelK);
        const easyEffortBaselineEF = personalEasyEffortBaselineEF(
          benchmarkSport,
          state.window,
          personalizedK ?? undefined
        );
        const recentHardEffortBenchmarkSeconds = personalRecentHardEffortBenchmarkSeconds(
          benchmarkSport,
          state.window,
          personalizedK ?? undefined
        );
        const easyEffortBaselinePaceSeconds = personalEasyEffortBaselinePaceSeconds(
          benchmarkSport,
          state.window,
          personalizedK ?? undefined
        );

        // The stored multi-session prediction, decayed and re-blended exactly
        // as the route does. `storedPredictionForScoring` stays null until a
        // prior exists, which is what makes a first session behave like one.
        let storedPredictionForScoring: number | null = null;
        const sessionEquivalent = computeBodyBenchmarkEquivalentSeconds(
          benchmarkSport,
          {
            distance_meters: e.distanceMeters,
            duration_seconds: e.durationSeconds,
            avg_heart_rate: e.avgHeartRate,
            session_type: pattern.sessionType,
          } as never,
          personalizedK ?? undefined
        );

        if (sessionEquivalent !== null) {
          const decayedPrior =
            state.predictionSeconds != null
              ? effectiveStoredPrediction(state.predictionSeconds, state.updatedAt, state.lastQualityAt)
              : null;
          const sequentialBlend = blendPredictedBenchmark(decayedPrior, sessionEquivalent, {
            sessionType: pattern.sessionType,
            thisSessionEF: terrainAdjustedSessionEF(
              e.distanceMeters,
              e.durationSeconds,
              e.avgHeartRate,
              null,
              null
            ),
            baselineEF: easyEffortBaselineEF,
            isDirectBenchmarkDistance: isDirectBenchmarkDistance(
              e.distanceMeters,
              BENCHMARK_DISTANCE_METERS[benchmarkSport]
            ),
          });
          const windowed = computeWindowedTier2Seconds(benchmarkSport, sequentialBlend, state.window);
          if (decayedPrior != null) storedPredictionForScoring = windowed;

          state.lastQualityAt = sessionCountsAsQuality(decayedPrior, sessionEquivalent)
            ? startedAt
            : state.lastQualityAt;
          state.predictionSeconds = windowed;
          state.updatedAt = startedAt;
          state.riegelK = personalizedK ?? state.riegelK;
        }

        ctx = {
          sport: pattern.sport,
          durationSeconds: e.durationSeconds,
          distanceMeters: e.distanceMeters,
          avgHeartRate: e.avgHeartRate,
          sessionType: pattern.sessionType,
          storedPredictionSeconds: storedPredictionForScoring,
          easyEffortBaselineEF,
          recentHardEffortBenchmarkSeconds,
          easyEffortBaselinePaceSeconds,
          recentEasyEffortScores: state.easyScores.length ? state.easyScores : null,
          personalizedRiegelK: personalizedK,
          isPremium: true,
          profile: persona.profile,
          recentLoads,
          startedAt,
        };

        pendingWindowEntry = {
          benchmarkSport,
          session: {
            distanceMeters: e.distanceMeters,
            durationSeconds: e.durationSeconds,
            avgHR: e.avgHeartRate,
            sessionType: pattern.sessionType,
            startedAt,
          },
        };
      }

      let output: ActivityScoreOutput;
      try {
        output = scoreActivityWithEngines(ctx, recentRows, []);
      } catch (err) {
        failures.push({
          sessionIndex: index,
          sport: pattern.sport,
          error: err instanceof Error ? err.message : String(err),
        });
        index++;
        return;
      }

      // Feed the result back into the athlete's state, as the API does.
      if (pendingWindowEntry) {
        const st = benchmarkState[pendingWindowEntry.benchmarkSport];
        st.window.push(pendingWindowEntry.session);
        if (
          pendingWindowEntry.session.sessionType &&
          RELATIVE_EFFORT_SESSION_TYPES.has(pendingWindowEntry.session.sessionType)
        ) {
          st.easyScores.push(output.sportIndex);
        }
      }
      loadScores.push({ load_score: output.loadScore, created_at: startedAt });
      recentRows.unshift({
        sport: pattern.sport,
        sport_index: output.sportIndex,
        started_at: startedAt,
        score_breakdown: output.breakdown as unknown as Record<string, unknown>,
      });
      activityScores.push({
        side: pattern.sport === "gym" ? "lab" : "engine",
        score: output.sportIndex,
        confidence: output.activityConfidence,
        date: startedAt,
      });
      if (pattern.sport === "gym") {
        for (const ex of ctx.exercises ?? []) {
          const key = normalizeName(ex.exercise_name);
          exerciseHistory[key] = [
            ...(exerciseHistory[key] ?? []),
            ...ex.sets.map((set) => ({
              weightKg: set.weight_kg,
              reps: set.reps,
              performedAt: startedAt,
              repsInReserve: set.reps_in_reserve ?? null,
            })),
          ];
        }
      }

      const indexes = computeIndexes(
        activityScores,
        "hybrid",
        1 - (persona.profile.split_endurance_weight ?? 0.5)
      );
      const loads = computeRecentLoads(loadScores, at);
      const acwr = calculateACWR(loads.acute, loads.chronic);

      sessions.push({
        index,
        week,
        date: startedAt,
        sport: pattern.sport,
        sessionType: pattern.sessionType,
        output,
        splitIndex: indexes.headline,
        acwr,
        risk: injuryRisk(acwr),
      });
      index++;
    });
  }

  const acwrs = sessions.map((s) => s.acwr).filter((n) => Number.isFinite(n));

  return {
    persona,
    sessions,
    failures,
    firstIndex: sessions[0]?.splitIndex ?? 0,
    finalIndex: sessions[sessions.length - 1]?.splitIndex ?? 0,
    peakAcwr: acwrs.length ? Math.max(...acwrs) : 0,
    minAcwr: acwrs.length ? Math.min(...acwrs) : 0,
  };
}
