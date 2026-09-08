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
/*
 * Calibrated 8 September 2026 against `docs/pre-launch/calibration-data.md`.
 *
 * Every factor below is now the female:male time ratio at the MEDIAN of the
 * population the sport's own anchor table scores, and at that sport's own
 * benchmark distance. Before this, three of them were not:
 *
 *   swim 1.073 → 1.14   1.073 is the ratio between two world records (§1a).
 *                       The swim anchor table had already been rebased from
 *                       club swimmers to the general population and the sex
 *                       factor was left behind, so a median woman was scored
 *                       against an Olympic-final sex gap. 1.14 is §5's 50th,
 *                       derived from the USMS mid-pack tiers; re-checked
 *                       against §1b directly, whose five non-elite tiers
 *                       average 1.1454, so the two agree to within half a
 *                       point. See the two warnings below — swimming has the
 *                       weakest foundation of the five and it is not the one
 *                       most people would guess.
 *   cycle 1.219 → 1.098 The IRONMAN 70.3 bike leg: 625,393 men and 198,066
 *                       women, directly measured, and what §2e explicitly
 *                       recommends as the recreational anchor. 1.219 was
 *                       outside every sourced number and its provenance is
 *                       unknown. See the warning below before touching this.
 *   ski 1.187 → 1.1644  Inherited from rowing on the reasoning "same machine
 *                       family, no sex-specific ski data of its own". There is
 *                       ski data: §3b, the 2025 Concept2 logbook at 2000 m.
 *
 * On the ski figure specifically, because it is easy to take the wrong one:
 * §5's SkiErg table is measured at 1000 m and gives 1.246 at the median. This
 * app benchmarks SkiErg at 2000 m (see BENCHMARK_DISTANCES above), and §3b
 * gives the 2000 m ratio, 1.164. Using the 1000 m figure here would put a
 * median female skier 30 seconds fast on a 2000 m row-equivalent — a second
 * miscalibration wearing the first one's clothes. Same distance as the anchor
 * table, or the number does not belong here.
 *
 *   run 1.152 → 1.191   §4a, and this one has the best evidence of the four.
 *                       RunRepeat's 5 km percentile table is 35 million race
 *                       results at this table's own benchmark distance, and the
 *                       F:M ratio is flat across the entire middle of the
 *                       distribution: 1.195 at the 80th, 1.191 at the 70th,
 *                       60th and 50th, 1.189 at the 40th, 1.186 at the 30th.
 *                       It moves only at the extremes — 1.237 at the 99th,
 *                       1.146 at the 10th. So 1.191 is not a median cherry-
 *                       picked from a curve; it is the value for almost every
 *                       runner this app will score. parkrun's ~1.19 and a
 *                       separate 736,928-result dataset both agree.
 *
 *                       1.152 matched no percentile in that table. The nearest
 *                       is the 10th-20th (1.146-1.179): the sex gap of the
 *                       slowest runners, applied to everyone, which under-
 *                       credited every woman through the middle of the field.
 *
 *                       This one carries the furthest. The run table is the
 *                       reference population the other anchor tables were
 *                       rebased onto, so it is the table the rest are read
 *                       against.
 *
 *   walk 1.191 → 1.146  and it should never have been 1.191. This mirrored
 *                       `run` "per instruction", so when run moved from 1.152
 *                       to 1.191 walk was carried along with it. The research
 *                       contradicts the mirror directly. §4e, explaining why
 *                       the running ratio *narrows* to 1.146 at the 10th
 *                       percentile after sitting flat at ~1.19 through the
 *                       middle: "the slow tail of a mass road race is
 *                       dominated by walkers of both sexes, and walking speed
 *                       differs between the sexes far less than running speed
 *                       does."
 *
 *                       So walking's sex gap is not running's — it is
 *                       materially smaller, and mirroring pushed it the wrong
 *                       way. 1.146 is that walker-dominated tail figure, which
 *                       is the closest thing to a measurement of walking in
 *                       the document.
 *
 * ## Walking is the least-evidenced constant here, and it is worth saying why
 *
 * 1.146 is a proxy, not a walking measurement. It is the F:M ratio of the
 * bottom decile of a mass 5 km road race — a field that is *dominated by*
 * walkers, not made only of them. A pure walking population would sit lower
 * still, since the slow runners mixed into that decile are the ones carrying
 * the larger gap.
 *
 * It is also not the app's distance: walk benchmarks at 2500 m against a 5 km
 * running field, and §4e's own data-quality note treats RunRepeat as "one good
 * estimate, not ground truth".
 *
 * Note what §6 does *not* say. Its eight-item list of what could not be found
 * has no walking entry — not because walking data was searched for and missing,
 * but because walking was never in scope. That is a different and weaker
 * position than the other four sports, all of which were looked for
 * deliberately, and it is why the band on this one only asserts the direction
 * the evidence gives: below running, not equal to it.
 *
 * ## Cycling: do not "improve" this with the power model in §2d
 *
 * §2d works the physics properly — drag, rolling resistance, real CdA and mass
 * for each sex — and lands on 1.025, or 1.048 on a less aggressive female
 * position. It is the most rigorous-looking number in the cycling section and
 * it is the one number there that must not be used. §2e says so directly: "Do
 * not use the §2d conversion as the basis for a cycling anchor table."
 *
 * The reason is upstream of the physics. It is driven by Cycling Analytics'
 * finding that median W/kg is identical between the sexes (3.80 vs 3.80), and
 * that dataset is cyclists who buy a power meter and pay for analytics — the
 * most self-selected source in the document — with a female sample the
 * publisher itself calls "particularly rough because of the lower number of
 * people". If those women sit further up their own distribution than the men
 * do up theirs, equal median W/kg is an artefact of unequal selection rather
 * than a fact about cyclists, which is exactly why the model under-predicts
 * the observed race gap by a factor of two to four.
 *
 * A physics derivation carries more authority than a mean of race results, and
 * here it is the wrong answer. That is the whole reason this paragraph exists.
 *
 * ## What is still not known about cycling
 *
 * This is the weakest constant of the five and the research says so — "by far
 * the least calibratable", with two sourced numbers and no percentile
 * structure at all. Three specific caveats travel with it:
 *
 *   · §2e expects a 20 km solo TT — which is what this app benchmarks — to
 *     show a slightly LARGER gap than the 90 km IRONMAN leg this figure comes
 *     from, because that leg is paced to protect the run and a shorter effort
 *     loads absolute power harder. "Slightly" is not quantified anywhere, so
 *     1.098 is a floor rather than a point estimate, and inventing a bump
 *     would be inventing precision.
 *   · The elite ratio, 1.126 at the hour record, is LARGER than the
 *     recreational one. Every other sport here widens the other way as ability
 *     falls. §5 flags the inversion as unexplained, and it is a reason to
 *     distrust both endpoints rather than to interpolate confidently between
 *     them.
 *   · Full-distance IRONMAN reports a ~15% cycling gap against the 70.3's
 *     9.8%, which no mechanism in the document accounts for.
 *
 * The gap that would settle it is named in §2e: no UK CTT distribution has
 * ever been published, and getting one means scraping event results directly.
 * Until then this number should move only on new data, not on new reasoning.
 *
 * ## Swimming: the IRONMAN split is the wrong dataset here, unlike cycling
 *
 * §1c is the largest sex-split adult swimming dataset in the document —
 * 823,459 IRONMAN 70.3 finishers, a general population rather than a
 * competitive one — and it gives 1.0573. It is exactly the source that ought
 * to be used, by the same reasoning that makes the equivalent bike figure the
 * right anchor for cycling, and §1d says specifically not to:
 *
 *     "For a 400 m pool event, the USMS-family ratios are the relevant ones
 *      and the 70.3 ratio should not be used."
 *
 * A 70.3 swim is 1.9 km of open water, wetsuit-legal, mass start with
 * drafting, and a cut-off that truncates the slow tail. Neoprene removes much
 * of the buoyancy advantage women hold in a pool and drafting compresses the
 * field, so that 5.7% gap is a fact about that race format, not about swimming
 * 400 m. The two source families disagree by a factor of two — 5.7% against
 * USMS's 13-17% — and both are right about their own population.
 *
 * So cycling and swimming take opposite answers from the same study, and the
 * reason is the format rather than the sample size. Reaching for the bigger
 * dataset is the mistake here.
 *
 * ## Swimming: the population this table scores has never been measured
 *
 * §1d calls this "the single biggest gap in this whole document": no published
 * percentile distribution of 400 m pool freestyle for a general adult
 * population, split by sex, appears to exist.
 *
 * The size of the extrapolation is worth seeing plainly. USMS's slowest
 * published tier is the 45th percentile *of people who entered a sanctioned
 * masters meet*, about 6:10 for 400 m. This table's 50th percentile is 9:20.
 * The median swimmer it scores is three minutes slower than the slowest
 * swimmer anyone has measured a sex ratio for.
 *
 * 1.14 is therefore the mid-pack ratio of the nearest measured population, not
 * of the scored one, and §5 is explicit that extrapolating further is
 * unsupported: the running pattern would give ~1.13 at the 20th percentile and
 * the SkiErg pattern ~1.19, "and the choice is unsupported". Six points apart,
 * with no way to choose. The cells are noisy too — 83 women and 99 men — which
 * is why the tier shape is used rather than any single cell.
 */
