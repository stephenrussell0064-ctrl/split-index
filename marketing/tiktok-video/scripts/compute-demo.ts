/**
 * Runs the app's REAL scoring engines over the demo profile and writes every
 * number the ad shows to src/data/demo.json.
 *
 *   npm run compute
 *   (= npx tsx --tsconfig ../../tsconfig.json scripts/compute-demo.ts, from marketing/tiktok-video)
 *
 * The `--tsconfig` flag matters: the engines import each other via the app's
 * `@/` alias, which only resolves against the repo-root tsconfig.
 *
 * Reads nothing else and touches no database. The imports below are the same
 * pure modules `api/activities/route.ts` calls when a person taps Save:
 *
 *   scoreStrength / labIndex / tierForScore   src/lib/scoring/split-strength-engine.ts
 *   scoreCardioActivity                       src/lib/scoring/cardio-activity.ts
 *   computeIndexes                            src/lib/scoring/index-engine.ts
 *   computeInterferenceReport                 src/lib/scoring/interference.ts
 *   formatIndex                               src/lib/utils/format.ts
 *   ageBandFor / weightBandFor / resolveBracket  src/lib/social/leaderboard-brackets.ts
 *
 * It then ASSERTS the hook claims are true for this profile (bench tier is
 * Elite, 5k tier is Beginner, the interference finding is a real cost) and
 * exits non-zero if not — so a render cannot ship a claim the engine did not
 * make.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoreStrength,
  labIndex,
  tierForScore,
  type LoggedSet,
  type ScoreStrengthResult,
} from "../../../src/lib/scoring/split-strength-engine";
import { scoreCardioActivity, type CardioResult } from "../../../src/lib/scoring/cardio-activity";
import { computeIndexes, type ActivityScore } from "../../../src/lib/scoring/index-engine";
import {
  computeInterferenceReport,
  pickHeadlineBucket,
} from "../../../src/lib/scoring/interference";
import type { TimelineSession } from "../../../src/lib/scoring/timeline";
import { formatIndex } from "../../../src/lib/utils/format";
import {
  ageBandFor,
  weightBandFor,
  formatExactBracketLabel,
  resolveBracket,
  MIN_BRACKET_SIZE,
  type BracketCandidate,
} from "../../../src/lib/social/leaderboard-brackets";

import {
  DEMO_ATHLETE,
  COHORT,
  COHORT_SESSIONS_PER_SIDE,
  type DemoAthlete,
  type DemoGymSession,
  type DemoRunSession,
  type CohortAthlete,
} from "../demo-profile";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");

// ─────────────────────────────────────────────────────────────────────────────

const fmtTime = (s: number) => {
  const mm = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
};
const fmtPace = (secPerKm: number) => `${fmtTime(secPerKm)}/km`;

interface ScoredGym {
  session: DemoGymSession;
  results: ScoreStrengthResult[];
  sessionIndex: number;
  confidence: number;
}
interface ScoredRun {
  session: DemoRunSession;
  result: CardioResult;
}

/** Score every gym session in order, feeding each lift its accumulating history — the premium adaptive path. */
function scoreGymBlock(athlete: DemoAthlete, sessions: DemoGymSession[]): ScoredGym[] {
  const history = new Map<string, LoggedSet[]>();
  const out: ScoredGym[] = [];
  for (const s of sessions) {
    const results: ScoreStrengthResult[] = [];
    for (const lift of s.lifts) {
      const prior = history.get(lift.exercise) ?? [];
      // Best set of the session by estimated 1RM proxy (weight then reps).
      const best = [...lift.sets].sort((a, b) => b.weightKg * (1 + b.reps / 30) - a.weightKg * (1 + a.reps / 30))[0];
      const r = scoreStrength({
        liftKey: lift.exercise,
        exerciseName: lift.exercise,
        history: prior,
        latestSet: { weightKg: best.weightKg, reps: best.reps },
        latestSetPerformedAt: s.startedAt,
        bodyweightKg: athlete.bodyweightKg,
        sex: athlete.sex,
        age: athlete.age,
        isPremium: true,
      });
      results.push(r);
      history.set(lift.exercise, [
        ...prior,
        ...lift.sets.map((set) => ({ weightKg: set.weightKg, reps: set.reps, performedAt: s.startedAt })),
      ]);
    }
    const sessionIndex = labIndex(results);
    const confidence = results.reduce((a, r) => a + r.oneRMConfidence, 0) / results.length;
    out.push({ session: s, results, sessionIndex, confidence });
  }
  return out;
}

