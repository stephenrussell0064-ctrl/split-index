/**
 * The named demo profile every number in the ad is computed from.
 *
 * Nothing in here is a score. This file is INPUTS ONLY — bodyweight, sets,
 * runs, heart rates, dates — and `scripts/compute-demo.ts` runs the app's real
 * scoring engines over it (scoreStrength, scoreCardioActivity, computeIndexes,
 * tierForScore, computeInterferenceReport, the leaderboard bracket helpers) to
 * produce `src/data/demo.json`, which is what the compositions read.
 *
 * If you want a different story on screen, change the inputs here, re-run
 * `npm run compute`, and the numbers follow. Never edit demo.json by hand.
 *
 * The athlete is fictional. The handle and every cohort handle are invented
 * and were checked against nothing — they exist only so a leaderboard has
 * rows in it.
 */

export type DemoSex = "male" | "female";

export interface DemoSet {
  weightKg: number;
  reps: number;
}

export interface DemoLift {
  /** Exercise name exactly as a user would log it — resolved by the engine's alias table. */
  exercise: string;
  sets: DemoSet[];
}

export interface DemoGymSession {
  kind: "gym";
  /** ISO timestamp (UTC). */
  startedAt: string;
  label: string;
  durationSeconds: number;
  lifts: DemoLift[];
}

export interface DemoRunSession {
  kind: "run";
  startedAt: string;
  label: string;
  distanceMeters: number;
  durationSeconds: number;
  avgHR: number;
  sessionType: "easy" | "recovery" | "long" | "race" | "tempo";
  /** Why this run exists in the demo — printed by the compute script for audit. */
  note: string;
}

export type DemoSession = DemoGymSession | DemoRunSession;