export const FEMALE_CARDIO_FACTORS: Record<BenchmarkSport, number> = {
  run: 1.191, // §4a, RunRepeat 5 km — flat at 1.186-1.195 across the 30th-80th
  walk: 1.146, // §4e's walker-dominated tail — NOT run's figure, see below
  swim: 1.14, // §5, 400 m freestyle, 50th percentile
  cycle: 1.098, // §2c, IM 70.3 bike leg, 823,459 finishers — a floor, see above
  // Dead. Row is scored from ROW_2K_ANCHORS_MALE/FEMALE and never reaches the
  // multiplier path; ski used to inherit this value, which was the stated
  // reason for keeping it, and no longer does. The Record type requires every
  // sport to have an entry, so it stays as a placeholder rather than a number
  // anyone should read or maintain.
  row: 1.187,
  ski: 1.1644, // §3b, C2 logbook 2025, 2000 m: 9:35.8 F / 8:14.5 M
};

/**
 * How much slower a SkiErg 2000 m is than a RowErg 2000 m at equal standing.
 *
 * Measured, not assumed: the 2025 Concept2 logbook at the median, same season
 * and same distance for both machines — 8:14.5 ski against 7:46.8 row for men
 * (§3b, §3c), which is 1.0593.
 *
 * It was 1.0357, carrying the comment "Validated: 7:00 row ≈ 7:16 ski". That
 * was not a validation: 7:00 × 1.0357 = 7:14.9, so it restated the constant
 * against itself and any value would have "validated" the same way.
 *
 * ## This is the men's ratio, deliberately
 *
 * §3d notes the ski:row ratio is sex-dependent — 1.059 for men at the median
 * and 1.085 for women — and that one scalar cannot represent both. It does not
 * have to. A woman's ski time is divided by FEMALE_CARDIO_FACTORS.ski first,
 * which puts her in male-ski units, and this constant then converts male ski
 * to male row. The composition carries the sex dependence:
 *
 *     female ski 2000 m median   9:35.8  = 575.8 s
 *       ÷ 1.1644 (F:M ski, §3b)          = 494.5 s   the median male skier
 *       ÷ 1.0593 (ski:row men)           = 466.8 s   the median male rower ✓
 *
 * and 575.8 ÷ 530.7 = 1.085, §3d's women's figure, falls out of it rather than
 * being set. Both sexes land on their own median, and that is why the two must
 * move together or not at all.
 *
 * ## How much that composition actually proves — less than it looks
 *
 * Both constants are read from the same two tables, §3b and §3c, so the medians
 * landing on each other is guaranteed by construction. It shows the pair is
 * coherent; it does not show either is true of a real population. Stated here
 * because the first pass presented it as validation, and it is weaker than
 * that.
 *
 * ## The open question on ski, which is a real one
 *
 * §3g prefers the 1000 m tables to the 2000 m ones, and says the 2000 m
 * women's ratios — 1.164 to 1.188, which is exactly the range these constants
 * come from — are "too noisy to contradict the 1000 m pattern". Women's n at
 * 2000 m is 129. At 1000 m the median ratio is 1.246, and the gap widens as
 * ability falls (1.216 at the 80th to 1.322 at the 5th) where the 2000 m table
 * shows it flat.
 *
 * The 2000 m numbers are used anyway, for a reason that is structural rather
 * than a preference: the ski:row conversion only exists at 2000 m. §3c is a
 * RowErg 2000 m table, there is no 1000 m rowing distribution here, and this
 * app's rowing anchors are 2 km. A 1000 m F:M ratio has nothing at its own
 * distance to compose with, and pairing it with the 2000 m pace conversion
 * scores a median female skier 30 seconds faster than the median male rower.
 *
 * So this is the best available coherent pair, not the best available data. If
 * ski ever gets its own anchor table instead of borrowing rowing's, the 1000 m
 * distribution becomes usable and both of these should be revisited together.
 */
