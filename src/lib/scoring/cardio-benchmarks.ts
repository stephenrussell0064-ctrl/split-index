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

/** Data-derived F/M time-ratio factors — a woman's time is divided by this before scoring on the male curve. Differ by sport; do not reuse the running factor elsewhere. Row now uses its own sex-specific anchor tables (Part B) instead of this factor — kept here only because `ski` still inherits it (same machine family, no sex-specific ski data of its own). */
export const FEMALE_CARDIO_FACTORS: Record<BenchmarkSport, number> = {
  run: 1.152,
  walk: 1.152, // mirrors running per instruction
  swim: 1.073,
  cycle: 1.219,
  row: 1.187, // unused for row's own scoring since Part B; row has sex-specific tables now
  ski: 1.187, // inherits rowing — same machine family
};

/** SkiErg is ~10% less power than RowErg for equal effort; power ∝ pace^-3, so ski pace is slower by this factor. Validated: 7:00 row ≈ 7:16 ski. */
export const SKI_FROM_ROW_PACE = 1.0357;

type Anchor = [seconds: number, score: number];

/**
 * Corrected (CLAUDE-CODE-BRIEF-scoring-calibration-rewrite.md, Part C) —
 * synthesized from several percentile-tagged sources (RevelSports,
 * PacePercentile, RunDida/Marathon Handbook median framing), since no single
 * source gave a clean 5/20/50/80/95th percentile table the way RowingRegimen
 * did for rowing (see Part B). Moderate confidence — a strong first
 * correction, not final truth; revisit if better sourcing turns up. Fixes
 * the previous 18:30→775 / 20:00→675 gap that put a 19:20 finish six points
 * shy of Advanced — under this table 19:20 lands solidly inside Advanced.
 * Female factor (1.152) still applied on top (no sex-specific running data
 * at the same quality as the male data here — revisit alongside Part C).
 */
const RUN_5K_ANCHORS: Anchor[] = [
  [1020, 925], // 17:00 — ~99th percentile / competitive club level (tail beyond asymptotic toward 999, WR 12:35)
  [1140, 850], // 19:00 — ~95th percentile
  [1320, 725], // 22:00 — ~80th percentile
  [1530, 475], // 25:30 — ~50th percentile
  [1650, 250], // 27:30 — ~20th percentile
  [1860, 125], // 31:00 — ~5th percentile
  // Below the 5th percentile isn't part of Part C's sourced data — these two
  // extend the floor (matching the old table's spirit of a gentle tail
  // rather than clamping to 0 right past 31:00) so a long, easy, low-HR
  // session's volume/terrain bonus never has room to make a much slower
  // finish read as a HIGHER final score than a slightly-faster one once
  // paceScore itself would otherwise be floored flat.
  [2100, 60], // 35:00
  [2400, 25], // 40:00
];

/**
 * Corrected against RowingRegimen's Concept2-logbook-derived age-30
 * percentile table (CLAUDE-CODE-BRIEF-scoring-calibration-rewrite.md, Part
 * B) — this source already uses the exact 5/20/50/80/95th percentile
 * convention, so it maps directly onto percentile-framework.ts with no
 * synthesis needed. High confidence. Sex-specific tables sourced directly
 * from sex-specific percentile data (more accurate than the single-curve
 * female-multiplier approach still used for swim/cycle/walk/ski, where
 * sex-specific percentile data wasn't available).
 */
const ROW_2K_ANCHORS_MALE: Anchor[] = [
  [360, 925], // 6:00.0 — ~99th percentile / national-team-adjacent (tail beyond asymptotic toward 999, WR 5:35.8)
  [370.2, 850], // 6:10.2 — 95th percentile
  [395.9, 725], // 6:35.9 — 80th percentile
  [424.6, 475], // 7:04.6 — 50th percentile
  [455.4, 250], // 7:35.4 — 20th percentile
  [486.9, 125], // 8:06.9 — 5th percentile
  [600, 50], // 10:00 — floor
];

const ROW_2K_ANCHORS_FEMALE: Anchor[] = [
  [423.9, 850], // 7:03.9 — 95th percentile
  [464.0, 725], // 7:44.0 — 80th percentile
  [510.2, 475], // 8:30.2 — 50th percentile
  [561.0, 250], // 9:21.0 — 20th percentile
  [614.2, 125], // 10:14.2 — 5th percentile
];

/**
 * PROVISIONAL — NEWLY CALIBRATED, LOW CONFIDENCE (Part F,
 * scoring-calibration-rewrite). Built from ROUVY and BestBikeSplit
 * speed-band descriptions (beginner 19-26km/h, intermediate 24-32km/h,
 * advanced 30-35km/h, elite/racing 40+km/h), not a percentile table.
 * Recommend treating as a draft to sanity-check before fully trusting;
 * revisit once real logged cycling data comes in. Female factor (1.219)
 * still applied on top.
 */
