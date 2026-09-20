/**
 * Split Index — fitness equivalent for one cardio session
 * -------------------------------------------------------
 * Both cardio scores (see cardio-activity.ts) are built from ONE number: the
 * time this session implies the athlete could post at their sport's benchmark
 * distance (5K run, 2K row, 400m swim, 20K ride, 2K ski, or per-km pace for a
 * walk), had the effort been maximal, on flat ground, in comfortable
 * conditions. Everything that turns a raw split into that number lives here,
 * as small pure functions, so both scores read the session the same way:
 *
 *   1. project the session to the benchmark distance (Riegel),
 *   2. remove the time spent climbing (terrain),
 *   3. remove the time lost to heat or cold (weather),
 *   4. re-reference erg times to the anchor table's bodyweight (row/ski),
 *   5. scale for how hard the athlete was working (heart rate, or RPE when
 *      there is no heart rate) — a sub-maximal effort implies a faster
 *      maximal one.
 *
 * What is deliberately NOT here: anything keyed off the session-type tag. The
 * previous engine credited "easy"/"recovery"/"long" sessions through a stack
 * of bonus-only mechanisms (HR-zone credit, an efficiency-factor bonus, a
 * long-run credit, a ceiling bonus, and a floor at 85% of the athlete's own
 * recent easy scores). Each was capped, and the caps bound on almost every
 * session, so runs of visibly different quality — same pace at +20 bpm, or
 * 50 s/km slower — landed on the same one or two numbers. A tag says what
 * the athlete intended; heart rate says what happened. This model reads the
 * latter and ignores the former entirely.
 *
 * Every adjustment is continuous in its input and either strictly monotonic
 * or saturating through a smooth curve (tanh), never a hard clip. That is
 * what keeps two different sessions from converging on one score.
 *
 * Sources (verify on review):
 *  - %HRR ≈ %VO2R, and speed linear in VO2 above rest: Swain & Leutholtz
 *    (1997); ACSM running equation.
 *  - Riegel (1977) T2 = T1 × (D2/D1)^k, per-sport k in cardio-predictions.ts.
 *  - Concept2 weight adjustment: Wf = (bodyweight_lb / 270)^0.222, re-
 *    referenced here to the anchor table's own reference mass.
 *  - Heat: Ely et al. (2007) marathon decrement ~0.3%/°C WBGT for elites,
 *    steeper for slower runners; scaled down for shorter benchmark efforts.
 *  - Hills: Minetti et al. (2002) energy cost of gradient running; Strava
 *    GAP-style aggregate of ~4%/% uphill, ~-1.5%/% downhill over a loop.
 */

import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import { benchmarkRiegelK, riegelEquivalentSeconds } from "@/lib/scoring/cardio-predictions";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------
// 1. Projection
// ---------------------------------------------------------------------------

/**
 * The session's raw time at the benchmark distance — Riegel for everything,
 * per-km pace for walking (walking is scored on pace, not a fatigue curve).
 * Null when there is nothing to project from.
 */
export function projectToBenchmarkSeconds(
  sport: BenchmarkSport,
  distanceMeters: number,
  durationSeconds: number,
  riegelK: number = benchmarkRiegelK(sport)
): number | null {
  if (!(distanceMeters > 0) || !(durationSeconds > 0)) return null;
  if (sport === "walk") return durationSeconds / (distanceMeters / 1000);
  return riegelEquivalentSeconds(durationSeconds, distanceMeters, BENCHMARK_DISTANCE_METERS[sport], riegelK);
}

// ---------------------------------------------------------------------------
// 2. Terrain
// ---------------------------------------------------------------------------

/**
 * Fraction of the session's time attributable to climbing, per metre of
 * ascent per kilometre. Only total ascent is logged (not the profile), so the
 * route is assumed to be a loop — what goes up comes back down — and the
 * figure is the net cost of that: roughly +4% of pace per 1% of uphill grade
 * against roughly -1.5% per 1% downhill, averaged, i.e. about 2% per 10 m of
 * gain per km. Cycling climbs cost less per metre at road speeds; walking
 * slightly less than running. Ergs and pools have no terrain.
 */