export const SKI_FROM_ROW_PACE = 1.0593;

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

/*
 * The sex ratios below were GIVEN, not measured, and the only measured rowing
 * distribution disagrees with them.
 *
 * Each row used to be annotated "sourced sex ratio". §4b of
 * `docs/pre-launch/calibration-data.md` lists this exact column as "Existing
 * app calibration — given in brief". It is an assumption, and calling it
 * sourced in the code is the same fault SKI_FROM_ROW_PACE had when it claimed
 * to be "Validated".
 *
 * What the data says. §3c is the 2025 Concept2 logbook at 2000 m: 9,561 men
 * and 2,545 women, the best-sampled sex-split distribution anywhere in that
 * document. Its F:M ratios are near flat — 1.131 at the 90th, 1.127 at the
 * 75th, 1.137 at the 50th, 1.152 at the 25th, so about 2 points of widening
 * across the whole measured range. This table implies 1.145 rising to 1.261,
 * roughly six times that gradient.
 *
 * The populations differ — the logbook is fitness-enthusiast, this table is
 * general — and §4 establishes that the sex gap does move with ability, so
 * some divergence is expected. It does not cover this much: the app's median
 * male, 8:03.1, sits near the logbook's 40th percentile, where the measured
 * ratio is about 1.143. This table uses 1.202 there. In real terms the female
 * median anchor is 9:40.5 where the measured ratio would put it at 9:12.2 —
 * 28 seconds more generous, so a median woman is scored against a standard
 * about 6% easier than the only measurement supports.
 *
 * Left as it stands rather than quietly rebased, because a correction here is
 * a whole table and not a scalar, and the tails cannot be sourced: the app's
 * 99th and 5th percentiles fall outside the logbook's measured range at both
 * ends, and extrapolating the gradient there is exactly the unsupported move
 * §5 warns against for swimming. Fixing the middle three anchors alone would
 * leave a kinked table, which is worse than a consistent wrong one.
 *
 * Tracked as its own milestone (`row-sex-table`) so it is visible rather than
 * buried here, with `scripts/check-row-sex-table-sourced.mjs` asserting only
 * over the range the logbook actually covers.
 */
const ROW_2K_ANCHORS_FEMALE: Anchor[] = [
  [439.2, 925], // 7:19.2 — 99th percentile (was 6:52.2; assumed ratio 1.145)
  [459.1, 850], // 7:39.1 — 95th percentile (was 7:03.9; assumed 1.145)
  [496.3, 725], // 8:16.3 — 80th percentile (was 7:44.0; assumed 1.172)
  [580.5, 475], // 9:40.5 — 50th percentile (was 8:30.2; assumed 1.202)
  [661.4, 250], // 11:01.4 — 20th percentile (was 9:21.0; assumed 1.232)
  [753.6, 125], // 12:33.6 — 5th percentile (was 10:14.2; assumed 1.261)
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