const CYCLE_20K_ANCHORS: Anchor[] = [
  [1800, 925], // 30:00, ~40km/h — elite/racing threshold (tail toward 999 for pro TT speeds, ~24min/50km/h+)
  [2040, 725], // 34:00, ~35km/h — top of "advanced"
  [2400, 475], // 40:00, ~30km/h
  [3000, 250], // 50:00, ~24km/h
  [3780, 125], // 63:00, ~19km/h — beginner
];

/** Seconds per km — lower is better, same monotonic direction as the time tables above. */
/**
 * Lighter-touch correction (Part D) — no purpose-built leveled walking
 * benchmark table exists the way it does for running/rowing, so this is a
 * smaller, more conservative correction rather than a full rebuild. Per the
 * brief, only the 12:00 and 10:00 anchors were meant to change; live code
 * had already drifted from the brief's assumed "current" 9:15 value (775,
 * not the 725 the brief describes as unchanged) — applying the brief's
 * specified target number regardless, per its own instruction to treat live
 * code as source of truth for "current" but still apply the corrected
 * numbers. ~12min/km is repeatedly described in general-population research
 * as close to a normal/default adult pace, which shouldn't already read as
 * solidly "Intermediate" (was 375) — lowered proportionally at 10:00/km too
 * (was 600).
 */
const WALK_PACE_ANCHORS: Anchor[] = [
  [420, 925], // 7:00/km — unchanged, top anchor already looked appropriately hard
  [480, 875], // 8:00 — unchanged
  [555, 725], // 9:15 — brief's target value; live code was actually 775, not 725 as the brief assumed
  [600, 500], // 10:00 — was 600, lowered proportionally
  [720, 300], // 12:00 — was 375, lowered (near-default adult pace, not Intermediate)
  [840, 150], // 14:00 — unchanged, floor looked fine
];

/**
 * PROVISIONAL — NEWLY CALIBRATED, LOWEST CONFIDENCE OF ANY TABLE IN THIS
 * FILE (Part E, scoring-calibration-rewrite). Replaces the previous
 * scaled-from-running placeholder with a first dedicated attempt, built
 * from SwimmingLevel.com averages, swimmingregimen.com's practical LCM
 * ranges, and ASA award standards — not a clean percentile table like
 * rowing (Part B). Recommend sanity-checking against a handful of real
 * swimmers' times before fully trusting this table; revisit once real
 * logged swim data comes in. Female factor (1.073) still applied on top.
 */
const SWIM_400M_ANCHORS: Anchor[] = [
  [240, 925], // 4:00
  [285, 725], // 4:45
  [315, 475], // 5:15
  [420, 250], // 7:00
  [540, 125], // 9:00
];

/** Sports still scored via a single male curve + FEMALE_CARDIO_FACTORS multiplier — row (Part B) and, indirectly through row, ski are the exceptions (sex-specific tables). */
const ANCHOR_TABLES: Record<Exclude<BenchmarkSport, "ski" | "row">, Anchor[]> = {
  run: RUN_5K_ANCHORS,
  walk: WALK_PACE_ANCHORS,
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
 * calibrated 0–1000 scale. Row uses sex-specific anchor tables sourced
 * directly from sex-specific percentile data (Part B — more accurate than a
 * single curve + multiplier). Everything else applies the activity's female
 * factor first so equal-ability men and women land on the same tier.
 */
export function timeToScore(sport: BenchmarkSport, seconds: number, sex: "male" | "female"): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;

  if (sport === "row") {
    const table = sex === "female" ? ROW_2K_ANCHORS_FEMALE : ROW_2K_ANCHORS_MALE;
    return clampScore(interpolateAnchors(table, seconds));
  }

  if (sport === "ski") {
    // Ski reuses the male rowing curve after converting to a row-equivalent
    // time, then applies its own (rowing-inherited) female multiplier — ski
    // doesn't have its own sex-specific percentile data the way row now does.
    const rowEquivalent = skiToRowEquivalentSeconds(seconds);
    const adjusted = sex === "female" ? rowEquivalent / FEMALE_CARDIO_FACTORS.ski : rowEquivalent;
    return clampScore(interpolateAnchors(ROW_2K_ANCHORS_MALE, adjusted));
  }

  const factor = FEMALE_CARDIO_FACTORS[sport];
  const adjusted = sex === "female" ? seconds / factor : seconds;
  return clampScore(interpolateAnchors(ANCHOR_TABLES[sport], adjusted));
}
