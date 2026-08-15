/**
 * Split Index — isometric holds and loaded carries
 * ------------------------------------------------
 * Scores the movements that have no reps to count: timed holds (planks) and
 * loaded carries (farmer's/suitcase carries, sled push/pull). These are
 * logged with `duration_seconds` / `distance_meters` on the set (the
 * `gym_exercises.reps NOT NULL CHECK (reps > 0)` column forces a placeholder
 * `reps: 1`, `weight_kg: 0` on a bodyweight hold — the real measurement rides
 * in the `set_details` JSONB).
 *
 * WHY THIS EXISTS — what the main engine did with them before:
 *   - Plank, 60 s, bodyweight  -> `scoreStrength` saw weight 0 / reps 1,
 *     estimated a 0 kg 1RM, returned the floor score of 1 and was then
 *     dropped from `labIndex` by its `oneRM > 0` filter. A core-only session
 *     therefore scored a Lab Index of **1**.
 *   - Sled Push, 100 kg, any distance -> read as a 100 kg ONE-REP MAX,
 *     scoring **979** ("World Class", past NEAR_RECORD_THRESHOLD). Pushing a
 *     sled five metres out-scored every real lift in the catalogue.
 * Both directions are wrong, and the second one is an exploit.
 *
 * HOW HONEST IS THE SCALE? Be blunt about this, because the numbers look as
 * precise as the barbell ones and they are not:
 *   - The plank anchor (120 s ~ 500) is the one number here with a real
 *     reference behind it: McGill's published torso-endurance norms put a
 *     healthy young adult's prone hold at roughly two minutes (and the side
 *     bridge near 90 s), which is the closest thing to a population median
 *     that exists for a hold. Everything derived from it — the slope, the
 *     load exponent, the credit cap — is reasoned, not fitted.
 *   - The carry anchors are a REASONED GUESS. There is no Strength Level /
 *     OpenPowerlifting equivalent for carries. 0.75x bodyweight of total
 *     carried load over 30 m as the 500-point anchor is interpolated down
 *     from the widely-quoted "farmer's walk your bodyweight" goal (Dan John),
 *     on the argument that a published *goal* sits above a population median.
 *     The sled anchor is that carry anchor divided by a sled friction
 *     coefficient (mu ~= 0.55 on turf) — physics-motivated, not measured.
 *   - Consequently every result from this module is `source: "generic"` and
 *     carries `estimated-generic-standard`, exactly like an uncatalogued
 *     lift falling through to DEFAULT_GENERIC_ANCHOR, and the whole family is
 *     capped (see ACCESSORY_METRIC_MAX_SCORE). We would rather under-claim
 *     than print a confident-looking number we cannot defend.
 */

import {
  SEX_FACTORS,
  ageFactor,
  normalizeName,
  tierForScore,
  type ScoreStrengthResult,
  type Sex,
} from "@/lib/scoring/split-strength-engine";

/** What an exercise is actually counted in, once the set data has been seen. */
export type TrackedMetric = "reps" | "hold" | "carry";