function scoreRun(athlete: DemoAthlete, s: DemoRunSession): ScoredRun {
  const result = scoreCardioActivity({
    type: "run",
    benchmarkSport: "run",
    distanceMeters: s.distanceMeters,
    durationSeconds: s.durationSeconds,
    sex: athlete.sex,
    age: athlete.age,
    avgHR: s.avgHR,
    maxHR: athlete.maxHR,
    restingHR: athlete.restingHR,
    bodyweightKg: athlete.bodyweightKg,
    sessionType: s.sessionType,
    startedAt: s.startedAt,
  });
  return { session: s, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The demo athlete
// ─────────────────────────────────────────────────────────────────────────────

const gymSessions = DEMO_ATHLETE.sessions.filter((s): s is DemoGymSession => s.kind === "gym");
const runSessions = DEMO_ATHLETE.sessions.filter((s): s is DemoRunSession => s.kind === "run");

const gym = scoreGymBlock(DEMO_ATHLETE, gymSessions);
const runs = runSessions.map((s) => scoreRun(DEMO_ATHLETE, s));

const activities: ActivityScore[] = [
  ...gym.map((g) => ({ side: "lab" as const, score: g.sessionIndex, confidence: g.confidence, date: g.session.startedAt })),
  ...runs.map((r) => ({ side: "engine" as const, score: r.result.score, confidence: r.result.confidence, date: r.session.startedAt, sport: "run" as const })),
].sort((a, b) => a.date.localeCompare(b.date));

const indexes = computeIndexes(activities, "hybrid", 0.5);

// The latest session is the final Monday push — the set that "gets logged".
const latestGym = gym[gym.length - 1];
const latestBench = latestGym.results.find((r) => r.liftKey === "bench");
if (!latestBench) throw new Error("expected a bench result in the final session");
const latestBenchLift = latestGym.session.lifts.find((l) => l.exercise === "Bench Press")!;
const latestBenchSet = latestBenchLift.sets[0];

// The 5k the hook is about
const timeTrial = runs.find((r) => r.session.sessionType === "race");
if (!timeTrial) throw new Error("expected a 5k time trial");

// Every lift's latest result, for the Lab panel
const latestByLift = new Map<string, ScoreStrengthResult>();
for (const g of gym) for (const r of g.results) latestByLift.set(r.liftKey, r);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Interference Radar — hand-built TimelineSession[] from the scored sessions
//    (this is exactly what timeline.ts would load from the database).
// ─────────────────────────────────────────────────────────────────────────────

const timeline: TimelineSession[] = [
  ...gym.map<TimelineSession>((g, i) => ({
    activityId: `gym-${i}`,
    sport: "gym",
    domain: "strength",
    startedAt: g.session.startedAt,
    durationSeconds: g.session.durationSeconds,
    sessionType: null,
    avgHeartRate: null,
    avgPaceSecondsPerKm: null,
    loadScore: null,
    enduranceComponent: null,
    strengthComponent: g.sessionIndex,
    efficiencyFactor: null,
  })),
  ...runs.map<TimelineSession>((r, i) => ({
    activityId: `run-${i}`,
    sport: "running",
    domain: "cardio",
    startedAt: r.session.startedAt,
    durationSeconds: r.session.durationSeconds,
    sessionType: r.session.sessionType,
    avgHeartRate: r.session.avgHR,
    avgPaceSecondsPerKm: r.session.durationSeconds / (r.session.distanceMeters / 1000),
    // Same rule as activity-scorer.ts: TRIMP when the engine produced one, else minutes.
    loadScore: r.result.trimp ? Math.round(r.result.trimp) : Math.max(1, Math.round(r.session.durationSeconds / 60)),
    enduranceComponent: r.result.score,
    strengthComponent: null,
    efficiencyFactor: r.result.efficiencyFactor,
  })),
];

const interference = computeInterferenceReport(timeline);
const headlineBucket = pickHeadlineBucket(interference.strengthToCardio.decayByDay);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Leaderboard — Sam plus the cohort, each scored by the same engines
// ─────────────────────────────────────────────────────────────────────────────

function cohortSessions(a: CohortAthlete, idx: number): DemoAthlete {
  const sessions: DemoAthlete["sessions"] = [];
  for (let i = 0; i < COHORT_SESSIONS_PER_SIDE; i++) {
    const d = new Date("2026-07-13T18:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + i * 9 + (idx % 3));
    // ±2.5 kg across the block, so the history is not six identical sets
    const wobble = ((i * 7 + idx) % 3) - 1;
    sessions.push({
      kind: "gym",
      startedAt: d.toISOString(),
      label: "Gym",
      durationSeconds: 60 * 60,
      lifts: [
        { exercise: "Bench Press", sets: [{ weightKg: a.bench.weightKg + wobble * 2.5, reps: a.bench.reps }] },
        { exercise: "Squat", sets: [{ weightKg: a.squat.weightKg + wobble * 2.5, reps: a.squat.reps }] },
        { exercise: "Deadlift", sets: [{ weightKg: a.deadlift.weightKg + wobble * 2.5, reps: a.deadlift.reps }] },
      ],
    });
    const rd = new Date(d);
    rd.setUTCDate(rd.getUTCDate() + 3);
    sessions.push({
      kind: "run",
      startedAt: rd.toISOString(),
      label: "5k",
      distanceMeters: 5000,
      durationSeconds: a.fiveKSeconds + wobble * 15,
      avgHR: 178,
      sessionType: "race",
      note: "cohort 5k",
    });
  }
  return {
    displayName: a.handle,
    handle: a.handle,
    sex: "male",
    age: a.age,
    bodyweightKg: a.bodyweightKg,
    maxHR: 190,
    restingHR: 58,
    sessions: sessions.sort((x, y) => x.startedAt.localeCompare(y.startedAt)),
  };
}

interface Row {
  handle: string;
  age: number;
  bodyweightKg: number;
  split: number;
  lab: number | null;
  engine: number | null;
}

const cohortRows: Row[] = COHORT.map((a, idx) => {
  const ath = cohortSessions(a, idx);
  const g = scoreGymBlock(ath, ath.sessions.filter((s): s is DemoGymSession => s.kind === "gym"));
  const r = ath.sessions.filter((s): s is DemoRunSession => s.kind === "run").map((s) => scoreRun(ath, s));
  const acts: ActivityScore[] = [
    ...g.map((x) => ({ side: "lab" as const, score: x.sessionIndex, confidence: x.confidence, date: x.session.startedAt })),
    ...r.map((x) => ({ side: "engine" as const, score: x.result.score, confidence: x.result.confidence, date: x.session.startedAt, sport: "run" as const })),
  ].sort((x, y) => x.date.localeCompare(y.date));
  const ix = computeIndexes(acts, "hybrid", 0.5);
  return { handle: a.handle, age: a.age, bodyweightKg: a.bodyweightKg, split: ix.splitIndex ?? ix.headline, lab: ix.labIndex, engine: ix.engineIndex };
});

const allRows: Row[] = [
  ...cohortRows,
  {
    handle: DEMO_ATHLETE.handle,
    age: DEMO_ATHLETE.age,
    bodyweightKg: DEMO_ATHLETE.bodyweightKg,
    split: indexes.splitIndex ?? indexes.headline,
    lab: indexes.labIndex,
    engine: indexes.engineIndex,
  },
].sort((a, b) => b.split - a.split);

const ranked = allRows.map((r, i) => ({
  rank: i + 1,
  handle: r.handle,
  isDemo: r.handle === DEMO_ATHLETE.handle,
  split: r.split,
  splitDisplay: formatIndex(r.split),
  tier: tierForScore(r.split),
}));
const demoRank = ranked.find((r) => r.isDemo)!.rank;

// Bracket, through the app's own helpers
const ageBand = ageBandFor(DEMO_ATHLETE.age);
const weightBand = weightBandFor(DEMO_ATHLETE.bodyweightKg);
const bracketLabel = formatExactBracketLabel(DEMO_ATHLETE.sex, ageBand, weightBand);
const candidates: BracketCandidate[] = allRows.map((r) => ({
  userId: r.handle,
  ageBand: ageBandFor(r.age).label,
  weightBand: weightBandFor(r.bodyweightKg).label,
  sex: "male",
}));
const resolution = resolveBracket(
  { age: DEMO_ATHLETE.age, weightKg: DEMO_ATHLETE.bodyweightKg, gender: DEMO_ATHLETE.sex },
  candidates,
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Assemble, assert, write
// ─────────────────────────────────────────────────────────────────────────────

const splitScore = indexes.splitIndex ?? indexes.headline;
const timeTrialPace = timeTrial.session.durationSeconds / (timeTrial.session.distanceMeters / 1000);

const demo = {
  generatedAt: new Date().toISOString(),
  source: "marketing/tiktok-video/demo-profile.ts → scripts/compute-demo.ts (app engines, no database)",
  athlete: {
    displayName: DEMO_ATHLETE.displayName,
    handle: DEMO_ATHLETE.handle,
    sex: DEMO_ATHLETE.sex,
    age: DEMO_ATHLETE.age,
    bodyweightKg: DEMO_ATHLETE.bodyweightKg,
    sessionsLogged: DEMO_ATHLETE.sessions.length,
    gymSessions: gymSessions.length,
    runSessions: runSessions.length,
  },
  /** The set that gets logged on screen, and what the engine said about it. */
  loggedSet: {
    exercise: "Bench Press",
    weightKg: latestBenchSet.weightKg,
    reps: latestBenchSet.reps,
    performedAt: latestGym.session.startedAt,
    liftScore: latestBench.score,
    liftScoreDisplay: formatIndex(latestBench.score),
    liftTier: latestBench.tier,
    estimatedOneRMKg: Math.round(latestBench.oneRM),
    bodyweightRatio: Math.round(latestBench.bodyweightRatio * 100) / 100,
    sessionLabIndex: latestGym.sessionIndex,
    sessionLabIndexDisplay: formatIndex(latestGym.sessionIndex),
  },
  lifts: [...latestByLift.values()].map((r) => ({
    liftKey: r.liftKey,
    score: r.score,
    scoreDisplay: formatIndex(r.score),
    tier: r.tier,
    oneRMKg: Math.round(r.oneRM),
  })),
  fiveK: {
    seconds: timeTrial.session.durationSeconds,
    timeLabel: fmtTime(timeTrial.session.durationSeconds),
    paceLabel: fmtPace(timeTrialPace),
    avgHR: timeTrial.session.avgHR,
    score: timeTrial.result.score,
    scoreDisplay: formatIndex(timeTrial.result.score),
    tier: tierForScore(timeTrial.result.score),
    predictions: timeTrial.result.predictions,
  },
  indexes: {
    lab: indexes.labIndex,
    labDisplay: indexes.labIndex === null ? null : formatIndex(indexes.labIndex),
    labTier: indexes.labIndex === null ? null : tierForScore(indexes.labIndex),
    engine: indexes.engineIndex,
    engineDisplay: indexes.engineIndex === null ? null : formatIndex(indexes.engineIndex),
    engineTier: indexes.engineIndex === null ? null : tierForScore(indexes.engineIndex),
    split: splitScore,
    splitDisplay: formatIndex(splitScore),
    splitTier: tierForScore(splitScore),
    headlineLabel: indexes.headlineLabel,
    weights: indexes.breakdown,
  },
  interference: {
    strengthToCardio: {
      calibrating: interference.strengthToCardio.calibrating,
      lowConfidence: interference.strengthToCardio.lowConfidence,
      sampleCount: interference.strengthToCardio.sampleCount,
      totalQualifyingSessions: interference.strengthToCardio.totalQualifyingSessions,
      headlineDeltaPct: headlineBucket?.efDeltaPct ?? null,
      headlineHrDeltaBpm: headlineBucket?.hrDeltaBpm ?? null,
      headlineDaysSinceStrength: headlineBucket?.daysSinceStrength ?? null,
      decayByDay: interference.strengthToCardio.decayByDay,
      summary: interference.strengthToCardio.summary,
    },
    cardioToStrength: {
      calibrating: interference.cardioToStrength.calibrating,
      lowConfidence: interference.cardioToStrength.lowConfidence,
      sampleCount: interference.cardioToStrength.sampleCount,
      deltaPct: interference.cardioToStrength.deltaPct,
      highCardioAvg: interference.cardioToStrength.highCardioAvgStrengthComponent,
      lowCardioAvg: interference.cardioToStrength.lowCardioAvgStrengthComponent,
      summary: interference.cardioToStrength.summary,
    },
  },
  leaderboard: {
    bracketLabel,
    bracketResolved: resolution
      ? { widenLevel: resolution.effective.widenLevel, peerCount: resolution.size, label: resolution.exact.label }
      : null,
    minBracketSize: MIN_BRACKET_SIZE,
    total: ranked.length,
    demoRank,
    rows: ranked,
  },
  /** Which hook claims this profile can substantiate. Render scripts refuse to run if any is false. */
  claims: {
    benchIsElite: latestBench.tier === "Elite",
    fiveKIsBeginner: tierForScore(timeTrial.result.score) === "Beginner",
    liftingCostsRunning:
      !interference.strengthToCardio.calibrating &&
      !interference.strengthToCardio.lowConfidence &&
      (headlineBucket?.efDeltaPct ?? 0) <= -3,
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "demo.json"), JSON.stringify(demo, null, 2) + "\n");

// ─────────────────────────────────────────────────────────────────────────────
// Print an audit trail
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nDemo athlete: ${DEMO_ATHLETE.displayName} (@${DEMO_ATHLETE.handle}) — ${DEMO_ATHLETE.sex}, ${DEMO_ATHLETE.age}, ${DEMO_ATHLETE.bodyweightKg} kg`);
console.log(`Bracket: ${bracketLabel}  (resolved: ${resolution?.effective.widenLevel}, ${resolution?.size} peers)`);
console.log(`\nLogged set: Bench ${latestBenchSet.weightKg} kg × ${latestBenchSet.reps} → ${demo.loggedSet.liftScoreDisplay} ${latestBench.tier} (e1RM ${demo.loggedSet.estimatedOneRMKg} kg)`);
for (const l of demo.lifts) console.log(`  ${l.liftKey.padEnd(12)} ${String(l.scoreDisplay).padStart(5)}  ${l.tier}  (1RM ${l.oneRMKg} kg)`);
console.log(`\n5k: ${demo.fiveK.timeLabel} (${demo.fiveK.paceLabel}) @ ${demo.fiveK.avgHR} bpm → ${demo.fiveK.scoreDisplay} ${demo.fiveK.tier}`);
console.log(`\nLab ${demo.indexes.labDisplay} (${demo.indexes.labTier}) · Engine ${demo.indexes.engineDisplay} (${demo.indexes.engineTier}) · Split Index ${demo.indexes.splitDisplay} (${demo.indexes.splitTier})`);
console.log(`\nInterference — strength → cardio (${interference.strengthToCardio.sampleCount} paired, low confidence: ${interference.strengthToCardio.lowConfidence})`);
console.log(`  ${interference.strengthToCardio.summary}`);
for (const d of interference.strengthToCardio.decayByDay) console.log(`  day ${d.daysSinceStrength}: n=${d.sampleCount} EF ${d.efDeltaPct}% HR ${d.hrDeltaBpm} bpm`);
console.log(`Interference — cardio → strength (${interference.cardioToStrength.sampleCount} sessions)`);
console.log(`  ${interference.cardioToStrength.summary}`);
console.log(`\nLeaderboard — ${bracketLabel} — @${DEMO_ATHLETE.handle} is #${demoRank} of ${ranked.length}`);
for (const r of ranked) console.log(`  ${String(r.rank).padStart(2)}  ${r.handle.padEnd(16)} ${r.splitDisplay.padStart(5)}  ${r.tier}${r.isDemo ? "  ◀" : ""}`);
console.log(`\nClaims: ${JSON.stringify(demo.claims)}`);

const failed = Object.entries(demo.claims).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length > 0) {
  console.error(`\n✗ The demo profile cannot substantiate: ${failed.join(", ")}. Adjust demo-profile.ts inputs; do not edit demo.json.`);
  process.exit(1);
}
console.log("\n✓ every hook claim holds for this profile\n");