const ELEVATION_TIME_FRACTION_PER_M_PER_KM: Record<BenchmarkSport, number> = {
  run: 0.002,
  walk: 0.0015,
  cycle: 0.0012,
  row: 0,
  ski: 0,
  swim: 0,
};
/** Asymptote — a mountain route is hard, but no route makes a flat time twice as fast. */
const ELEVATION_TIME_FRACTION_MAX = 0.2;

export function elevationTimeFraction(
  sport: BenchmarkSport,
  elevationMeters: number | null | undefined,
  distanceMeters: number | null | undefined
): number {
  const rate = ELEVATION_TIME_FRACTION_PER_M_PER_KM[sport];
  if (!rate || !elevationMeters || elevationMeters <= 0 || !distanceMeters || distanceMeters <= 0) return 0;
  const gainPerKm = elevationMeters / (distanceMeters / 1000);
  const raw = gainPerKm * rate;
  return ELEVATION_TIME_FRACTION_MAX * Math.tanh(raw / ELEVATION_TIME_FRACTION_MAX);
}

// ---------------------------------------------------------------------------
// 3. Weather
// ---------------------------------------------------------------------------

/** Above this air temperature, running performance measurably degrades. */
const HEAT_ONSET_C = 15;
/** Below this, it degrades the other way (cold muscles, more clothing). */
const COLD_ONSET_C = 5;
const HEAT_FRACTION_PER_C: Record<BenchmarkSport, number> = {
  run: 0.0012,
  walk: 0.0008,
  cycle: 0.0008,
  row: 0,
  ski: 0,
  swim: 0,
};
const COLD_FRACTION_PER_C: Record<BenchmarkSport, number> = {
  run: 0.0008,
  walk: 0.0006,
  cycle: 0.001, // wind chill at speed
  row: 0,
  ski: 0,
  swim: 0,
};
const TEMPERATURE_TIME_FRACTION_MAX = 0.08;

export function temperatureTimeFraction(
  sport: BenchmarkSport,
  temperatureCelsius: number | null | undefined
): number {
  if (temperatureCelsius == null || !Number.isFinite(temperatureCelsius)) return 0;
  let raw = 0;
  if (temperatureCelsius > HEAT_ONSET_C) raw = (temperatureCelsius - HEAT_ONSET_C) * HEAT_FRACTION_PER_C[sport];
  else if (temperatureCelsius < COLD_ONSET_C) raw = (COLD_ONSET_C - temperatureCelsius) * COLD_FRACTION_PER_C[sport];
  if (raw <= 0) return 0;
  return TEMPERATURE_TIME_FRACTION_MAX * Math.tanh(raw / TEMPERATURE_TIME_FRACTION_MAX);
}

// ---------------------------------------------------------------------------
// 4. Bodyweight (ergs only)
// ---------------------------------------------------------------------------

/**
 * The anchor tables for rowing were bridged to running at an 80 kg male
 * reference (cardio-benchmarks.ts); the female table was derived from it by
 * measured ratio, and a median female rower is lighter, so she gets her own
 * reference. Erg pace scales with bodyweight because the machine carries the
 * athlete's mass — Concept2's own weight adjustment, Wf = (lb/270)^0.222,
 * expresses exactly that; it is re-referenced here to these masses so an
 * athlete AT the reference is untouched. A heavier rower's raw time is
 * multiplied by more than 1 (they were expected to be faster), a lighter
 * rower's by less. Running, cycling and swimming have no accepted weight
 * grading, so their factor is 1: weight and height are read there only
 * through the sex- and age-specific tables.
 */
