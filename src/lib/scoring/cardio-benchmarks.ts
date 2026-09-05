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
 * Recalibrated to the general population of 5K runners rather than
 * competitive/club-level runners (user feedback: "I want split index scores
 * to be for the average people getting into running not elite athletes").
 * The prior Motera-chart-derived table put its 50th-percentile point at
 * 25:00 — 5-7 minutes faster than real population data, which meant the
 * whole curve (fast end included) read as calibrated toward serious
 * competitive runners rather than the average person who runs a 5K. Same
 * 5/20/50/80/95/99th-percentile convention as row/cycle below, built from
 * cross-referenced public race-result aggregators (not a single source):
 * PacePercentile.com's aggregate database (RunRepeat + Running USA + World
 * Athletics results) and RunDida's combined-population percentile table
 * both independently converge on ~30:00 for the 50th percentile and ~23:00
 * for the 75th, and RunRepeat's own 34-million-result "State of Running"
 * study puts the men's median at 31:28 (close, slightly slower) — 30:00 is
 * a reasoned middle point across these, not the single most extreme number
 * found. The fast end moved too: a 15:00 5K is genuinely national/
 * professional-class, not just "95th percentile of people who run 5Ks," so
 * pinning 99th-percentile-of-the-general-population at 17:00 (not 15:00)
 * is consistent with the same population re-basis, not a separate
 * adjustment. 20th/5th percentile points are extrapolated from the same
 * sources' slower tiers (sparser data at that end, lower confidence).
 * Female runners still use the existing female cardio factor (1.152) on
 * this male curve, unchanged.
 */
const RUN_5K_ANCHORS: Anchor[] = [
  [1020, 925], // 17:00 — 99th percentile
  [1140, 850], // 19:00 — 95th percentile
  [1305, 725], // 21:45 — 80th percentile
  [1800, 475], // 30:00 — 50th percentile (median)
  [2310, 250], // 38:30 — 20th percentile
  [2940, 125], // 49:00 — 5th percentile
];

/**
 * Rebased onto the SAME REFERENCE POPULATION as the run table above.
 *
 * The previous table read its percentiles off Rowing Regimen
 * (rowingregimen.com), which are Concept2-LOGBOOK percentiles: people who
 * own an erg and bother to upload results. That was internally fine, and
 * these anchors are still what that source says. It stopped being
 * comparable the moment the run table was rebased (see RUN_5K_ANCHORS and
 * "Recalibrate run scoring to general population, not competitive
 * runners") — run moved to the general population of people who run 5Ks
 * and row did not, leaving one shared 0-1000 ruler measuring two different
 * populations. Nothing in the scoring pipeline can absorb that: an athlete
 * gets one Split Index across sports, so a run score and a row score have
 * to mean the same thing.
 *
 * Measured, not asserted. Bridging both tables to aerobic capacity —
 * running via Daniels VDOT, rowing via Concept2 power (W = 2.80/(s/m)^3),
 * 20% gross ergometer efficiency and the duration-appropriate aerobic
 * share — the old table demanded 9.7 to 14.0 mL/kg/min MORE at every
 * single anchor, 5th percentile through 99th. A near-constant offset the
 * whole length of the curve is the signature of a different reference
 * population, not of a bad anchor or two. Concretely: the logbook's median
 * 2k (7:04.6) needs ~45 mL/kg/min, which is the run table's EIGHTIETH
 * percentile, so "median rower" was being scored against "top-fifth
 * runner". The bridge validates against known points before being trusted
 * — 5:45 at 93 kg gives 70.5, 7:00 at 82 kg gives 45.1, 9:00 gives 21.8,
 * all where the rowing literature puts them.
 *
 * Each anchor below is therefore the 2k an athlete of the SAME aerobic
 * capacity as the correspondingly-scored runner would pull, at an 80 kg
 * male reference. Mass is the real free parameter here (the erg carries
 * the athlete's weight, the road does not) and it is a gentle one: 78 kg
 * and 82 kg move every anchor by only ~3 seconds, well inside the noise
 * of the source data either table is built on.
 *
 * Note what this also repairs. The old band packed 5th-to-99th percentile
 * into a 1.353x spread of time where running's spans 2.882x, which is what
 * made a few percent of projected time worth hundreds of index points and
 * left the table hypersensitive to every upstream credit. The rebased band
 * spans 1.558x. It is still narrower than running's, and that part is real
 * physics rather than a calibration artefact — erg pace goes as
 * power^(-1/3), so a given physiological range always compresses into a
 * narrower pace range on the erg than on the road. That is precisely why
 * the relative-effort credits in cardio-activity.ts cannot be denominated
 * in percent-of-time across sports, and are capped in index points there.
 *
 * The female table keeps the sourced male:female ratio at each anchor
 * (1.145 at the 99th rising to 1.261 at the 5th) applied to the rebased
 * male times — the sex relationship in the source data is not what was
 * wrong, so it is preserved rather than re-derived.
 */