export interface DemoAthlete {
  displayName: string;
  handle: string;
  sex: DemoSex;
  age: number;
  bodyweightKg: number;
  maxHR: number;
  restingHR: number;
  sessions: DemoSession[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule constants — the shape of the training block. Editable.
// ─────────────────────────────────────────────────────────────────────────────

/** Monday of week 1, 18:00 UTC. The block runs WEEKS weeks and ends before the ad's date. */
export const BLOCK_START_ISO = "2026-07-06T18:00:00.000Z";
export const WEEKS = 11;

/**
 * Bench top-set progression, one entry per week. The last entry is the set
 * that "gets logged" on screen in the reveal beat. Reps fixed at 3.
 */
export const BENCH_TOP_SET_KG: number[] = [
  132.5, 135, 135, 137.5, 137.5, 140, 140, 142.5, 142.5, 145, 145,
];
export const BENCH_REPS = 3;

/** Squat / deadlift / row progressions (Saturday session). */
export const SQUAT_TOP_SET_KG: number[] = [140, 140, 142.5, 145, 145, 147.5, 150, 150, 152.5, 155, 155];
export const DEADLIFT_TOP_SET_KG: number[] = [180, 180, 185, 185, 190, 190, 192.5, 195, 195, 200, 200];
export const ROW_TOP_SET_KG: number[] = [95, 95, 100, 100, 100, 105, 105, 105, 110, 110, 110];
export const OHP_TOP_SET_KG: number[] = [70, 70, 72.5, 72.5, 75, 75, 75, 77.5, 77.5, 80, 80];

/**
 * Easy-run model. The interference finding is the difference between the two
 * rows below, computed by the app from these sessions — the numbers in the
 * finding are not typed anywhere in this project.
 *
 *   rested   — Friday run, three clear days after the Monday gym session
 *   dayAfter — Tuesday run, the morning after Monday's push session
 *   dayThree — occasional Thursday run, three days after Monday
 *
 * Pace is seconds per km; HR is session average.
 */
export const EASY_RUN = {
  distanceMeters: 5000,
  rested: { paceSecPerKm: 515, avgHR: 148 },
  dayAfter: { paceSecPerKm: 531, avgHR: 157 },
  dayThree: { paceSecPerKm: 518, avgHR: 149 },
  /** Weeks (1-based) that get an extra Thursday run. */
  dayThreeWeeks: [3, 6, 9],
} as const;

/** The 5k time trial the hook is about. Sunday of the final week. */
export const FIVE_K_TIME_TRIAL = {
  distanceMeters: 5000,
  durationSeconds: 40 * 60 + 45, // 40:45
  avgHR: 181,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic jitter so the block reads like a person, not a metronome.
// ─────────────────────────────────────────────────────────────────────────────

function jitter(seed: number, amplitude: number): number {
  // mulberry32, one step — good enough for ±a few seconds/bpm.
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.round((u * 2 - 1) * amplitude);
}

function at(weekIndex: number, dayOffset: number, hourUtc: number): string {
  const d = new Date(BLOCK_START_ISO);
  d.setUTCDate(d.getUTCDate() + weekIndex * 7 + dayOffset);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

function easyRun(
  weekIndex: number,
  dayOffset: number,
  model: { paceSecPerKm: number; avgHR: number },
  label: string,
  note: string,
  seed: number,
): DemoRunSession {
  const pace = model.paceSecPerKm + jitter(seed, 6);
  const hr = model.avgHR + jitter(seed * 7 + 1, 2);
  return {
    kind: "run",
    startedAt: at(weekIndex, dayOffset, 7),
    label,
    distanceMeters: EASY_RUN.distanceMeters,
    durationSeconds: Math.round((EASY_RUN.distanceMeters / 1000) * pace),
    avgHR: hr,
    sessionType: "easy",
    note,
  };
}

function buildSessions(): DemoSession[] {
  const out: DemoSession[] = [];
  for (let w = 0; w < WEEKS; w++) {
    const week = w + 1;
    const bench = BENCH_TOP_SET_KG[w];
    const ohp = OHP_TOP_SET_KG[w];

    // Monday — Push
    out.push({
      kind: "gym",
      startedAt: at(w, 0, 18),
      label: "Push",
      durationSeconds: 62 * 60,
      lifts: [
        { exercise: "Bench Press", sets: [{ weightKg: bench, reps: BENCH_REPS }, { weightKg: bench, reps: BENCH_REPS }, { weightKg: bench - 10, reps: 5 }] },
        { exercise: "Overhead Press", sets: [{ weightKg: ohp, reps: 5 }, { weightKg: ohp, reps: 5 }, { weightKg: ohp - 5, reps: 6 }] },
        { exercise: "Incline Dumbbell Press", sets: [{ weightKg: 36, reps: 8 }, { weightKg: 36, reps: 8 }] },
      ],
    });

    // Tuesday — easy run, the morning after
    out.push(easyRun(w, 1, EASY_RUN.dayAfter, "Easy run", "day after Monday push — the impaired sample", 100 + w));

    // Thursday — occasional third-day run
    if ((EASY_RUN.dayThreeWeeks as readonly number[]).includes(week)) {
      out.push(easyRun(w, 3, EASY_RUN.dayThree, "Easy run", "three days after Monday — recovery check", 300 + w));
    }

    // Friday — rested run (no strength for 4 days, no session for ≥2 days unless Thursday ran)
    out.push(easyRun(w, 4, EASY_RUN.rested, "Easy run", "rested baseline — four days since a barbell", 200 + w));

    // Saturday — Legs & Pull (not in the final week: the block ends on Monday's bench)
    if (w < WEEKS - 1) {
      out.push({
        kind: "gym",
        startedAt: at(w, 5, 10),
        label: "Legs & Pull",
        durationSeconds: 71 * 60,
        lifts: [
          { exercise: "Squat", sets: [{ weightKg: SQUAT_TOP_SET_KG[w], reps: 5 }, { weightKg: SQUAT_TOP_SET_KG[w], reps: 5 }, { weightKg: SQUAT_TOP_SET_KG[w] - 15, reps: 6 }] },
          { exercise: "Deadlift", sets: [{ weightKg: DEADLIFT_TOP_SET_KG[w], reps: 3 }, { weightKg: DEADLIFT_TOP_SET_KG[w] - 20, reps: 5 }] },
          { exercise: "Barbell Row", sets: [{ weightKg: ROW_TOP_SET_KG[w], reps: 6 }, { weightKg: ROW_TOP_SET_KG[w], reps: 6 }] },
        ],
      });
    }

    // Sunday of the penultimate week — the 5k time trial the hook is about.
    if (w === WEEKS - 2) {
      out.push({
        kind: "run",
        startedAt: at(w, 6, 9),
        label: "5k time trial",
        distanceMeters: FIVE_K_TIME_TRIAL.distanceMeters,
        durationSeconds: FIVE_K_TIME_TRIAL.durationSeconds,
        avgHR: FIVE_K_TIME_TRIAL.avgHR,
        sessionType: "race",
        note: "the 5k in the hook — an all-out effort, scored as a race",
      });
    }
  }
  // Chronological, so "the last session" is the final Monday bench.
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export const DEMO_ATHLETE: DemoAthlete = {
  displayName: "Sam",
  handle: "sam_benches",
  sex: "male",
  age: 29,
  bodyweightKg: 84,
  maxHR: 192,
  restingHR: 56,
  sessions: buildSessions(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard cohort — 23 more fictional men in the same bracket
// (Male · 25-34 · 80-90kg), so the bracket clears MIN_BRACKET_SIZE (20) and the
// app would rank against the exact bracket rather than widening it.
// Each gets a small block of gym sessions and 5k efforts; the engines score
// them the same way they score Sam. Ranks fall out of a sort.
// ─────────────────────────────────────────────────────────────────────────────

export interface CohortAthlete {
  handle: string;
  age: number;
  bodyweightKg: number;
  bench: DemoSet;
  squat: DemoSet;
  deadlift: DemoSet;
  /** All-out 5k, seconds. */
  fiveKSeconds: number;
}

const m = (min: number, sec: number) => min * 60 + sec;

export const COHORT: CohortAthlete[] = [
  { handle: "tom.hyrox", age: 31, bodyweightKg: 86, bench: { weightKg: 100, reps: 5 }, squat: { weightKg: 140, reps: 5 }, deadlift: { weightKg: 180, reps: 3 }, fiveKSeconds: m(19, 40) },
  { handle: "kieran_lifts", age: 27, bodyweightKg: 88, bench: { weightKg: 135, reps: 3 }, squat: { weightKg: 180, reps: 3 }, deadlift: { weightKg: 220, reps: 2 }, fiveKSeconds: m(37, 30) },
  { handle: "ollie.runs", age: 29, bodyweightKg: 81, bench: { weightKg: 75, reps: 6 }, squat: { weightKg: 100, reps: 5 }, deadlift: { weightKg: 130, reps: 5 }, fiveKSeconds: m(17, 55) },
  { handle: "dan_mcgrath", age: 33, bodyweightKg: 85, bench: { weightKg: 110, reps: 4 }, squat: { weightKg: 150, reps: 4 }, deadlift: { weightKg: 190, reps: 3 }, fiveKSeconds: m(22, 10) },
  { handle: "jakub.k", age: 26, bodyweightKg: 83, bench: { weightKg: 95, reps: 5 }, squat: { weightKg: 130, reps: 5 }, deadlift: { weightKg: 160, reps: 5 }, fiveKSeconds: m(21, 5) },
  { handle: "marcus_pt", age: 30, bodyweightKg: 87, bench: { weightKg: 120, reps: 5 }, squat: { weightKg: 165, reps: 4 }, deadlift: { weightKg: 200, reps: 3 }, fiveKSeconds: m(24, 40) },
  { handle: "rhys.evans", age: 28, bodyweightKg: 82, bench: { weightKg: 85, reps: 8 }, squat: { weightKg: 120, reps: 6 }, deadlift: { weightKg: 150, reps: 5 }, fiveKSeconds: m(20, 20) },
  { handle: "aaron_5k", age: 25, bodyweightKg: 80, bench: { weightKg: 70, reps: 8 }, squat: { weightKg: 95, reps: 8 }, deadlift: { weightKg: 120, reps: 6 }, fiveKSeconds: m(18, 30) },
  { handle: "callum.b", age: 34, bodyweightKg: 89, bench: { weightKg: 70, reps: 6 }, squat: { weightKg: 90, reps: 6 }, deadlift: { weightKg: 120, reps: 5 }, fiveKSeconds: m(35, 10) },
  { handle: "sean_og", age: 32, bodyweightKg: 84, bench: { weightKg: 60, reps: 8 }, squat: { weightKg: 80, reps: 8 }, deadlift: { weightKg: 100, reps: 6 }, fiveKSeconds: m(33, 40) },
  { handle: "harry.tri", age: 29, bodyweightKg: 80, bench: { weightKg: 80, reps: 6 }, squat: { weightKg: 110, reps: 6 }, deadlift: { weightKg: 140, reps: 5 }, fiveKSeconds: m(19, 10) },
  { handle: "lewis_deads", age: 31, bodyweightKg: 88, bench: { weightKg: 125, reps: 3 }, squat: { weightKg: 170, reps: 3 }, deadlift: { weightKg: 230, reps: 1 }, fiveKSeconds: m(36, 0) },
  { handle: "ben.ashworth", age: 27, bodyweightKg: 85, bench: { weightKg: 62.5, reps: 8 }, squat: { weightKg: 85, reps: 8 }, deadlift: { weightKg: 105, reps: 6 }, fiveKSeconds: m(32, 40) },
  { handle: "nathan_r", age: 26, bodyweightKg: 82, bench: { weightKg: 92.5, reps: 5 }, squat: { weightKg: 130, reps: 5 }, deadlift: { weightKg: 165, reps: 4 }, fiveKSeconds: m(21, 40) },
  { handle: "george.hybrid", age: 30, bodyweightKg: 86, bench: { weightKg: 115, reps: 4 }, squat: { weightKg: 160, reps: 4 }, deadlift: { weightKg: 200, reps: 2 }, fiveKSeconds: m(20, 55) },
  { handle: "dylan_w", age: 33, bodyweightKg: 83, bench: { weightKg: 55, reps: 10 }, squat: { weightKg: 70, reps: 10 }, deadlift: { weightKg: 90, reps: 8 }, fiveKSeconds: m(31, 50) },
  { handle: "finn.oc", age: 28, bodyweightKg: 81, bench: { weightKg: 77.5, reps: 8 }, squat: { weightKg: 105, reps: 8 }, deadlift: { weightKg: 135, reps: 6 }, fiveKSeconds: m(18, 5) },
  { handle: "matt_squats", age: 34, bodyweightKg: 89, bench: { weightKg: 112.5, reps: 4 }, squat: { weightKg: 190, reps: 2 }, deadlift: { weightKg: 210, reps: 2 }, fiveKSeconds: m(38, 15) },
  { handle: "josh.pt", age: 25, bodyweightKg: 84, bench: { weightKg: 67.5, reps: 8 }, squat: { weightKg: 95, reps: 6 }, deadlift: { weightKg: 120, reps: 5 }, fiveKSeconds: m(34, 30) },
  { handle: "cameron_l", age: 32, bodyweightKg: 87, bench: { weightKg: 75, reps: 6 }, squat: { weightKg: 100, reps: 6 }, deadlift: { weightKg: 130, reps: 5 }, fiveKSeconds: m(30, 20) },
  { handle: "elliot.runs", age: 29, bodyweightKg: 80, bench: { weightKg: 72.5, reps: 8 }, squat: { weightKg: 100, reps: 6 }, deadlift: { weightKg: 125, reps: 6 }, fiveKSeconds: m(17, 20) },
  { handle: "owen_b", age: 31, bodyweightKg: 85, bench: { weightKg: 102.5, reps: 5 }, squat: { weightKg: 145, reps: 5 }, deadlift: { weightKg: 180, reps: 4 }, fiveKSeconds: m(22, 30) },
  { handle: "reece.k", age: 27, bodyweightKg: 86, bench: { weightKg: 65, reps: 8 }, squat: { weightKg: 85, reps: 8 }, deadlift: { weightKg: 110, reps: 6 }, fiveKSeconds: m(29, 45) },
];

/** How many sessions per side each cohort athlete gets (with tiny jitter). */
export const COHORT_SESSIONS_PER_SIDE = 6;