const ERG_REFERENCE_BODYWEIGHT_KG: Record<"male" | "female", number> = { male: 80, female: 68 };
const CONCEPT2_WEIGHT_EXPONENT = 0.222;
/** Outside this band the C2 formula has no data behind it; hold the factor rather than extrapolate. */
const ERG_WEIGHT_MIN_KG = 45;
const ERG_WEIGHT_MAX_KG = 130;

export function bodyweightTimeFactor(
  sport: BenchmarkSport,
  bodyweightKg: number | null | undefined,
  sex: "male" | "female"
): number {
  if (sport !== "row" && sport !== "ski") return 1;
  if (!bodyweightKg || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return 1;
  const weight = clamp(bodyweightKg, ERG_WEIGHT_MIN_KG, ERG_WEIGHT_MAX_KG);
  return Math.pow(weight / ERG_REFERENCE_BODYWEIGHT_KG[sex], CONCEPT2_WEIGHT_EXPONENT);
}

// ---------------------------------------------------------------------------
// 5. Effort
// ---------------------------------------------------------------------------

/**
 * The heart-rate-reserve fraction a maximal effort at the benchmark distance
 * is sustained at — the intensity the anchor tables' times were posted at.
 * A 5K or a 2K erg is very close to the ceiling; a 40-minute ride and a
 * 400 m swim sit a little under it. Walking is excluded from effort scaling
 * altogether (see effortFractionForSport): its economy is strongly
 * non-linear in speed and it is rarely a maximal event, so a low heart rate
 * on a stroll is not evidence of a fast benchmark walk.
 */
export const BENCHMARK_EFFORT_FRACTION: Record<BenchmarkSport, number> = {
  run: 0.92,
  row: 0.94,
  ski: 0.94,
  cycle: 0.88,
  swim: 0.9,
  walk: 1, // never reached — see EFFORT_SCALED_SPORTS
};
export const EFFORT_SCALED_SPORTS = new Set<BenchmarkSport>(["run", "row", "ski", "cycle", "swim"]);

/**
 * Roughly how long a maximal effort at each sport's benchmark distance takes.
 * The fraction above is the intensity sustained for THAT long — which is the
 * only reason it can be compared with anything.
 */
const BENCHMARK_REFERENCE_MINUTES: Record<BenchmarkSport, number> = {
  run: 20, // a 5 k
  row: 7, // a 2 k
  ski: 8,
  cycle: 35, // a 20 k time trial
  swim: 8, // a 400 m
  walk: 30,
};

/**
 * How far the sustainable intensity falls per e-fold of duration.
 *
 * The bug this exists to fix, which is the one the athlete put their finger
 * on: every session used to be measured against the intensity of a maximal
 * FIVE KILOMETRE effort — about twenty minutes — whether it was a 45-minute
 * run or a 95-minute one. Nobody holds a 20-minute intensity for 95 minutes,
 * so a long run at a genuinely controlled heart rate was scored as though it
 * had been enormously easy, while a shorter, faster, higher-heart-rate run
 * was measured against a bar that actually applied to it. The long run won by
 * far more than it should have.
 *
 * What a session's heart rate should be compared with is the intensity
 * sustainable for a maximal effort OF THAT SESSION'S OWN LENGTH. That
 * declines close to linearly in the log of duration, which is the standard
 * shape of the intensity-duration relationship:
 *
 *     ~5 min   ~0.98      ~40 min   0.88
 *     ~10 min   0.96      ~60 min   0.86
 *     ~20 min   0.92      ~90 min   0.84
 *                        ~180 min   0.80
 *
 * 0.0546 is the slope through the 20-minute and 180-minute anchors, and the
 * intermediate points above fall out of it rather than being set: the fitted
 * curve gives 0.882 at 40 minutes and 0.838 at 90, against textbook values of
 * ~0.88 and ~0.84. Clamped at both ends, since neither a 90-second effort nor
 * a six-hour one is described by a line through those two points.
 */
const INTENSITY_DURATION_SLOPE = 0.0546;
const MIN_SUSTAINABLE_INTENSITY = 0.75;
const MAX_SUSTAINABLE_INTENSITY = 0.98;

/**
 * The heart-rate-reserve fraction a maximal effort of this duration is held
 * at, for this sport. Equals BENCHMARK_EFFORT_FRACTION at the sport's own
 * benchmark duration, and falls away either side of it.
 */
export function maxIntensityForDuration(sport: BenchmarkSport, durationSeconds: number): number {
  const base = BENCHMARK_EFFORT_FRACTION[sport];
  const reference = BENCHMARK_REFERENCE_MINUTES[sport];
  const minutes = durationSeconds / 60;
  if (!(minutes > 0) || !(reference > 0)) return base;
  const adjusted = base - INTENSITY_DURATION_SLOPE * Math.log(minutes / reference);
  return clamp(adjusted, MIN_SUSTAINABLE_INTENSITY, MAX_SUSTAINABLE_INTENSITY);
}

/**
 * Where the intensity credit stops being measured and starts being
 * extrapolated, and how hard it is damped once it is.
 *
 * ## What was wrong with capping it
 *
 * This used to saturate at 18% — an easy run could never imply more than an
 * 18% higher maximal intensity, however low the heart rate. That is a
 * ceiling, and it bound at a gap of 1.2, which is well INSIDE the range
 * Daniels actually measured. So the cap was overriding real data: the model
 * had a calibrated answer for an ordinary easy run and the cap threw it away
 * and substituted a smaller one. Easy runs could not exceed roughly 750
 * however well they were executed, and no amount of fitness shown on an easy
 * day could move them, which is exactly the complaint.
 *
 * ## What replaces it
 *
 * Nothing at all through the measured range. Daniels' easiest tabulated
 * point is a gap of about 1.46, where the uncapped model and his table agree
 * to within a percent: 1.46^(1/1.3) is 1.337, against his easy pace sitting
 * at about 75% of 5 k speed. So up to 1.5 the credit is simply what the
 * physiology says, and a genuinely outstanding easy run scores like one.
 *
 * Past 1.5 there is no data, and an unbounded model would read a near-walk at
 * 30% of reserve as proof of a sub-3:00/km 5 k. So the credit tapers there —
 * a logarithm-shaped soft knee rather than a clip, so it keeps rising and two
 * very easy sessions never converge on the same number. The taper is the
 * honest statement "beyond here I am guessing", and `confidence` falls away
 * over the same range to say so out loud.
 */
export const EFFORT_CREDIT_MEASURED_TO = 1.5;
export const EFFORT_CREDIT_TAPER = 0.4;

/**
 * The same knee for the drag-limited sports, and it has to be much lower.
 *
 * Not because the physics is shakier — the cube law is better grounded than
 * anything running has — but because of what a percent of time is WORTH on
 * these anchor tables. Rowing's whole 125-to-925 band spans 214 seconds
 * against running's 1,920, so erg pace compresses a given physiological range
 * into a narrow band of time and a few percent moves hundreds of points. A
 * 40-minute row at 2:08/500 m sits near the median raw; with running's knee
 * and a low heart rate it came out at 955, past the 99th-percentile anchor,
 * off a steady aerobic piece. There is a regression test pinning exactly that
 * (cardio-benchmarks-row.test.ts) because it has happened before.
 *
 * So the measured range here is short and the taper tight. It is a real
 * asymmetry and worth naming rather than hiding: an easy RUN is uncapped
 * through everything Daniels measured, and an easy ROW is not, because one
 * of those two tables can absorb the credit and the other cannot.
 */
const DRAG_LIMITED_CREDIT_MEASURED_TO = 1.15;
const DRAG_LIMITED_CREDIT_TAPER = 0.25;

/**
 * How an intensity gap converts into a pace gap.
 *
 * Time credit is `intensityRatio^(1/exponent)`, so a LARGER exponent means a
 * given gap in effort buys LESS pace.
 *
 * ## The ergs, the pool and the bike: a flat 3, and this one is physics
 *
 * On a rowing or ski erg, and for anything drag-limited at speed (cycling,
 * swimming), power goes as the cube of velocity — Concept2's own machines
 * compute pace from power exactly that way. Metabolic intensity is close to
 * linear in POWER, so a 20% increase in intensity is a 20% increase in power
 * and therefore only a 6.3% increase in speed. The cube law does not care how
 * far below maximal the effort was, so this one does not vary.
 *
 * Getting it wrong is not a rounding error. Scoring an erg with running's
 * conversion credited a 6,000 m row at 1:56/500 m and 160 bpm with a 6:13 2 k
 * — faster than the 99th-percentile anchor, off a steady piece. The previous
 * engine capped that in index points instead, which bounded the damage and
 * left the model wrong; the cube root removes the need for the cap.
 *
 * ## Running and walking: 2.2 falling to 1.3 as the gap widens
 *
 * There is no clean physical constant here, and the honest description is an
 * empirical curve rather than a number.
 *
 * The textbook chain (%HRR ≈ %VO2R, ACSM's VO2 = 0.2v + 3.5) makes speed
 * exactly proportional to intensity — an exponent of 1 — and that
 * over-credits, for two reasons it cannot see: a 5 k is run partly above the
 * intensity the aerobic system alone sustains, and an easy run's heart rate
 * drifts upward relative to its true metabolic cost.
 *
 * Daniels' VDOT table, which maps training paces to intensities empirically,
 * does not imply one exponent either. Read against 5 k pace it gives:
 *
 *     threshold   gap 1.13   exponent 1.90
 *     marathon    gap 1.22   exponent 1.66
 *     easy        gap 1.46   exponent 1.30
 *
 * The exponent FALLS as the gap widens — easing off buys proportionally more
 * pace the further below race intensity you already are. A single constant
 * therefore has to be wrong at one end or the other, and the flat 2.2 this
 * replaced was wrong at the easy end, where most sessions live: it
 * under-credited exactly the runs an athlete does most of.
 *
 * So the exponent now rides that curve, held flat at 2.2 until the gap
 * reaches 1.15 and easing to 1.30 by 1.55. Two properties follow, and both
 * are what the athlete asked for after seeing their own scores:
 *
 *  - easy runs score higher, because they sit in the part of the curve the
 *    flat value mispriced;
 *  - easy runs score closer together, because the widest gaps gain the most,
 *    which pulls the slow end of a session log up toward the quick end. That
 *    matters because easy pace is not one pace — people run easy anywhere
 *    between 4:00 and 7:00 per kilometre — and a model that reads every
 *    second of that spread as fitness over-reads it.
 *
 * Held flat below 1.15 deliberately: a tempo or threshold effort sits there,
 * Daniels puts the exponent near 1.9-2.2 for it, and this athlete's own
 * validated tempo (6 km at 4:06 and 178 bpm, which they said should imply
 * 3:50-3:55/km) is the one real data point in the repo. Letting the easy-end
 * correction leak into it would spend that evidence to fix a different
 * problem.
 *
 * 1.30 is the floor because it is Daniels' widest measured gap. Past it there
 * is no data, and extrapolating a steeper curve into the part of the range
 * where a light jog lives would credit a recovery shuffle with a race time.
 */
const RUN_EXPONENT_AT_RACE_PACE = 2.2;
const RUN_EXPONENT_AT_EASY_PACE = 1.3;
const RUN_EXPONENT_GAP_FLAT_UNTIL = 1.0;
const RUN_EXPONENT_GAP_FLOOR_FROM = 1.55;

const GAP_EXPONENT_SPORTS = new Set<BenchmarkSport>(["run", "walk"]);
const DRAG_LIMITED_EXPONENT = 3;

/** Smooth 0->1 ramp with zero slope at both ends, so nothing kinks at a boundary. */
function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The exponent for this sport at this intensity gap. `rawRatio` is
 * maximal-intensity-for-this-duration / observed-intensity, so 1 means the
 * session WAS maximal and larger means easier.
 */
export function effortTimeExponent(sport: BenchmarkSport, rawRatio: number): number {
  if (!GAP_EXPONENT_SPORTS.has(sport)) return DRAG_LIMITED_EXPONENT;
  const ease = smoothstep(rawRatio, RUN_EXPONENT_GAP_FLAT_UNTIL, RUN_EXPONENT_GAP_FLOOR_FROM);
  return RUN_EXPONENT_AT_RACE_PACE - (RUN_EXPONENT_AT_RACE_PACE - RUN_EXPONENT_AT_EASY_PACE) * ease;
}
const MIN_EFFORT_FRACTION = 0.3;
const MAX_EFFORT_FRACTION = 1.05;

export type EffortSource = "hr" | "rpe" | "none";

/** %HRR for this session, clamped to the range the model is meaningful over. */
export function effortFractionFromHeartRate(
  avgHR: number | null | undefined,
  restingHR: number,
  maxHR: number
): number | null {
  if (!avgHR || avgHR <= 0 || !(maxHR > restingHR) || restingHR <= 0) return null;
  return clamp((avgHR - restingHR) / (maxHR - restingHR), MIN_EFFORT_FRACTION, MAX_EFFORT_FRACTION);
}

/**
 * RPE (1–10) as an effort fraction, for sessions with no heart rate. Anchored
 * at RPE 10 = maximal and RPE 5 = a steady, conversational effort (~72% HRR,
 * the middle of zone 2). Deliberately a straight line: RPE is coarse
 * self-report and a fancier curve would only dress that up.
 */
export function effortFractionFromRpe(rpe: number | null | undefined): number | null {
  if (rpe == null || !Number.isFinite(rpe) || rpe < 1 || rpe > 10) return null;
  return clamp(0.45 + 0.055 * rpe, MIN_EFFORT_FRACTION, 1);
}

/**
 * How much faster a maximal effort would have been than this one, as a
 * time divisor (≥ 1). Sub-maximal effort earns credit; an effort at or above
 * the benchmark intensity earns none and is never penalised — an all-out 5K
 * averages well below true max heart rate because HR ramps over minutes, so
 * a high reading on a hard session is not wasted reserve, it is the effort.
 *
 * The intensity gap is saturated first and converted to time second, in that
 * order, so the asymptote means the same thing in every sport (a cap on how
 * much extra intensity may be imputed) rather than a different amount of
 * pace on each curve.
 */
export function effortTimeRatio(
  observedFraction: number,
  benchmarkFraction: number,
  sport: BenchmarkSport
): number {
  if (!(observedFraction > 0)) return 1;
  const raw = benchmarkFraction / observedFraction;
  if (raw <= 1) return 1;
  const dragLimited = !GAP_EXPONENT_SPORTS.has(sport);
  const knee = dragLimited ? DRAG_LIMITED_CREDIT_MEASURED_TO : EFFORT_CREDIT_MEASURED_TO;
  const taper = dragLimited ? DRAG_LIMITED_CREDIT_TAPER : EFFORT_CREDIT_TAPER;
  const creditedIntensity =
    raw <= knee ? raw : knee + taper * Math.tanh((raw - knee) / taper);
  return Math.pow(creditedIntensity, 1 / effortTimeExponent(sport, raw));
}

/**
 * How far the effort credit had to extrapolate, as a confidence multiplier.
 * Reading a maximal pace off a 60% HRR jog is a longer reach than off an 85%
 * tempo, and the score should say so rather than present both with equal
 * certainty. 1 at or under a 10% reach, easing to 0.6 by a 50% reach.
 */
export function effortExtrapolationConfidence(observedFraction: number, benchmarkFraction: number): number {
  if (!(observedFraction > 0)) return 1;
  const raw = benchmarkFraction / observedFraction;
  if (raw <= 1.1) return 1;
  return clamp(1 - (raw - 1.1) * 1.0, 0.6, 1);
}

export interface EffortReading {
  fraction: number | null;
  source: EffortSource;
}

/** The effort signal to scale by: heart rate when present, RPE otherwise, nothing for walking. */
export function resolveEffort(
  sport: BenchmarkSport,
  avgHR: number | null | undefined,
  rpe: number | null | undefined,
  restingHR: number | null | undefined,
  maxHR: number | null | undefined
): EffortReading {
  if (!EFFORT_SCALED_SPORTS.has(sport)) return { fraction: null, source: "none" };
  if (restingHR && maxHR) {
    const fromHr = effortFractionFromHeartRate(avgHR, restingHR, maxHR);
    if (fromHr !== null) return { fraction: fromHr, source: "hr" };
  }
  const fromRpe = effortFractionFromRpe(rpe);
  if (fromRpe !== null) return { fraction: fromRpe, source: "rpe" };
  return { fraction: null, source: "none" };
}

// ---------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------

export interface FitnessEquivalentInput {
  sport: BenchmarkSport;
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  rpe?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
  bodyweightKg?: number | null;
  sex: "male" | "female";
  restingHR?: number | null;
  maxHR?: number | null;
  riegelK?: number | null;
}

export interface FitnessEquivalent {
  /** Raw Riegel projection (or walk pace) before any adjustment. */
  projectedSeconds: number;
  /** The intensity a maximal effort of THIS session's length is held at — the bar its heart rate was judged against. */
  benchmarkEffortFraction: number;
  /** What this session implies for a maximal, flat, comfortable-weather benchmark effort. */
  equivalentSeconds: number;
  effort: EffortReading;
  /** Time divisor from effort — 1 when no credit applied. */
  effortRatio: number;
  elevationFraction: number;
  temperatureFraction: number;
  bodyweightFactor: number;
  /** 0–1: how much of the equivalent rests on extrapolation rather than the clock. */
  confidence: number;
}

export function computeFitnessEquivalent(input: FitnessEquivalentInput): FitnessEquivalent | null {
  const projected = projectToBenchmarkSeconds(
    input.sport,
    input.distanceMeters,
    input.durationSeconds,
    input.riegelK ?? undefined
  );
  if (projected === null) return null;

  const elevationFraction = elevationTimeFraction(input.sport, input.elevationMeters, input.distanceMeters);
  const temperatureFraction = temperatureTimeFraction(input.sport, input.temperatureCelsius);
  const bodyweightFactor = bodyweightTimeFactor(input.sport, input.bodyweightKg, input.sex);
  const effort = resolveEffort(input.sport, input.avgHR, input.rpe, input.restingHR, input.maxHR);

  // Not the benchmark's own intensity — the intensity a maximal effort of
  // THIS session's length is held at. See maxIntensityForDuration.
  const benchmarkFraction = maxIntensityForDuration(input.sport, input.durationSeconds);
  const effortRatio =
    effort.fraction !== null
      ? effortTimeRatio(effort.fraction, benchmarkFraction, input.sport)
      : 1;

  let confidence = 1;
  if (effort.fraction !== null) {
    confidence *= effortExtrapolationConfidence(effort.fraction, benchmarkFraction);
    if (effort.source === "rpe") confidence *= 0.85;
  }

  const equivalentSeconds =
    (projected * (1 - elevationFraction) * (1 - temperatureFraction) * bodyweightFactor) / effortRatio;

  return {
    projectedSeconds: projected,
    benchmarkEffortFraction: benchmarkFraction,
    equivalentSeconds,
    effort,
    effortRatio,
    elevationFraction,
    temperatureFraction,
    bodyweightFactor,
    confidence,
  };
}
