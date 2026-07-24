/**
 * Split Index — cardio benchmark anchor tables (MASTER-BRIEF.md §4–5,
 * BRIEF-2-cardio-sex-factors-ski-walking.md).
 *
 * Each cardio activity has a canonical benchmark distance (run 5k, row 2k,
 * swim 400m, cycle 20k, ski 2k via the row curve, walk 2.5k/pace) and a
 * calibrated time(or pace)→score anchor table on the shared 0–1000 scale,
 * matching the universal tier bands in MASTER-BRIEF.md §1. A woman's time
 * is divided by her activity's data-derived female factor before scoring on
 * the male-calibrated curve, so equal-ability men and women land on the
 * same tier.
 */

export type BenchmarkSport = "run" | "walk" | "row" | "swim" | "cycle" | "ski";

/** Canonical benchmark distance in meters for each sport (walk is scored on pace, not projected distance). */
export const BENCHMARK_DISTANCE_METERS: Record<BenchmarkSport, number> = {
  run: 5000,
  walk: 2500,
  row: 2000,
  swim: 400,
  cycle: 20000,
  ski: 2000,
};

/** Data-derived F/M time-ratio factors — a woman's time is divided by this before scoring on the male curve. Differ by sport; do not reuse the running factor elsewhere. */
export const FEMALE_CARDIO_FACTORS: Record<BenchmarkSport, number> = {
  run: 1.152,
  walk: 1.152, // mirrors running per instruction
  swim: 1.073,
  cycle: 1.219,
  row: 1.187,
  ski: 1.187, // inherits rowing — same machine family
};

/** SkiErg is ~10% less power than RowErg for equal effort; power ∝ pace^-3, so ski pace is slower by this factor. Validated: 7:00 row ≈ 7:16 ski. */
export const SKI_FROM_ROW_PACE = 1.0357;

type Anchor = [seconds: number, score: number];

const RUN_5K_ANCHORS: Anchor[] = [
  [900, 950], // 15:00
  [1050, 850], // 17:30
  [1110, 775], // 18:30
  [1200, 675], // 20:00
  [1350, 575], // 22:30
  [1500, 500], // 25:00
  [1800, 350], // 30:00
  [2100, 275], // 35:00
  [2400, 200], // 40:00
  [3000, 125], // 50:00
  [3600, 50], // 60:00
];

const ROW_2K_ANCHORS: Anchor[] = [
  [360, 975], // 6:00
  [375, 925], // 6:15
  [390, 850], // 6:30
  [405, 750], // 6:45
  [420, 650], // 7:00
  [450, 525], // 7:30
  [480, 400], // 8:00
  [540, 200], // 9:00
  [600, 100], // 10:00
];

const CYCLE_20K_ANCHORS: Anchor[] = [
  [2126, 925], // 35:26
  [2280, 775], // 38:00
  [2492, 575], // 41:32
  [2790, 400], // 46:30
  [3227, 200], // 53:47
];

/** Seconds per km — lower is better, same monotonic direction as the time tables above. */
const WALK_PACE_ANCHORS: Anchor[] = [
  [420, 925], // 7:00/km
  [480, 875], // 8:00
  [555, 775], // 9:15
  [600, 600], // 10:00
  [720, 375], // 12:00
  [840, 150], // 14:00
];

/**
 * Provisional — swimming has no full calibration table yet, only a single
 * F/M cross-check point (BRIEF-2: age-25 Intermediate male 7:28/400m).
 * Shaped from running's relative anchor spacing and anchored at that one
 * point. Recalibrate with real logged swim data per MASTER-BRIEF.md §4's
 * own sequencing note ("mark swim/cycle/ski provisional").
 */
const SWIM_400M_ANCHORS: Anchor[] = [
  [300, 950], // 5:00
  [340, 850],
  [370, 750],
  [400, 650],
  [448, 500], // ~7:28 calibration point
  [500, 350],
  [560, 250],
  [660, 150],
  [780, 75],
];

const ANCHOR_TABLES: Record<Exclude<BenchmarkSport, "ski">, Anchor[]> = {
  run: RUN_5K_ANCHORS,
  walk: WALK_PACE_ANCHORS,
  row: ROW_2K_ANCHORS,
  swim: SWIM_400M_ANCHORS,
  cycle: CYCLE_20K_ANCHORS,
};

/** Linear interpolation across an anchor table, with gentle (slope-continued) extrapolation at both ends. */
function interpolateAnchors(anchors: Anchor[], x: number): number {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (x <= first[0]) {
    const next = sorted[1] ?? first;
    const slope = next[0] === first[0] ? 0 : (next[1] - first[1]) / (next[0] - first[0]);
    return Math.min(999, first[1] + slope * (x - first[0]));
  }
  if (x >= last[0]) {
    const prev = sorted[sorted.length - 2] ?? last;
    const slope = last[0] === prev[0] ? 0 : (last[1] - prev[1]) / (last[0] - prev[0]);
    return Math.max(0, last[1] + slope * (x - last[0]));
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

/** Ski reuses the rowing curve after converting to a row-equivalent time. */
export function skiToRowEquivalentSeconds(skiSeconds: number): number {
  return skiSeconds / SKI_FROM_ROW_PACE;
}

function clampScore(x: number): number {
  return Math.max(0, Math.min(1000, Math.round(x)));
}

/**
 * Endurance age-grading factor (age → multiplier on the benchmark-equivalent
 * time before scoring). Older athletes lose aerobic capacity with age, so the
 * same finish time is a stronger performance at 55 than at 30; grading their
 * time down (factor < 1) gives them fair credit, the same way percentile
 * tools compare you against your own age group. Under-35s sit on a flat peak
 * plateau (factor 1.0) — we deliberately don't inflate juniors, only credit
 * aging — so a young athlete's score is unchanged.
 *
 * Endurance-wide approximation (a single curve for run/row/swim/cycle/ski/
 * walk), shaped from standard ~0.7%/yr-accelerating masters decline in
 * distance-running age factors. Recalibrate per-sport against real masters
 * data later, same process as the anchor tables.
 */
const ENDURANCE_AGE_FACTORS: Anchor[] = [
  [35, 1.0],
  [40, 0.97],
  [45, 0.93],
  [50, 0.89],
  [55, 0.85],
  [60, 0.8],
  [65, 0.75],
  [70, 0.7],
  [75, 0.65],
  [80, 0.6],
];

export function enduranceAgeGradeFactor(age: number | null | undefined): number {
  if (!age || age <= 35 || !Number.isFinite(age)) return 1.0;
  const clamped = Math.min(age, 80);
  // Reuse the anchor interpolator (it reads [x, y] pairs) over the age→factor table.
  return interpolateAnchors(ENDURANCE_AGE_FACTORS, clamped);
}

/**
 * Score a benchmark-distance time (or, for walk, a per-km pace) on the
 * calibrated 0–1000 scale, applying the activity's female factor first so
 * equal-ability men and women land on the same tier.
 */
export function timeToScore(sport: BenchmarkSport, seconds: number, sex: "male" | "female"): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  if (sport === "ski") {
    const rowEquivalent = skiToRowEquivalentSeconds(seconds);
    const adjusted = sex === "female" ? rowEquivalent / FEMALE_CARDIO_FACTORS.ski : rowEquivalent;
    return clampScore(interpolateAnchors(ANCHOR_TABLES.row, adjusted));
  }

  const factor = FEMALE_CARDIO_FACTORS[sport];
  const adjusted = sex === "female" ? seconds / factor : seconds;
  return clampScore(interpolateAnchors(ANCHOR_TABLES[sport], adjusted));
}