const ROW_2K_ANCHORS_MALE: Anchor[] = [
  [383.5, 925], // 6:23.5 — 99th percentile (was 5:59.9 on logbook percentiles)
  [401.0, 850], // 6:41.0 — 95th percentile (was 6:10.2)
  [423.4, 725], // 7:03.4 — 80th percentile (was 6:35.9)
  [483.1, 475], // 8:03.1 — 50th percentile (was 7:04.6)
  [536.9, 250], // 8:56.9 — 20th percentile (was 7:35.4)
  [597.4, 125], // 9:57.4 — 5th percentile (was 8:06.9)
];

const ROW_2K_ANCHORS_FEMALE: Anchor[] = [
  [439.2, 925], // 7:19.2 — 99th percentile (was 6:52.2; sourced sex ratio 1.145)
  [459.1, 850], // 7:39.1 — 95th percentile (was 7:03.9; 1.145)
  [496.3, 725], // 8:16.3 — 80th percentile (was 7:44.0; 1.172)
  [580.5, 475], // 9:40.5 — 50th percentile (was 8:30.2; 1.202)
  [661.4, 250], // 11:01.4 — 20th percentile (was 9:21.0; 1.232)
  [753.6, 125], // 12:33.6 — 5th percentile (was 10:14.2; 1.261)
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
 * Rebased onto the SAME REFERENCE POPULATION as the run and row tables above
 * — the general population of people who swim, not the population of people
 * who swim COMPETITIVELY.
 *
 * The previous table read its percentiles off Swimming Regimen
 * (swimmingregimen.com), age-25 male, LCM. Those are pool-club percentiles,
 * and the numbers say so out loud: they put the FIFTH percentile at 6:10.1
 * for 400m, which is 1:32.5/100m. A very large share of adults who swim
 * cannot hold 1:32/100m for 400m at all — it is a solid club-swimmer pace,
 * not the pace 95% of swimmers beat. The whole table sat in that register:
 * its median (5:17.1 = 1:19.3/100m) is a competitive age-grouper's 400m.
 *
 * That was internally consistent while every table came from the same
 * sibling-site network. It stopped being consistent the moment run was
 * rebased to the general population (RUN_5K_ANCHORS, median 30:00) and row
 * followed it (ROW_2K_ANCHORS_MALE) — leaving one shared 0-1000 ruler
 * measuring club swimmers against ordinary runners. An athlete gets ONE
 * Split Index across sports, so a swim score and a run score have to mean
 * the same thing.
 *
 * WHY THIS IS NOT DERIVED THE WAY ROW'S REBASE WAS. Row bridged to the run
 * table through aerobic capacity (Daniels VDOT one side, Concept2 power the
 * other) because on an erg, power and therefore pace really is close to a
 * pure function of aerobic capacity at a given mass. Swimming is not like
 * that and the same bridge would be a fabrication: swim speed is dominated
 * by drag and technique, and two swimmers with identical VO2max routinely
 * differ by more than a minute per 100m. A VO2max bridge would produce
 * confident-looking numbers with nothing underneath them. Swimming has to
 * be anchored on swimming-population evidence directly, which is sparser
 * than either of the other two sports' — flagged honestly as MEDIUM
 * confidence overall rather than dressed up as the measured bridge row got.
 *
 * The anchors below are set from the landmark paces that recur across
 * adult/masters swimming and open-water/triathlon split data:
 *   ~1:30/100m  — the commonly-cited threshold for a solid club-level
 *                 swimmer, placed at the 95th percentile of this population;
 *   ~1:50/100m  — a competent, technique-trained fitness swimmer (80th);
 *   ~2:20/100m  — the median adult lap swimmer; mid-pack age-group
 *                 triathletes sit a little faster than this (~2:00/100m),
 *                 and that population is fitter and more self-selected than
 *                 "everyone who logs a swim", so the median is placed
 *                 modestly slower than theirs (50th);
 *   ~3:10/100m  — swims continuously but untrained (20th);
 *   ~4:00/100m  — beginner pace, typically with rests at the wall (5th).
 *
 * Note the SPREAD, which is the part that matters most for scoring. The old
 * table packed 5th-to-99th percentile into 1.373x of time; running's spans
 * 2.882x and rowing's 1.558x. Swimming's true spread is the WIDEST of the
 * three, not the narrowest — an untrained adult runner is perhaps twice a
 * good club runner's time, while an untrained adult swimmer is easily three
 * times a good club swimmer's, because technique (not fitness) sets the
 * floor in water. This table spans 3.0x. That single fact is why the
 * reported defect happened: a table 1.373x wide has almost no room below its
 * slowest anchor, so an ordinary swim fell off the bottom of it and
 * extrapolated straight past zero.
 *
 * Female table not captured this pass — the existing female cardio factor
 * (1.073, the narrowest sex gap of any sport here, which matches swimming's
 * real male/female spread) is still applied on top of this male curve.
 */
const SWIM_400M_ANCHORS: Anchor[] = [
  [320, 925], // 5:20 — 1:20/100m — 99th percentile (was 4:29.5 on club percentiles)
  [360, 850], // 6:00 — 1:30/100m — 95th percentile (was 4:50.7)
  [440, 725], // 7:20 — 1:50/100m — 80th percentile (was 5:04.0)
  [560, 475], // 9:20 — 2:20/100m — 50th percentile (was 5:17.1)
  [760, 250], // 12:40 — 3:10/100m — 20th percentile (was 5:43.5)
  [960, 125], // 16:00 — 4:00/100m — 5th percentile (was 6:10.1)
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
 * Real, dated world/world-best times per benchmark sport and sex (user
 * feedback: "make a rule where 999 is never achieved unless this is a
 * world record for age and gender") — 999 is now reserved for actually
 * matching or beating one of these, not for extrapolating the fast-end
 * anchor slope indefinitely. Checked against each SEX'S OWN record
 * directly (not run through the population FEMALE_CARDIO_FACTORS
 * multiplier) — that factor is tuned for ordinary-pace comparisons, and
 * the real male/female gap narrows noticeably at the elite/WR tail, so
 * converting a near-record female time through the flat population factor
 * would misrepresent how close it truly is to HER record.
 *
 * "...for age" is handled for free by the caller's existing age-grading
 * (enduranceAgeGradeFactor) — scoreCardioActivity already multiplies the
 * benchmark-equivalent time by this factor before it reaches timeToScore,
 * so an older athlete's age-graded-equivalent time is what's actually
 * compared here, exactly how real age-graded record tables work (age
 * factor x performance vs open-class standard). Callers that pass a raw,
 * non-age-graded time get compared against the open/absolute record
 * instead — a stricter but still reasonable fallback.
 *
 * Cycle and walk are intentionally excluded: cycling's 20km TT benchmark
 * has no single canonical world-record time (road time-trial records vary
 * hugely by course and conditions, unlike a track/pool/erg record), and
 * walk is scored on pace rather than a competitive-record event. Both
 * keep the prior linear-extrapolation-capped-at-999 behavior until a
 * defensible reference exists — flagged as a known gap, not silently
 * guessed at.
 */
const WORLD_RECORD_SECONDS: Partial<Record<BenchmarkSport, { male: number; female: number }>> = {
  run: { male: 12 * 60 + 49, female: 13 * 60 + 54 }, // 5K road: Berihu Aregawi 12:49 (2021); Beatrice Chebet 13:54 (2024)
  row: { male: 5 * 60 + 33.4, female: 6 * 60 + 21.1 }, // Concept2 2000m: Simon van Dorp 5:33.4 (2026); Brooke Mooney 6:21.1 (2021)
  swim: { male: 3 * 60 + 39.96, female: 3 * 60 + 54.18 }, // 400m freestyle (LC): Lukas Märtens 3:39.96 (2025); Summer McIntosh 3:54.18 (2025)
};

/**
 * Replaces simple linear extrapolation beyond the fastest defined anchor
 * with an asymptotic approach toward 999 that only actually REACHES 999 at
 * or beyond the real world record — see WORLD_RECORD_SECONDS above. Times
 * at or slower than the fastest anchor are untouched (normal interpolation
 * still applies); only the "faster than any anchor" extrapolation zone is
 * affected. All of `rawSeconds`/`realFastestAnchorSeconds`/
 * `worldRecordSeconds` must already be in the SAME real, actual-clock-time
 * unit system (i.e. already converted back out of any population female-
 * factor adjustment) — see call sites.
 */
function applyWorldRecordCeiling(
  linearScore: number,
  rawSeconds: number,
  realFastestAnchorSeconds: number,
  realFastestAnchorScore: number,
  worldRecordSeconds: number | undefined
): number {
  if (!worldRecordSeconds) return linearScore; // no record on file for this sport/sex — keep prior behavior
  if (rawSeconds > realFastestAnchorSeconds) return linearScore; // not in extrapolation territory at all
  if (rawSeconds <= worldRecordSeconds) return 999; // matched or beat the actual record
  const progress = clamp01(
    (realFastestAnchorSeconds - rawSeconds) / (realFastestAnchorSeconds - worldRecordSeconds)
  ); // 0 at the anchor, ->1 approaching the record
  const asymptotic =
    realFastestAnchorScore + (999 - realFastestAnchorScore) * (1 - Math.exp(-progress * 4));
  return Math.min(998, asymptotic); // stays visibly short of 999 until the record itself is reached
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The [seconds, score] pair with the lowest seconds (fastest time / highest score) in an anchor table. */
function fastestAnchorIn(anchors: Anchor[]): Anchor {
  return anchors.reduce((a, b) => (a[0] < b[0] ? a : b));
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
    const linear = interpolateAnchors(table, seconds);
    const wr = WORLD_RECORD_SECONDS.row;
    if (!wr) return clampScore(linear);
    const [anchorSeconds, anchorScore] = fastestAnchorIn(table);
    return clampScore(
      applyWorldRecordCeiling(linear, seconds, anchorSeconds, anchorScore, sex === "female" ? wr.female : wr.male)
    );
  }

  if (sport === "ski") {
    // Ski reuses the male rowing curve after converting to a row-equivalent
    // time, then applies its own (rowing-inherited) female multiplier — ski
    // doesn't have its own sex-specific percentile data the way row now does.
    const rowEquivalent = skiToRowEquivalentSeconds(seconds);
    const adjusted = sex === "female" ? rowEquivalent / FEMALE_CARDIO_FACTORS.ski : rowEquivalent;
    const linear = interpolateAnchors(ROW_2K_ANCHORS_MALE, adjusted);
    const wr = WORLD_RECORD_SECONDS.row;
    if (!wr) return clampScore(linear);
    // `adjusted` is already a male-row-equivalent value (sex folded in
    // above), so it's compared directly against row's own male record —
    // no separate ski world record on file.
    const [anchorSeconds, anchorScore] = fastestAnchorIn(ROW_2K_ANCHORS_MALE);
    return clampScore(applyWorldRecordCeiling(linear, adjusted, anchorSeconds, anchorScore, wr.male));
  }

  const factor = FEMALE_CARDIO_FACTORS[sport];
  const adjusted = sex === "female" ? seconds / factor : seconds;
  const linear = interpolateAnchors(ANCHOR_TABLES[sport], adjusted);
  const wr = WORLD_RECORD_SECONDS[sport];
  if (!wr) return clampScore(linear);
  // Checked against RAW seconds (this sex's own actual clock time), not the
  // population-factor-adjusted value — see WORLD_RECORD_SECONDS's doc
  // comment for why. The anchor's own fastest point is mapped back into
  // this sex's real time units the same way, so both sides of the
  // comparison stay in a consistent unit system.
  const [anchorSeconds, anchorScore] = fastestAnchorIn(ANCHOR_TABLES[sport]);
  const realAnchorSeconds = sex === "female" ? anchorSeconds * factor : anchorSeconds;
  return clampScore(
    applyWorldRecordCeiling(linear, seconds, realAnchorSeconds, anchorScore, sex === "female" ? wr.female : wr.male)
  );
}