/** Just enough of a set to tell what it was measured in — see resolveTrackedMetric. */
export interface MeasuredSetProbe {
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

/** A logged set as this module needs it — the measurement, not the placeholder reps. */
export interface AccessoryMetricSet extends MeasuredSetProbe {
  /**
   * Load in the exercise's anchor convention: added load on top of bodyweight
   * for a hold, total carried/sled load for a carry (resolveScoringWeight has
   * already normalized per-hand entry by the time this is called).
   */
  weightKg: number;
}

export interface AccessoryMetricInput {
  /** Exercise name as logged. */
  liftKey: string;
  sets: AccessoryMetricSet[];
  bodyweightKg: number;
  sex: Sex;
  age: number | null;
}

// ---------------------------------------------------------------------------
// Constants — kept named, editable, and separate from the logic.
// ---------------------------------------------------------------------------

const MIN_SCORE = 1;

/**
 * Ceiling for ANY hold/carry result, and the single most important number in
 * this file. It sits deliberately below the Advanced tier threshold (725) in
 * split-strength-engine's TIER_THRESHOLDS.
 *
 * Two reasons, both worth keeping:
 *  1. Anti-exploit. A 30-minute plank must not out-score a heavy squat
 *     session. A calibrated squat/bench/deadlift can reach 850-950; nothing
 *     in this file can pass 700, so the ordering holds by construction rather
 *     than by hoping the curves happen to stay apart.
 *  2. Honesty. These anchors are estimates (see the file header). Certifying
 *     someone "Elite" off a movement with no population data behind it would
 *     be inventing precision we do not have. Upper Semi-Pro is as far as this
 *     evidence reaches.
 */
export const ACCESSORY_METRIC_MAX_SCORE = 700;

/**
 * Index points per unit of ln(hold time / anchor time). Deliberately about
 * half the strength engine's SLOPE (380 per ln of a LOAD ratio): hold time is
 * a weaker discriminator of strength than load — past the first couple of
 * minutes a plank increasingly measures discomfort tolerance and positional
 * drift — so the same proportional improvement is worth fewer points.
 */
const HOLD_SLOPE = 200;

/**
 * Hold time stops earning credit at five minutes. This is the honest version
 * of "a 30-minute plank is not a 30-minute-plank's worth of core strength":
 * the standard coaching position (McGill's included) is that once a hold runs
 * past a couple of minutes the correct progression is added load or a harder
 * lever, not more seconds. Past this point the score is flat — extra minutes
 * are recorded, they just do not move the number.
 */
const HOLD_DURATION_CREDIT_CAP_SECONDS = 300;

/**
 * How much harder added load makes a hold, as an exponent on the load
 * multiplier before it is turned into equivalent seconds. Isometric endurance
 * falls away much faster than linearly as the fraction of maximal force rises
 * (Rohmert's curve), so load is worth more than a proportional amount of
 * time: at 2.0, a load multiplier of 1.4x (20 kg on an 80 kg athlete's plank)
 * roughly doubles the credited hold. An approximation of the shape of that
 * relationship, not a fit to it.
 */
const HOLD_LOAD_EXPONENT = 2;

/** Index points per unit of ln(load ratio / anchor ratio) — matched to the strength engine's SLOPE, because this term IS a bodyweight load ratio, the same quantity that slope was calibrated against. */
const CARRY_SLOPE = 380;

/** The distance the carry anchors are defined at. */
const CARRY_ANCHOR_DISTANCE_METERS = 30;

/**
 * Distance counts, but at a discount: a carry is scored primarily on what is
 * in your hands. Doubling the load doubles the ln-term; doubling the distance
 * moves it half as much. Walking a long way with a light load is conditioning
 * and belongs on the cardio side of the index, not this one.
 */
const CARRY_DISTANCE_EXPONENT = 0.5;

/**
 * Same argument as HOLD_DURATION_CREDIT_CAP_SECONDS. Set at twice the anchor
 * distance, which caps the total distance bonus at about +130 points: with a
 * 100 m cap instead, a pair of 20 kg dumbbells walked 400 m scored 575 —
 * above the anchor, for what is a light-load walk. Past 60 m a carry is
 * endurance work, and endurance work is scored on the other side of the
 * Split Index.
 */
const CARRY_DISTANCE_CREDIT_CAP_METERS = 60;

/**
 * Confidence attached to every result here. The MEASUREMENT is direct (a
 * stopwatch reading, not a 1RM extrapolated from a sub-maximal set), but the
 * STANDARD it is judged against is an estimate — which is the thing
 * confidence feeds into downstream (index-engine weights sessions by it). 0.5
 * matches what the main engine gives a high-rep, formula-derived 1RM.
 */
const ACCESSORY_METRIC_CONFIDENCE = 0.5;

interface HoldAnchor {
  /** Hold time (s) that scores 500 at bodyweight for a male athlete aged 20-35. */
  anchorSeconds: number;
  /**
   * Fraction of bodyweight actually supported by the working muscles, used to
   * turn added kilos into a load multiplier. 0.64 for the prone plank is the
   * same four-point-stance estimate the main engine already uses for push-ups
   * (BODYWEIGHT_FRACTIONS); the side plank's two-point stance carries more of
   * the body through the down-side shoulder and hip, but over a smaller base,
   * and 0.55 is a deliberately conservative read of that.
   */
  bodyweightFraction: number;
}

const HOLD_ANCHORS: Record<string, HoldAnchor> = {
  // McGill's torso-endurance norms for healthy young adults: prone hold
  // ~2 min. Weighted and unweighted planks share one anchor on purpose —
  // same movement, and the added load is already handled by the load
  // multiplier (identical reasoning to the weighted/unweighted calisthenic
  // twins in split-strength-engine's PRIMARY_ANCHORS).
  plank: { anchorSeconds: 120, bodyweightFraction: 0.64 },
  sidePlank: { anchorSeconds: 90, bodyweightFraction: 0.55 },
};

/** Unknown timed movements are scored as a plank — the same "degrade to a defensible generic" precedent as DEFAULT_GENERIC_ANCHOR. */
const DEFAULT_HOLD_ANCHOR: HoldAnchor = HOLD_ANCHORS.plank;

interface CarryAnchor {
  /** Total load / bodyweight that scores 500 over CARRY_ANCHOR_DISTANCE_METERS, for a male athlete aged 20-35. */
  anchorLoadRatio: number;
  /** Female standard as a fraction of the male anchor — reuses the main engine's SEX_FACTORS rather than inventing a second set. */
  sexFactor: number;
}

const CARRY_ANCHORS: Record<string, CarryAnchor> = {
  // 0.75x bodyweight of total load over 30 m == 500. See the file header for
  // where that comes from and how much to trust it.
  farmersCarry: { anchorLoadRatio: 0.75, sexFactor: SEX_FACTORS.pull },
  // One implement, one side. The load is half a farmer's carry but the
  // anti-lateral-flexion demand on the trunk is what makes it hard, so the
  // anchor is half the two-sided one: 0.375x bodyweight in ONE hand scores
  // the same as 0.75x split across two.
  suitcaseCarry: { anchorLoadRatio: 0.375, sexFactor: SEX_FACTORS.pull },
  // A sled is dragged against friction, not carried against gravity: on turf
  // only roughly mu ~= 0.55 of its mass resists you. Loading 100 kg on a sled
  // is therefore not the same demand as carrying 100 kg, and the anchor is
  // the carry anchor divided by that coefficient (0.75 / 0.55 ~= 1.36).
  // KNOWN GAP: athletes usually log the PLATES, not plates + the sled's own
  // 30-90 kg frame, so this reads slightly low for them.
  sledPush: { anchorLoadRatio: 1.36, sexFactor: SEX_FACTORS.lowerBody },
  sledPull: { anchorLoadRatio: 1.36, sexFactor: SEX_FACTORS.lowerBody },
};

const DEFAULT_CARRY_ANCHOR: CarryAnchor = CARRY_ANCHORS.farmersCarry;

const HOLD_ALIASES: Record<string, string> = {
  plank: "plank",
  "weighted plank": "plank",
  "front plank": "plank",
  "forearm plank": "plank",
  "high plank": "plank",
  "plank hold": "plank",
  "side plank": "sidePlank",
  "weighted side plank": "sidePlank",
  "side bridge": "sidePlank",
};

const CARRY_ALIASES: Record<string, string> = {
  "farmer's carry": "farmersCarry",
  "farmers carry": "farmersCarry",
  "farmer carry": "farmersCarry",
  "farmer's walk": "farmersCarry",
  "farmers walk": "farmersCarry",
  "suitcase carry": "suitcaseCarry",
  "single arm carry": "suitcaseCarry",
  "sled push": "sledPush",
  "sled pull": "sledPull",
  "sled drag": "sledPull",
  "prowler push": "sledPush",
};

/**
 * Time-under-tension to rep equivalence, used ONLY to give these sessions a
 * non-zero training load (the legacy volume metric is weight x reps, which is
 * identically 0 for a bodyweight hold, so a hard core session currently
 * reports no training load at all and never touches ACWR/fatigue).
 *
 * A dynamic rep is ~3-5 s of tension, but a hold accumulates its seconds at a
 * far lower fraction of maximal force, so counting a notional rep every 10 s
 * (rather than every 5) is the conservative read: at 5 s, a five-minute plank
 * came out at four times the training load of a heavy 140 kg x 5 squat set,
 * which nobody would defend. Both constants are estimates whose only consumer
 * is load/fatigue accounting, never the index itself.
 */
const HOLD_SECONDS_PER_EQUIVALENT_REP = 10;
const CARRY_METERS_PER_EQUIVALENT_REP = 10;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Which metric an exercise is scored on.
 *
 * The catalogue (`getExerciseTracking` in lib/constants/sports.ts) is the
 * primary source, passed in by the caller so this module stays free of the
 * constants layer. The set payload is the fallback: a CUSTOM exercise name
 * ("Copenhagen Hold") is not in the catalogue but still arrives with
 * duration/distance filled in, and scoring it as a 0 kg single rep is exactly
 * the bug this file exists to fix.
 */
export function resolveTrackedMetric(
  catalogTracking: "reps" | "time" | "distance",
  sets: MeasuredSetProbe[]
): TrackedMetric {
  if (catalogTracking === "time") return "hold";
  if (catalogTracking === "distance") return "carry";
  if (sets.some((s) => isPositive(s.durationSeconds))) return "hold";
  if (sets.some((s) => isPositive(s.distanceMeters))) return "carry";
  return "reps";
}

function resolveHoldAnchor(liftKey: string): { anchor: HoldAnchor; resolvedKey: string } {
  const key = normalizeName(liftKey);
  const aliased = HOLD_ALIASES[key];
  if (aliased && HOLD_ANCHORS[aliased]) {
    return { anchor: HOLD_ANCHORS[aliased], resolvedKey: aliased };
  }
  return { anchor: DEFAULT_HOLD_ANCHOR, resolvedKey: key };
}

function resolveCarryAnchor(liftKey: string): { anchor: CarryAnchor; resolvedKey: string } {
  const key = normalizeName(liftKey);
  const aliased = CARRY_ALIASES[key];
  if (aliased && CARRY_ANCHORS[aliased]) {
    return { anchor: CARRY_ANCHORS[aliased], resolvedKey: aliased };
  }
  return { anchor: DEFAULT_CARRY_ANCHOR, resolvedKey: key };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Marker flags — the caller distinguishes these results from rep-based ones by them. */
export const HOLD_FLAG = "isometric-hold";
export const CARRY_FLAG = "loaded-carry";
/** Set on a hold/carry whose duration/distance never reached the scorer, so it could not be scored at all. */
export const UNMEASURED_FLAG = "hold-carry-measurement-missing";

/** True for any result produced by this module (scored or not). */
export function isAccessoryMetricResult(result: ScoreStrengthResult): boolean {
  return result.flags.includes(HOLD_FLAG) || result.flags.includes(CARRY_FLAG);
}

/** True when the result carries a real, scored measurement (i.e. is safe to aggregate). */
export function isScoredAccessoryMetricResult(result: ScoreStrengthResult): boolean {
  return isAccessoryMetricResult(result) && !result.flags.includes(UNMEASURED_FLAG);
}

function unscorable(
  resolvedKey: string,
  metricFlag: string,
  reason: string
): ScoreStrengthResult {
  return {
    liftKey: resolvedKey,
    score: 0,
    tier: "Beginner",
    oneRM: 0,
    oneRMConfidence: 0,
    bodyweightRatio: 0,
    source: "generic",
    appliedFactors: [],
    nextTier: null,
    flags: [metricFlag, UNMEASURED_FLAG, reason],
    oneRMBandKg: null,
    trend: null,
    suggestion:
      metricFlag === HOLD_FLAG
        ? "Log how long you held it — a plank is scored on time under load, not reps."
        : "Log how far you carried it — a carry is scored on load and distance, not reps.",
  };
}

/**
 * A timed hold: score = 500 + HOLD_SLOPE x ln(equivalent seconds / anchor
 * seconds), where "equivalent seconds" is the credited hold time scaled by
 * how much extra load was on the athlete.
 *
 * No sex factor is applied. Unlike a barbell lift, the load in a hold IS the
 * athlete's own bodyweight, so the demand already self-normalizes, and the
 * published isometric-endurance norms differ far less between sexes than the
 * maximal-strength standards SEX_FACTORS is built from. Applying a 15-27%
 * adjustment here would be borrowing calibration from a different quantity.
 * The age curve IS applied, on the same "beta" footing as everywhere else.
 */
export function scoreTimedHold(input: AccessoryMetricInput): ScoreStrengthResult {
  const { anchor, resolvedKey } = resolveHoldAnchor(input.liftKey);
  const { bodyweightKg, age } = input;

  const usable = input.sets.filter((s) => isPositive(s.durationSeconds));
  if (usable.length === 0 || bodyweightKg <= 0) {
    return unscorable(resolvedKey, HOLD_FLAG, "no-valid-set");
  }

  const flags: string[] = [HOLD_FLAG, "estimated-generic-standard"];
  const appliedFactors: string[] = [];

  let effectiveAnchorSeconds = anchor.anchorSeconds;
  if (age != null && age > 35) {
    const factor = ageFactor(age);
    effectiveAnchorSeconds /= factor;
    appliedFactors.push(`age:${age} x${factor.toFixed(3)} standard (beta)`);
    flags.push("age-factor-beta");
  }

  const supportedKg = bodyweightKg * anchor.bodyweightFraction;

  // Peak effort, not total volume — the same "best set represents the
  // exercise" convention the rep-based path uses (bestSet in
  // lib/activities/gym-sets.ts). Three 60 s planks are not scored as one
  // 180 s plank, because they are not one.
  let best: {
    score: number;
    durationSeconds: number;
    addedKg: number;
    loadMultiplier: number;
    credited: number;
  } | null = null;

  for (const set of usable) {
    const durationSeconds = set.durationSeconds as number;
    const addedKg = Math.max(0, set.weightKg);
    const loadMultiplier = (supportedKg + addedKg) / supportedKg;
    const credited = Math.min(durationSeconds, HOLD_DURATION_CREDIT_CAP_SECONDS);
    const equivalentSeconds = credited * loadMultiplier ** HOLD_LOAD_EXPONENT;
    const raw = 500 + HOLD_SLOPE * Math.log(equivalentSeconds / effectiveAnchorSeconds);
    const score = clamp(Math.round(raw), MIN_SCORE, ACCESSORY_METRIC_MAX_SCORE);
    if (!best || score > best.score) {
      best = { score, durationSeconds, addedKg, loadMultiplier, credited };
    }
  }

  const chosen = best!;
  if (chosen.durationSeconds > HOLD_DURATION_CREDIT_CAP_SECONDS) {
    flags.push("hold-duration-credit-capped");
  }
  if (chosen.score >= ACCESSORY_METRIC_MAX_SCORE) {
    flags.push("accessory-metric-capped");
  }
  if (chosen.loadMultiplier > 1) {
    appliedFactors.push(`added load:${round1(chosen.addedKg)}kg x${round2(chosen.loadMultiplier)} on ${round1(supportedKg)}kg supported`);
  }

  return {
    liftKey: resolvedKey,
    score: chosen.score,
    tier: tierForScore(chosen.score),
    // No 1RM exists for a hold, and inventing one would put a fictional
    // number into strength_scores.estimated_1rm_kg (and into personal
    // records, which filter on it being > 0). 0 means "not applicable".
    oneRM: 0,
    oneRMConfidence: ACCESSORY_METRIC_CONFIDENCE,
    // Total load supported relative to bodyweight — the honest analogue of
    // the rep-based path's 1RM/bodyweight ratio.
    bodyweightRatio: round2((supportedKg + chosen.addedKg) / bodyweightKg),
    source: "generic",
    appliedFactors,
    nextTier: null,
    flags,
    oneRMBandKg: null,
    trend: null,
    suggestion:
      chosen.durationSeconds > HOLD_DURATION_CREDIT_CAP_SECONDS
        ? "Past five minutes a hold stops measuring core strength — add load instead of time."
        : null,
  };
}

/**
 * A loaded carry: score = 500 + CARRY_SLOPE x [ln(load ratio / anchor ratio)
 * + CARRY_DISTANCE_EXPONENT x ln(credited distance / anchor distance)].
 *
 * Load dominates, distance discounts, both saturate. A carry with no load is
 * a walk and is not scored here at all.
 */
export function scoreLoadedCarry(input: AccessoryMetricInput): ScoreStrengthResult {
  const { anchor, resolvedKey } = resolveCarryAnchor(input.liftKey);
  const { bodyweightKg, sex, age } = input;

  const usable = input.sets.filter(
    (s) => isPositive(s.distanceMeters) && isPositive(s.weightKg)
  );
  if (usable.length === 0 || bodyweightKg <= 0) {
    return unscorable(resolvedKey, CARRY_FLAG, "no-valid-set");
  }

  const flags: string[] = [CARRY_FLAG, "estimated-generic-standard"];
  const appliedFactors: string[] = [];

  let effectiveAnchorRatio = anchor.anchorLoadRatio;
  if (sex === "female") {
    effectiveAnchorRatio *= anchor.sexFactor;
    appliedFactors.push(`sex:female x${anchor.sexFactor} standard (beta)`);
    flags.push("sex-factor-beta");
    flags.push("female-strength-beta");
  }
  if (age != null && age > 35) {
    const factor = ageFactor(age);
    effectiveAnchorRatio /= factor;
    appliedFactors.push(`age:${age} x${factor.toFixed(3)} standard (beta)`);
    flags.push("age-factor-beta");
  }

  let best: {
    score: number;
    distanceMeters: number;
    loadKg: number;
    loadRatio: number;
  } | null = null;

  for (const set of usable) {
    const distanceMeters = set.distanceMeters as number;
    const loadKg = set.weightKg;
    const loadRatio = loadKg / bodyweightKg;
    const credited = Math.min(distanceMeters, CARRY_DISTANCE_CREDIT_CAP_METERS);
    const raw =
      500 +
      CARRY_SLOPE *
        (Math.log(loadRatio / effectiveAnchorRatio) +
          CARRY_DISTANCE_EXPONENT * Math.log(credited / CARRY_ANCHOR_DISTANCE_METERS));
    const score = clamp(Math.round(raw), MIN_SCORE, ACCESSORY_METRIC_MAX_SCORE);
    if (!best || score > best.score) {
      best = { score, distanceMeters, loadKg, loadRatio };
    }
  }

  const chosen = best!;
  if (chosen.distanceMeters > CARRY_DISTANCE_CREDIT_CAP_METERS) {
    flags.push("carry-distance-credit-capped");
  }
  if (chosen.score >= ACCESSORY_METRIC_MAX_SCORE) {
    flags.push("accessory-metric-capped");
  }
  appliedFactors.push(
    `carry:${round1(chosen.loadKg)}kg over ${round1(chosen.distanceMeters)}m`
  );

  return {
    liftKey: resolvedKey,
    score: chosen.score,
    tier: tierForScore(chosen.score),
    oneRM: 0,
    oneRMConfidence: ACCESSORY_METRIC_CONFIDENCE,
    bodyweightRatio: round2(chosen.loadRatio),
    source: "generic",
    appliedFactors,
    nextTier: null,
    flags,
    oneRMBandKg: null,
    trend: null,
    suggestion:
      chosen.distanceMeters > CARRY_DISTANCE_CREDIT_CAP_METERS
        ? "Past 100 m a carry is scored as conditioning — add load rather than distance to move your strength number."
        : null,
  };
}

/** Dispatch on the resolved metric. `reps` is not this module's business and throws rather than silently mis-scoring. */
export function scoreAccessoryMetric(
  metric: Exclude<TrackedMetric, "reps">,
  input: AccessoryMetricInput
): ScoreStrengthResult {
  return metric === "hold" ? scoreTimedHold(input) : scoreLoadedCarry(input);
}

/**
 * Headline index for a session made up ONLY of holds/carries — the mirror of
 * `labIndex`, minus its `oneRM > 0` filter (which by design excludes
 * everything here, since a hold has no 1RM).
 *
 * Weighted by confidence alone: every result here is `source: "generic"`, so
 * labIndex's source ladder would apply the same 0.45 to all of them and
 * cancel out.
 */
export function accessoryMetricIndex(results: ScoreStrengthResult[]): number {
  const scored = results.filter(isScoredAccessoryMetricResult);
  if (scored.length === 0) return MIN_SCORE;

  const weightFor = (r: ScoreStrengthResult) => 0.5 + r.oneRMConfidence * 0.5;
  const totalWeight = scored.reduce((sum, r) => sum + weightFor(r), 0);
  const weightedSum = scored.reduce((sum, r) => sum + r.score * weightFor(r), 0);
  return clamp(
    Math.round(weightedSum / totalWeight),
    MIN_SCORE,
    ACCESSORY_METRIC_MAX_SCORE
  );
}

/**
 * Volume-equivalent (kg) for training-load accounting, so a hard core or
 * carry session is not recorded as zero training load. Summed across ALL
 * sets (unlike the index, which takes the best set) because load is a volume
 * measure. See HOLD_SECONDS_PER_EQUIVALENT_REP for how rough this is.
 */
export function accessoryMetricVolumeEquivalentKg(
  metric: Exclude<TrackedMetric, "reps">,
  sets: AccessoryMetricSet[],
  bodyweightKg: number,
  liftKey: string
): number {
  if (metric === "hold") {
    const { anchor } = resolveHoldAnchor(liftKey);
    const supportedKg = Math.max(0, bodyweightKg) * anchor.bodyweightFraction;
    return sets.reduce((sum, s) => {
      if (!isPositive(s.durationSeconds)) return sum;
      const load = supportedKg + Math.max(0, s.weightKg);
      return sum + (load * s.durationSeconds) / HOLD_SECONDS_PER_EQUIVALENT_REP;
    }, 0);
  }
  return sets.reduce((sum, s) => {
    if (!isPositive(s.distanceMeters) || !isPositive(s.weightKg)) return sum;
    return sum + (s.weightKg * s.distanceMeters) / CARRY_METERS_PER_EQUIVALENT_REP;
  }, 0);
}
