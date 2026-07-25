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

/** Data-derived F/M time-ratio factors — a woman's time is divided by this before scoring on the male curve. Differ by sport; do not reuse the running factor elsewhere. Row uses its own sex-specific anchor tables instead of this factor for its own scoring — kept here because `ski` inherits it (same machine family, no sex-specific ski data of its own). Run is back on the multiplier (reverted to the male-only Motera table, no sex-specific Motera data available). */
export const FEMALE_CARDIO_FACTORS: Record<BenchmarkSport, number> = {
  run: 1.152,
  walk: 1.152, // mirrors running per instruction
  swim: 1.073,
  cycle: 1.219,
  row: 1.187, // unused for row's own scoring — row has sex-specific tables now
  ski: 1.187, // inherits rowing — same machine family
};

/** SkiErg is ~10% less power than RowErg for equal effort; power ∝ pace^-3, so ski pace is slower by this factor. Validated: 7:00 row ≈ 7:16 ski. */
export const SKI_FROM_ROW_PACE = 1.0357;

type Anchor = [seconds: number, score: number];

/**
 * Corrected against the Motera 5k times chart QA reconstruction (male,
 * general/non-age-specific) — read directly off the chart at every
 * available point rather than reduced to a handful of tier-boundary
 * anchors, so the interpolated curve hugs the real chart closely
 * throughout. Reverted here from a briefly-tried Run Regimen (single-
 * source, sex-specific, percentile-convention) table after direct
 * comparison — Stephen judged Motera's numbers more accurate for run
 * specifically. Row/cycle/swim are unaffected by this reversal (Row was
 * already Motera-consistent via RowingRegimen; cycle/swim have no Motera
 * equivalent to compare against and haven't been flagged as wrong).
 * Excludes the chart's 14:00 row (flagged extrapolated/outside-anchors in
 * the source — non-monotonic relative to 15:00, an artifact, not real
 * data). No sex-specific Motera data available in the same dense format,
 * so female runners use the existing female cardio factor (1.152) on this
 * male curve, same as swim/cycle/walk/ski.
 */
const RUN_5K_ANCHORS: Anchor[] = [
  [900, 950], // 15:00
  [960, 910], // 16:00
  [1020, 870], // 17:00
  [1050, 850], // 17:30
  [1110, 775], // 18:30
  [1170, 708.3], // 19:30
  [1200, 675], // 20:00
  [1290, 615], // 21:30
  [1350, 575], // 22:30
  [1440, 530], // 24:00
  [1500, 500], // 25:00
  [1620, 440], // 27:00
  [1740, 380], // 29:00
  [1800, 350], // 30:00
  [1980, 305], // 33:00
  [2160, 260], // 36:00
  [2220, 245], // 37:00
  [2400, 200], // 40:00
  [2640, 170], // 44:00
];

/**
 * Corrected against Rowing Regimen (rowingregimen.com), Concept2-logbook-
 * derived, age-30 (== age-25 for this purpose — the source treats 20-30 as
 * a flat band, consistent with the age-factor curve below doing the same
 * for 25-35). Same 5/20/50/80/95th percentile convention as run (same
 * sibling-site network) — high confidence, already a clean single source,
 * unchanged in substance from the prior pass (only the 99th-percentile
 * anchor is now derived via the same WR-gap rule as every other activity,
 * rather than a one-off floor point).
 */
const ROW_2K_ANCHORS_MALE: Anchor[] = [
  [359.9, 925], // 5:59.9 — 99th percentile (30% of gap toward WR 5:35.8)
  [370.2, 850], // 6:10.2 — 95th percentile
  [395.9, 725], // 6:35.9 — 80th percentile
  [424.6, 475], // 7:04.6 — 50th percentile
  [455.4, 250], // 7:35.4 — 20th percentile
  [486.9, 125], // 8:06.9 — 5th percentile
];

const ROW_2K_ANCHORS_FEMALE: Anchor[] = [
  [412.2, 925], // 6:52.2 — 99th percentile (30% of gap toward WR 6:24.8)
  [423.9, 850], // 7:03.9 — 95th percentile
  [464.0, 725], // 7:44.0 — 80th percentile
  [510.2, 475], // 8:30.2 — 50th percentile
  [561.0, 250], // 9:21.0 — 20th percentile
  [614.2, 125], // 10:14.2 — 5th percentile
];

/**
 * Corrected against Cycling Regimen (cyclingregimen.com), age-25 male, same
 * sibling-site network and percentile convention as run/row. High
 * confidence for the 5/20/50/80/95th percentile points; the 99th-percentile
 * anchor uses a separately-sourced elite/pro estimate (~22:00) since that
 * page had no WR column of its own — flagged lower confidence for that one
 * point only. Female table not captured this pass — the existing female
 * cardio factor (1.219) is still applied on top of this male curve.
 */
const CYCLE_20K_ANCHORS: Anchor[] = [
  [1833.8, 925], // 30:33.8 — 99th percentile (30% of gap toward ~22:00 elite/pro estimate)
  [2054, 850], // 34:14 — 95th percentile
  [2202, 725], // 36:42 — 80th percentile
  [2402, 475], // 40:02 — 50th percentile
  [2698, 250], // 44:58 — 20th percentile
  [3118, 125], // 51:58 — 5th percentile
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
 * Corrected against Swimming Regimen (swimmingregimen.com), age-25 male,
 * LCM, same sibling-site network and percentile convention as run/row/cycle.
 * Replaces the previous scaled-from-running/ASA-standards placeholder.
 * High confidence for the 5/20/50/80/95th percentile points; the 99th-
 * percentile anchor uses a separately-sourced WR estimate (~3:40) since that
 * page had no WR column of its own — flagged lower confidence for that one
 * point only. Female table not captured this pass — the existing female
 * cardio factor (1.073) is still applied on top of this male curve.
 */
const SWIM_400M_ANCHORS: Anchor[] = [
  [269.5, 925], // 4:29.5 — 99th percentile (30% of gap toward WR estimate 3:40.0)
  [290.7, 850], // 4:50.7 — 95th percentile
  [304, 725], // 5:04.0 — 80th percentile
  [317.1, 475], // 5:17.1 — 50th percentile
  [343.5, 250], // 5:43.5 — 20th percentile
  [370.1, 125], // 6:10.1 — 5th percentile
];

/** Sports scored via a single male curve + FEMALE_CARDIO_FACTORS multiplier (no sex-specific source data captured for these) — row and, indirectly through row, ski are the exceptions (sex-specific tables). */
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
 * directly from sex-specific percentile data (more accurate than a single
 * curve + multiplier). Everything else — including run, since reverting to
 * the Motera-sourced table (male-only data) — applies the activity's female
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
