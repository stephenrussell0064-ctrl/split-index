/**
 * Split Index — Strength Engine ("split-strength-engine")
 * ---------------------------------------------------------
 * Single entry point for scoring any logged strength set: `scoreStrength()`.
 * Per-exercise, 0–1000 ("Split Relative Index"), calibrated against real
 * lifter data rather than a flat category multiplier — a shoulder-isolation
 * lateral raise and a machine-supported pec deck are fundamentally different
 * movements and are scored on different curves, not the same one.
 *
 * Model: score = 500 + SLOPE × ln(bodyweight-adjusted ratio / effective anchor).
 * Each lift has its own calibrated `anchorRatio` — the 1RM/bodyweight ratio
 * (at REFERENCE_BODYWEIGHT_KG) that scores exactly 500. Sex and age don't
 * change the athlete's ratio; they adjust the *anchor* they're judged
 * against, which is what actually reflects "age/sex-appropriate expectation"
 * rather than inflating the athlete's own number.
 *
 * History awareness: pass the FULL logged history for the lift, not just
 * the latest set — a single sub-maximal set under-reads true 1RM by ~3–14%,
 * and only a longer history lets the adaptive model express a trend and
 * blend against a real achieved peak. Both the single-set fallback and the
 * adaptive history model apply the same sub-max bias correction
 * (`subMaxBiasCorrection`) and the same blended Epley/Brzycki estimator
 * (`bestEstimate1RM`) — free tier just doesn't get the extra trend/band/
 * multi-session blending premium does. Gate premium fields at the
 * serializer (`serializeStrengthResult`), not by computing and hiding them
 * on the client.
 *
 * Bodyweight-relative lifts (`BODYWEIGHT_RELATIVE_LIFTS`: pull-ups, dips,
 * push-ups): the logged weight is *added* load, not the total load under
 * tension. 1RM is estimated from (a fraction of) bodyweight + added weight,
 * then that same bodyweight fraction is subtracted back out so the result is
 * expressed the same way it was logged. The fraction (`BODYWEIGHT_FRACTIONS`)
 * defaults to 1.0 (pull-ups/dips hang full bodyweight) but is lower for
 * push-ups, whose four-point stance loads only part of bodyweight through
 * the arms/chest.
 *
 * Honest limitations (keep visible in the UI):
 *  - Sex and age factors are estimates, not calibrated to real population
 *    data yet — mark as "beta" until real data lands (see appliedFactors).
 *  - Accessory/inherited lifts (source: "generic") carry lower confidence
 *    than the calibrated primary/accessory sets.
 *  - The sub-max bias correction (+6%) and bodyweight-relative handling are
 *    both engineering estimates, not lab-calibrated — validate against real
 *    near-max attempts as they get logged (see `nextTier`/`suggestion`).
 */

import {
  bestEstimate1RM,
  oneRMVarianceFlag,
  weightedCalisthenic1RM,
  type ExerciseClass,
} from "@/lib/scoring/strength/one-rm";
import {
  resolveScoringWeight,
  type WeightEntryMode,
} from "@/lib/scoring/weight-entry";

export type Sex = "male" | "female";

export type StrengthTier =
  | "Beginner"
  | "Intermediate"
  | "Semi-Pro"
  | "Advanced"
  | "Elite"
  | "World Class";

export type StrengthSource = "primary" | "accessory" | "generic";
export type StrengthTrend = "up" | "down" | "flat";
type BodyPart = "upperBody" | "lowerBody" | "pull";

export interface LoggedSet {
  weightKg: number;
  reps: number;
  /** ISO timestamp of the session this set was logged in. */
  performedAt: string;
  /** Reps in reserve — blank means near failure (Part B3). */
  repsInReserve?: number | null;
}

export interface ScoreStrengthInput {
  /** Exercise name as logged — resolved against the anchor tables below. */
  liftKey: string;
  /** Full logged history for this lift across all past sessions (any order). Required for the premium adaptive path. */
  history: LoggedSet[];
  /** Most recent/best set from the current session — the free-tier path scores off this alone. */
  latestSet: { weightKg: number; reps: number; repsInReserve?: number | null };
  /** User-stated 1RM for variance guard (Part B4) — optional. */
  statedOneRMKg?: number | null;
  bodyweightKg: number;
  sex: Sex;
  age: number | null;
  isPremium: boolean;
  /** When true, latestSet.weightKg is added load on top of bodyweight (dips, pull-ups). */
  isBodyweightRelative?: boolean;
  /** How weight was logged — per hand / total / added when resolving history sets. */
  weightEntryMode?: WeightEntryMode;
  /** Exercise name for convention-aware history weight resolution. */
  exerciseName?: string;
}

export interface NextTierTarget {
  tier: StrengthTier;
  kgNeeded: number;
}

export interface ScoreStrengthResult {
  liftKey: string;
  score: number;
  tier: StrengthTier;
  oneRM: number;
  oneRMConfidence: number;
  bodyweightRatio: number;
  source: StrengthSource;
  appliedFactors: string[];
  nextTier: NextTierTarget | null;
  flags: string[];
  /** Premium-only — populated internally, hidden by serializeStrengthResult() for free users. */
  oneRMBandKg: [number, number] | null;
  trend: StrengthTrend | null;
  suggestion: string | null;
}

/** What a free-tier caller may see. Premium adds oneRMBandKg, trend, suggestion. */
export interface FreeStrengthResult {
  liftKey: string;
  score: number;
  tier: StrengthTier;
  oneRM: number;
  bodyweightRatio: number;
  nextTier: NextTierTarget | null;
  source: StrengthSource;
  flags: string[];
  premiumLocked: Array<"oneRMBandKg" | "trend" | "suggestion" | "oneRMConfidence" | "appliedFactors">;
}

// ---------------------------------------------------------------------------
// Constants — actively calibrated, kept editable and undiluted by logic.
// ---------------------------------------------------------------------------

/** The bodyweight (kg) the calibration table and anchors below are defined at. */
const REFERENCE_BODYWEIGHT_KG = 83;

/** Index points per unit of ln(ratio / anchor). */
const SLOPE = 380;

/**
 * Allometric bodyweight exponent: strength doesn't scale linearly with
 * bodyweight (cross-sectional area vs. volume), so a flat 1RM/BW ratio
 * unfairly penalises heavier lifters. 0.67 is a commonly used approximation
 * in strength-standard literature — swap in a better-fitted value freely.
 */
const ALLOMETRIC_EXP = 0.67;

interface LiftAnchor {
  /** The 1RM/bodyweight ratio (at REFERENCE_BODYWEIGHT_KG) that scores exactly 500 for a male lifter, age 20–35. */
  anchorRatio: number;
  category: string;
  bodyPart: BodyPart;
}

/**
 * Calibrated against real lifter data (see IMPLEMENTATION-BRIEF.md fixture
 * table — all fixtures are ±3 of scoreStrength()'s output for these anchors).
 */
const PRIMARY_ANCHORS: Record<string, LiftAnchor> = {
  // Bench/deadlift anchorRatio now only a fallback reference (50th-percentile
  // ratio, kept in sync with WEIGHT_RATIO_ANCHOR_TABLES below) — actual
  // scoring for these two goes through the corrected anchor table instead
  // (Part G, scoring-calibration-rewrite). Previous single-anchor value
  // (0.785, "recalibrated so 120×4/110×6/100×9 ≈ 800 @ 80kg BW") scored a
  // real bench PB (140kg @ 83kg BW) at ~850 "Elite" — a full tier more
  // generous than Strength Level's population data implies (~752, Advanced).
  bench: { anchorRatio: 98 / 83, category: "chest", bodyPart: "upperBody" },
  squat: { anchorRatio: 0.9984, category: "legs", bodyPart: "lowerBody" },
  // Deadlift was already close to accurate (200kg @ 83kg BW -> 770 vs. the
  // corrected 725) — least-urgent of the two, still corrected for
  // consistency now the table exists.
  deadlift: { anchorRatio: 152 / 83, category: "back", bodyPart: "pull" },
  ohp: { anchorRatio: 0.4213, category: "shoulders", bodyPart: "upperBody" },
  barbellRow: { anchorRatio: 0.687, category: "back", bodyPart: "pull" },
  frontSquat: { anchorRatio: 0.8103, category: "legs", bodyPart: "lowerBody" },
  inclineBench: { anchorRatio: 0.64, category: "chest", bodyPart: "upperBody" },
  // Bodyweight-only and added-weight variants of the same movement are
  // deliberately SEPARATE keys (user feedback: "Pull Up" etc. should score
  // off reps alone with no weight input, while "Weighted Pull Up" etc. stay
  // a distinct, separately-tracked exercise) — not just a UI label
  // difference. Both twins reuse the identical anchorRatio: the underlying
  // physics/anchor point doesn't change based on whether this specific set
  // happened to have added load, and weightedCalisthenic1RM already handles
  // addedKg=0 correctly (see the fix note on that function).
  weightedPullup: { anchorRatio: 0.3327, category: "back", bodyPart: "pull" },
  pullUp: { anchorRatio: 0.3327, category: "back", bodyPart: "pull" },
  weightedDips: { anchorRatio: 0.4731, category: "chest", bodyPart: "upperBody" },
  dip: { anchorRatio: 0.4731, category: "chest", bodyPart: "upperBody" },
  pushUp: { anchorRatio: 0.303, category: "chest", bodyPart: "upperBody" },
  weightedPushUp: { anchorRatio: 0.303, category: "chest", bodyPart: "upperBody" },
  // No Strength Level population data for muscle-ups (not a mainstream
  // tracked lift there) — anchor reasoned from published calisthenics
  // standards instead (Fitness Volt): "Intermediate" is defined as ~1 rep
  // at bodyweight+20%, which is the natural 500-point anchor given this
  // model's convention (bodyweight-only reps still resolve through the
  // same rep-to-1RM estimator, so this isn't just for added-weight sets).
  // Flag as an estimate, same honesty standard as the file's other
  // engineering approximations, until real logged data can validate it.
  muscleUp: { anchorRatio: 0.20, category: "back", bodyPart: "pull" },
  weightedMuscleUp: { anchorRatio: 0.20, category: "back", bodyPart: "pull" },
};

type WeightAnchor = [ratio: number, score: number];

/**
 * Corrected worked examples (Part G, scoring-calibration-rewrite.md) —
 * Strength Level's general standards (the same 48.7M-lift dataset the
 * sex/age factors above already use), mapped through
 * percentile-framework.ts's 5/20/50/80/95th percentile scale, at
 * REFERENCE_BODYWEIGHT_KG (83kg). Ratio = weight_kg / 83.
 *
 * Scored via direct interpolation across the table (same mechanism as the
 * cardio anchor tables), not the single-anchorRatio log formula the other
 * ~20 lifts still use: a single anchor + fixed SLOPE can't fit 5
 * independent percentile points well — real strength distributions aren't
 * a clean single-slope log-normal curve end to end — so these two lifts
 * (the ones with full 5-point Strength Level data) get a real anchor table
 * instead, exactly like row/run/etc.
 *
 * Methodology for the remaining ~20 lifts (mechanical, repeatable): pull
 * Strength Level's published bodyweight-indexed standards for each lift and
 * bodyweight band, map through percentile-framework.ts exactly as done
 * here. Squat and overhead press are next — the other two "big four" lifts
 * with the most reliable Strength Level coverage. Accessory/dumbbell lifts
 * without direct Strength Level tables (incline DB, DB shoulder press, etc)
 * can be derived by applying their existing documented multiplier
 * relationship to the now-corrected compound-lift anchors, rather than
 * needing independent population data for every accessory movement.
 */
const WEIGHT_RATIO_ANCHOR_TABLES: Partial<Record<string, WeightAnchor[]>> = {
  bench: [
    [47 / REFERENCE_BODYWEIGHT_KG, 125],
    [70 / REFERENCE_BODYWEIGHT_KG, 250],
    [98 / REFERENCE_BODYWEIGHT_KG, 475],
    [132 / REFERENCE_BODYWEIGHT_KG, 725],
    [169 / REFERENCE_BODYWEIGHT_KG, 850],
  ],
  deadlift: [
    [78 / REFERENCE_BODYWEIGHT_KG, 125],
    [112 / REFERENCE_BODYWEIGHT_KG, 250],
    [152 / REFERENCE_BODYWEIGHT_KG, 475],
    [200 / REFERENCE_BODYWEIGHT_KG, 725],
    [250 / REFERENCE_BODYWEIGHT_KG, 850],
  ],
};

const ACCESSORY_MAP: Record<string, LiftAnchor> = {
  inclineDbPress: { anchorRatio: 0.6776, category: "chest", bodyPart: "upperBody" },
  flatDbPress: { anchorRatio: 0.365, category: "chest", bodyPart: "upperBody" },
  machineChestPress: { anchorRatio: 0.7846, category: "chest", bodyPart: "upperBody" },
  cableFly: { anchorRatio: 0.3823, category: "chest", bodyPart: "upperBody" },
  pecDeck: { anchorRatio: 0.8583, category: "chest", bodyPart: "upperBody" },
  tricepPushdown: { anchorRatio: 0.3138, category: "arms", bodyPart: "upperBody" },
  tricepPushdownSingleArm: { anchorRatio: 0.153, category: "arms", bodyPart: "upperBody" },
  // Recalibrated (user feedback: 20kg/hand x8 scored 669, expected ~750;
  // 12.5kg/hand x8 scored ~475, expected ~550 — both read meaningfully low).
  // 0.20 is the best single-anchor fit for both reported points under the
  // shared SLOPE constant (which isn't exercise-specific, so it isn't
  // touched here) — lands almost exactly on the 12.5kg point and within
  // ~2% of the 20kg one; the two examples aren't perfectly consistent with
  // a single anchor at the existing SLOPE, so this is the closest
  // reasonable fit rather than an exact match to both.
  dbCurl: { anchorRatio: 0.20, category: "arms", bodyPart: "upperBody" },
  hammerCurl: { anchorRatio: 0.202, category: "arms", bodyPart: "upperBody" },
  skullcrusher: { anchorRatio: 0.22, category: "arms", bodyPart: "upperBody" },
  cableCurl: { anchorRatio: 0.28, category: "arms", bodyPart: "upperBody" },
  singleArmPushdown: { anchorRatio: 0.189, category: "arms", bodyPart: "upperBody" },
  dbShoulderPress: { anchorRatio: 0.216, category: "shoulders", bodyPart: "upperBody" },
  lateralRaise: { anchorRatio: 0.1525, category: "shoulders", bodyPart: "upperBody" },
  dbRow: { anchorRatio: 0.4524, category: "back", bodyPart: "pull" },
  barbellCurl: { anchorRatio: 0.3435, category: "arms", bodyPart: "upperBody" },
  preacherCurl: { anchorRatio: 0.3968, category: "arms", bodyPart: "upperBody" },
  latPulldown: { anchorRatio: 0.8813, category: "back", bodyPart: "pull" },
  legExtension: { anchorRatio: 0.9899, category: "legs", bodyPart: "lowerBody" },
  walkingLunge: { anchorRatio: 0.7762, category: "legs", bodyPart: "lowerBody" },
  bulgarianSplit: { anchorRatio: 0.8921, category: "legs", bodyPart: "lowerBody" },
  calfRaise: { anchorRatio: 1.0462, category: "legs", bodyPart: "lowerBody" },
  hipAdduction: { anchorRatio: 0.816, category: "legs", bodyPart: "lowerBody" },
  legCurl: { anchorRatio: 0.6372, category: "legs", bodyPart: "lowerBody" },
};

/**
 * Exercise-name aliases → canonical anchor key. Anything not listed here
 * falls back to a category default (source: "generic", lower confidence) —
 * see GENERIC_CATEGORY_ANCHORS.
 */
const LIFT_ALIASES: Record<string, string> = {
  // primaries
  "bench press": "bench", bench: "bench", "close grip bench press": "bench",
  squat: "squat", "back squat": "squat", "box squat": "squat", "pause squat": "squat",
  deadlift: "deadlift", "sumo deadlift": "deadlift", "trap bar deadlift": "deadlift", "rack pull": "deadlift",
  "overhead press": "ohp", ohp: "ohp", "seated overhead press": "ohp", "push press": "ohp", "z press": "ohp", "landmine press": "ohp",
  "barbell row": "barbellRow", "pendlay row": "barbellRow", "chest supported row": "barbellRow", "seal row": "barbellRow", "t-bar row": "barbellRow", "meadows row": "barbellRow",
  "front squat": "frontSquat", "goblet squat": "frontSquat",
  "incline bench press": "inclineBench", "decline bench press": "inclineBench", "smith machine bench press": "inclineBench",
  // Weighted variants are a separate key from the plain bodyweight ones —
  // see the comment on PRIMARY_MAP above.
  "weighted pull up": "weightedPullup", "weighted pull-up": "weightedPullup", "weighted chin up": "weightedPullup",
  "pull up": "pullUp", "pull-up": "pullUp", "chin up": "pullUp",
  "weighted dips": "weightedDips",
  dips: "dip", "chest dips": "dip", "bench dips": "dip", "ring dip": "dip", "ring dips": "dip",
  "weighted ring dip": "weightedDips", "weighted ring dips": "weightedDips",
  "muscle up": "muscleUp", "muscle-up": "muscleUp", "bar muscle up": "muscleUp", "ring muscle up": "muscleUp",
  "weighted muscle up": "weightedMuscleUp", "weighted muscle-up": "weightedMuscleUp",
  "romanian deadlift": "deadlift", rdl: "deadlift", "stiff leg deadlift": "deadlift",
  "push up": "pushUp", "push-up": "pushUp",
  "diamond push up": "pushUp", "wide push up": "pushUp", "decline push up": "pushUp", "incline push up": "pushUp",
  "weighted push up": "weightedPushUp", "weighted push-up": "weightedPushUp",
  // accessories
  "incline dumbbell press": "inclineDbPress", "decline dumbbell press": "inclineDbPress",
  "dumbbell bench press": "flatDbPress",
  "machine chest press": "machineChestPress", "smith machine squat": "machineChestPress",
  "cable fly": "cableFly", "low-to-high cable fly": "cableFly", "high-to-low cable fly": "cableFly",
  "dumbbell fly": "cableFly", "incline dumbbell fly": "cableFly",
  "pec deck": "pecDeck",
  "rope pushdown": "tricepPushdown", "tricep pushdown": "tricepPushdown", "tricep extension": "tricepPushdown",
  "single arm pushdown": "tricepPushdownSingleArm",
  "skull crusher": "skullcrusher", "overhead tricep extension": "tricepPushdown",
  "cable overhead extension": "tricepPushdown", "dumbbell kickback": "tricepPushdown", "jm press": "tricepPushdown",
  "dumbbell shoulder press": "dbShoulderPress", "seated dumbbell press": "dbShoulderPress", "machine shoulder press": "dbShoulderPress", "arnold press": "dbShoulderPress",
  "cable lateral raise": "lateralRaise", "machine lateral raise": "lateralRaise", "front raise": "lateralRaise", "rear delt fly": "lateralRaise", "reverse pec deck": "lateralRaise", "upright row": "lateralRaise", "cable rear delt pull": "lateralRaise",
  "dumbbell row": "dbRow", "single arm cable row": "dbRow", "seated cable row": "dbRow", "inverted row": "dbRow", "face pull": "dbRow", "machine row": "dbRow",
  "ez bar curl": "barbellCurl", "dumbbell curl": "dbCurl", "hammer curl": "hammerCurl", "cross body hammer curl": "hammerCurl", "cable curl": "cableCurl", "bayesian cable curl": "cableCurl", "concentration curl": "dbCurl", "reverse curl": "barbellCurl", "wrist curl": "barbellCurl",
  "skull crushers": "skullcrusher", "dumbbell skull crusher": "skullcrusher",
  "machine preacher curl": "preacherCurl", "spider curl": "preacherCurl",
  "close grip lat pulldown": "latPulldown",
  "leg extension": "legExtension", "single leg extension": "legExtension",
  "walking lunges": "walkingLunge", lunges: "walkingLunge", "reverse lunges": "walkingLunge",
  "bulgarian split squat": "bulgarianSplit", "step up": "bulgarianSplit",
  "standing calf raise": "calfRaise", "seated calf raise": "calfRaise", "calf raise": "calfRaise",
  "leg press calf raise": "calfRaise",
  "hip adduction": "hipAdduction", "hip abduction": "hipAdduction",
  "seated leg curl": "legCurl", "leg curl": "legCurl",
};

/**
 * camelCase anchor keys (e.g. "tricepPushdown") only match other camelCase
 * input directly; real exercise names have spaces ("Tricep Pushdown"). Rather
 * than hand-maintain a spaced alias for every single anchor key (easy to
 * forget — this is exactly how "Lateral Raise" and "Pec Deck" slipped
 * through to the generic fallback during calibration), derive the spaced
 * form once and use it as an automatic fallback alongside LIFT_ALIASES.
 */
function camelCaseToSpaced(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function buildDerivedAliases(): Record<string, string> {
  const derived: Record<string, string> = {};
  for (const key of [...Object.keys(PRIMARY_ANCHORS), ...Object.keys(ACCESSORY_MAP)]) {
    const spaced = camelCaseToSpaced(key);
    if (spaced !== key.toLowerCase()) derived[spaced] = key;
  }
  return derived;
}

const DERIVED_ALIASES: Record<string, string> = buildDerivedAliases();

/**
 * Category/kind fallback for exercises with no direct anchor or alias —
 * inherited from the broader movement pattern, so still meaningfully
 * differentiated (an isolation shoulder movement vs. a supported machine
 * press), just lower-confidence than a calibrated primary/accessory entry.
 */
const GENERIC_CATEGORY_ANCHORS: Record<string, LiftAnchor> = {
  "chest:compound": { anchorRatio: 0.6147, category: "chest", bodyPart: "upperBody" },
  "chest:accessory": { anchorRatio: 0.2470, category: "chest", bodyPart: "upperBody" },
  "back:compound": { anchorRatio: 0.6395, category: "back", bodyPart: "pull" },
  "back:accessory": { anchorRatio: 0.4524, category: "back", bodyPart: "pull" },
  "legs:compound": { anchorRatio: 0.9984, category: "legs", bodyPart: "lowerBody" },
  "legs:accessory": { anchorRatio: 0.5, category: "legs", bodyPart: "lowerBody" },
  "shoulders:compound": { anchorRatio: 0.4213, category: "shoulders", bodyPart: "upperBody" },
  "shoulders:accessory": { anchorRatio: 0.1525, category: "shoulders", bodyPart: "upperBody" },
  "arms:compound": { anchorRatio: 0.6395, category: "arms", bodyPart: "upperBody" },
  "arms:accessory": { anchorRatio: 0.3197, category: "arms", bodyPart: "upperBody" },
  "core:compound": { anchorRatio: 0.5, category: "core", bodyPart: "lowerBody" },
  "core:accessory": { anchorRatio: 0.25, category: "core", bodyPart: "lowerBody" },
};
const DEFAULT_GENERIC_ANCHOR: LiftAnchor = { anchorRatio: 0.35, category: "other", bodyPart: "upperBody" };

/**
 * Female standard as a fraction of the male anchor, by movement region (Part A).
 * Lower factor = more boost. `upper` and `pull` calibrated from real female-lifter
 * data; `lowerBody` unchanged — needs barbell squat/RDL to calibrate.
 */
export const SEX_FACTORS: Record<BodyPart, number> = {
  lowerBody: 0.78,
  upperBody: 0.85,
  pull: 0.73,
};

/** Exercise class for 1RM coefficient selection (Part D). */
export const EXERCISE_CLASS: Record<string, ExerciseClass> = {
  bench: "compound",
  squat: "compound",
  deadlift: "compound",
  ohp: "compound",
  barbellRow: "compound",
  frontSquat: "compound",
  inclineBench: "compound",
  weightedPullup: "compound",
  pullUp: "compound",
  weightedDips: "compound",
  dip: "compound",
  pushUp: "compound",
  weightedPushUp: "compound",
  muscleUp: "compound",
  weightedMuscleUp: "compound",
  inclineDbPress: "accessory",
  flatDbPress: "accessory",
  machineChestPress: "accessory",
  pecDeck: "accessory",
  dbShoulderPress: "accessory",
  latPulldown: "accessory",
  legExtension: "accessory",
  legPress: "accessory",
  walkingLunge: "accessory",
  bulgarianSplit: "accessory",
  calfRaise: "accessory",
  hipAdduction: "accessory",
  legCurl: "accessory",
  dbRow: "accessory",
  tricepPushdown: "isolation",
  tricepPushdownSingleArm: "isolation",
  dbCurl: "isolation",
  hammerCurl: "isolation",
  skullcrusher: "isolation",
  cableCurl: "isolation",
  cableFly: "isolation",
  lateralRaise: "isolation",
  preacherCurl: "isolation",
  barbellCurl: "isolation",
  singleArmPushdown: "isolation",
};

export function exerciseClassFor(resolvedKey: string): ExerciseClass {
  return EXERCISE_CLASS[resolvedKey] ?? "accessory";
}

/**
 * Gentle Masters-style age curve, applied as a multiplier on the athlete's
 * ratio (equivalently: the anchor gets easier with age). Flat 20–35, barely
 * moving under 40, then a steadier climb. ESTIMATE derived from Legion's
 * strength-by-age chart — refine with published McCulloch/Masters
 * coefficients (see roadmap). Verified: a 50-year-old benching the same
 * 140kg as a 25-year-old scores ~11% higher on the ratio (890 vs 850, still
 * comfortably inside the same Elite band — "gentle," not tier-jumping).
 */
export function ageFactor(age: number): number {
  if (age <= 35) return 1.0;
  if (age <= 40) return 1.0 + (age - 35) * (0.02 / 5);
  return 1.02 + (age - 40) * ((1.11 - 1.02) / 10);
}

const TIER_THRESHOLDS: Array<{ tier: StrengthTier; min: number }> = [
  { tier: "Beginner", min: 0 },
  { tier: "Intermediate", min: 250 },
  { tier: "Semi-Pro", min: 475 },
  { tier: "Advanced", min: 725 },
  { tier: "Elite", min: 850 },
  { tier: "World Class", min: 925 },
];

const MIN_SCORE = 1;
const MAX_SCORE = 999;
/** Only a genuinely exceptional (record-approaching) ratio should ever read this high. */
const NEAR_RECORD_THRESHOLD = 970;
const MIN_RATIO = 0.01;

/**
 * Lifts where the logged weight is *added* load on top of bodyweight, not
 * the total load under tension — a weighted pull-up at "30kg" moves
 * bodyweight + 30kg for every rep, but feeding the formula 30kg alone
 * understates the set's true difficulty (and the error compounds as reps
 * climb). Resolve total-load 1RM first, then subtract bodyweight back out
 * to express the result the same way it was logged (added weight).
 */
const BODYWEIGHT_RELATIVE_LIFTS = new Set<string>([
  "weightedPullup",
  "pullUp",
  "weightedDips",
  "dip",
  "pushUp",
  "weightedPushUp",
  "muscleUp",
  "weightedMuscleUp",
]);

/**
 * Fraction of bodyweight actually under tension for bodyweight-relative
 * lifts — pull-ups/dips hang the full bodyweight from the working muscles,
 * but a push-up's four-point stance (hands + feet) only loads roughly 64%
 * of bodyweight through the arms/chest (standard fitness-industry estimate
 * for a horizontal push-up position). Missing from this map defaults to 1.0
 * (full bodyweight), matching pull-ups/dips.
 */
const BODYWEIGHT_FRACTIONS: Record<string, number> = {
  pushUp: 0.64,
  weightedPushUp: 0.64,
};

function bodyweightFraction(resolvedKey: string): number {
  return BODYWEIGHT_FRACTIONS[resolvedKey] ?? 1.0;
}

function estimate1RMFromSet(
  weightKg: number,
  reps: number,
  exerciseClass: ExerciseClass,
  isBodyweightRelative: boolean,
  bodyweightKg: number,
  loadFraction: number,
  repsInReserve?: number | null
): number {
  const loadedBodyweight = bodyweightKg * loadFraction;
  if (isBodyweightRelative) {
    return weightedCalisthenic1RM(
      weightKg,
      reps,
      loadedBodyweight,
      exerciseClass,
      repsInReserve
    );
  }
  return bestEstimate1RM(weightKg, reps, exerciseClass, repsInReserve);
}

/** Sub-maximal sets (no low-rep/near-max data) read ~3-14% low on formula-based 1RM estimates; this is the midpoint correction, shared by both the adaptive and single-set paths. */
const SUB_MAX_BIAS_CORRECTION = 1.06;

/**
 * Skipped for bodyweight-relative lifts: their own total-load-then-subtract
 * correction (see BODYWEIGHT_RELATIVE_LIFTS) already moves the estimate
 * substantially, and because bodyweight is usually the majority of the
 * total load, a small percentage correction on the total gets amplified
 * into a much larger swing on the comparatively small added-weight result
 * once bodyweight is subtracted back out (e.g. correcting a ~110kg total
 * load by 6% can move a ~30kg added-weight answer by 15%+). Stacking both
 * corrections overshoots past what either was individually validated
 * against — see BRIEF-3-strength-1rm-calibration.md §1.
 */
function subMaxBiasCorrection(
  hasLowRepData: boolean,
  isBodyweightRelative: boolean,
  exerciseClass: ExerciseClass = "compound"
): number {
  if (isBodyweightRelative) return 1.0;
  if (exerciseClass === "isolation") return 1.0;
  return hasLowRepData ? 1.0 : SUB_MAX_BIAS_CORRECTION;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Exported so callers building exercise-history lookups (keyed by name) use identical normalization. */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function resolveLiftAnchor(liftKey: string): { anchor: LiftAnchor; source: StrengthSource; resolvedKey: string } {
  // Canonical camelCase lift keys (e.g. "barbellRow") are matched case-sensitively
  // first — they're identifiers, not free-text exercise names. Free-text names
  // as logged by the gym form ("Barbell Row") fall through to the normalized
  // alias lookup below.
  if (PRIMARY_ANCHORS[liftKey]) return { anchor: PRIMARY_ANCHORS[liftKey], source: "primary", resolvedKey: liftKey };
  if (ACCESSORY_MAP[liftKey]) return { anchor: ACCESSORY_MAP[liftKey], source: "accessory", resolvedKey: liftKey };

  const key = normalizeName(liftKey);
  if (PRIMARY_ANCHORS[key]) return { anchor: PRIMARY_ANCHORS[key], source: "primary", resolvedKey: key };
  if (ACCESSORY_MAP[key]) return { anchor: ACCESSORY_MAP[key], source: "accessory", resolvedKey: key };

  const aliased = LIFT_ALIASES[key] ?? DERIVED_ALIASES[key];
  if (aliased) {
    if (PRIMARY_ANCHORS[aliased]) return { anchor: PRIMARY_ANCHORS[aliased], source: "primary", resolvedKey: aliased };
    if (ACCESSORY_MAP[aliased]) return { anchor: ACCESSORY_MAP[aliased], source: "accessory", resolvedKey: aliased };
  }

  return { anchor: DEFAULT_GENERIC_ANCHOR, source: "generic", resolvedKey: key };
}

/** Resolve a generic (non-anchored, non-aliased) exercise via its catalog category/kind. Used by the adapter layer, not the engine itself. */
export function genericAnchorForCategory(category: string, kind: "compound" | "accessory"): LiftAnchor {
  return GENERIC_CATEGORY_ANCHORS[`${category}:${kind}`] ?? DEFAULT_GENERIC_ANCHOR;
}

/**
 * Bodyweight-adjusted ratio, normalized so it exactly equals the plain
 * 1RM/bodyweight ratio at REFERENCE_BODYWEIGHT_KG (where every anchor is
 * calibrated) — the allometric exponent only changes how scores extrapolate
 * to *other* bodyweights, not the reference calibration itself.
 */
function relativeStrengthRatio(oneRM: number, bodyweightKg: number): number {
  if (bodyweightKg <= 0) return 0;
  const refAdjusted = REFERENCE_BODYWEIGHT_KG ** ALLOMETRIC_EXP;
  return (oneRM / bodyweightKg ** ALLOMETRIC_EXP) * (refAdjusted / REFERENCE_BODYWEIGHT_KG);
}

/** Inverse of relativeStrengthRatio — the 1RM that would produce a given ratio at this bodyweight. */
function oneRMForRatio(ratio: number, bodyweightKg: number): number {
  const refAdjusted = REFERENCE_BODYWEIGHT_KG ** ALLOMETRIC_EXP;
  return ratio * bodyweightKg ** ALLOMETRIC_EXP * REFERENCE_BODYWEIGHT_KG / refAdjusted;
}

/** Universal 0-1000 tier band (MASTER-BRIEF.md §1) — applies to any Split Index score, not just per-lift strength. */
export function tierForScore(score: number): StrengthTier {
  let tier: StrengthTier = "Beginner";
  for (const t of TIER_THRESHOLDS) {
    if (score >= t.min) tier = t.tier;
  }
  return tier;
}

function scoreFromRatio(ratio: number, effectiveAnchor: number): number {
  const safeRatio = Math.max(ratio, MIN_RATIO);
  const raw = 500 + SLOPE * Math.log(safeRatio / effectiveAnchor);
  return clamp(Math.round(raw), MIN_SCORE, MAX_SCORE);
}

function computeNextTier(
  score: number,
  effectiveAnchor: number,
  bodyweightKg: number,
  currentOneRM: number
): NextTierTarget | null {
  const currentIdx = TIER_THRESHOLDS.findIndex((t) => t.tier === tierForScore(score));
  if (currentIdx === -1 || currentIdx === TIER_THRESHOLDS.length - 1) return null;
  const next = TIER_THRESHOLDS[currentIdx + 1];
  const targetRatio = effectiveAnchor * Math.exp((next.min - 500) / SLOPE);
  const targetOneRM = oneRMForRatio(targetRatio, bodyweightKg);
  const kgNeeded = Math.max(0, targetOneRM - currentOneRM);
  return { tier: next.tier, kgNeeded: round1(kgNeeded) };
}

/**
 * Interpolates a strength anchor table (ratio -> score) — ascending ratio =
 * ascending score (higher ratio is always better, unlike the cardio time
 * tables where lower is better), with the same gentle slope-continued
 * extrapolation at both ends as interpolateAnchors() in cardio-benchmarks.ts.
 */
function interpolateWeightAnchors(anchors: WeightAnchor[], ratio: number): number {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (ratio <= first[0]) {
    const next = sorted[1] ?? first;
    const slope = next[0] === first[0] ? 0 : (next[1] - first[1]) / (next[0] - first[0]);
    return Math.max(0, first[1] + slope * (ratio - first[0]));
  }
  if (ratio >= last[0]) {
    const prev = sorted[sorted.length - 2] ?? last;
    const slope = last[0] === prev[0] ? 0 : (last[1] - prev[1]) / (last[0] - prev[0]);
    return Math.min(999, last[1] + slope * (ratio - last[0]));
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (ratio >= x0 && ratio <= x1) {
      const t = (ratio - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

/** Inverse of interpolateWeightAnchors — the ratio that would produce a given score. */
function inverseInterpolateWeightAnchors(anchors: WeightAnchor[], targetScore: number): number {
  const sorted = [...anchors].sort((a, b) => a[1] - b[1]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (targetScore <= first[1]) {
    const next = sorted[1] ?? first;
    const slope = next[1] === first[1] ? 0 : (next[0] - first[0]) / (next[1] - first[1]);
    return first[0] + slope * (targetScore - first[1]);
  }
  if (targetScore >= last[1]) {
    const prev = sorted[sorted.length - 2] ?? last;
    const slope = last[1] === prev[1] ? 0 : (last[0] - prev[0]) / (last[1] - prev[1]);
    return last[0] + slope * (targetScore - last[1]);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (targetScore >= y0 && targetScore <= y1) {
      const t = (targetScore - y0) / (y1 - y0);
      return x0 + (x1 - x0) * t;
    }
  }
  return last[0];
}

/**
 * computeNextTier() equivalent for anchor-table-scored lifts (bench/
 * deadlift). `effectiveSexFactor`/`effectiveAgeFactor` undo the sex/age
 * adjustment applied to get from this athlete's raw ratio to the
 * table-lookup ratio, so the target is expressed back in this athlete's own
 * raw kg (default 1 = no adjustment, matching a male athlete age <= 35).
 */
function computeNextTierFromWeightAnchors(
  score: number,
  table: WeightAnchor[],
  bodyweightKg: number,
  currentOneRM: number,
  effectiveSexFactor: number,
  effectiveAgeFactor: number
): NextTierTarget | null {
  const currentIdx = TIER_THRESHOLDS.findIndex((t) => t.tier === tierForScore(score));
  if (currentIdx === -1 || currentIdx === TIER_THRESHOLDS.length - 1) return null;
  const next = TIER_THRESHOLDS[currentIdx + 1];
  const targetEffectiveRatio = inverseInterpolateWeightAnchors(table, next.min);
  const targetRatio = (targetEffectiveRatio * effectiveSexFactor) / effectiveAgeFactor;
  const targetOneRM = oneRMForRatio(targetRatio, bodyweightKg);
  const kgNeeded = Math.max(0, targetOneRM - currentOneRM);
  return { tier: next.tier, kgNeeded: round1(kgNeeded) };
}

// ---------------------------------------------------------------------------
// Adaptive 1RM (premium) — uses the full logged history, not just this session
// ---------------------------------------------------------------------------

interface AdaptiveEstimate {
  oneRM: number;
  confidence: number;
  trend: StrengthTrend | null;
  band: [number, number];
}

/**
 * Blends the heaviest e1RM ever logged (a real achieved data point) with a
 * recency- and intensity-weighted average across the full history, then
 * corrects for the known low bias of sub-maximal-set formulas when there's
 * no low-rep (near-max) data to anchor against. Constants here are
 * engineering judgment calls, not lab-derived — the point is a materially
 * better estimate than a single set, not a precise one.
 */
function effectiveSetWeight(
  weightKg: number,
  weightEntryMode?: WeightEntryMode,
  exerciseName?: string
): number {
  if (exerciseName) {
    return resolveScoringWeight(weightKg, exerciseName, weightEntryMode).scoringWeightKg;
  }
  return weightEntryMode === "per_hand" ? weightKg * 2 : weightKg;
}

function adaptiveOneRM(
  history: LoggedSet[],
  bodyweightKg: number,
  isBodyweightRelative: boolean,
  exerciseClass: ExerciseClass,
  weightEntryMode?: WeightEntryMode,
  exerciseName?: string,
  loadFraction = 1.0
): AdaptiveEstimate {
  const now = Date.now();
  const loadedBodyweight = bodyweightKg * loadFraction;
  const weighted = history.map((s) => {
    const logged = effectiveSetWeight(s.weightKg, weightEntryMode, exerciseName);
    const e1rm = estimate1RMFromSet(
      logged,
      s.reps,
      exerciseClass,
      isBodyweightRelative,
      bodyweightKg,
      loadFraction,
      s.repsInReserve
    );
    const daysAgo = Math.max(0, (now - new Date(s.performedAt).getTime()) / 86_400_000);
    const recencyWeight = Math.exp(-daysAgo / 180); // ~6-month half-life
    const repWeight = s.reps <= 3 ? 1.0 : s.reps <= 6 ? 0.8 : s.reps <= 10 ? 0.55 : 0.35;
    return { e1rm, weight: recencyWeight * repWeight, reps: s.reps };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0) || 1;
  const weightedAvg = weighted.reduce((sum, w) => sum + w.e1rm * w.weight, 0) / totalWeight;
  const maxE1rm = Math.max(...weighted.map((w) => w.e1rm));

  const hasLowRepData = weighted.some((w) => w.reps <= 3);
  const biasCorrection = subMaxBiasCorrection(hasLowRepData, isBodyweightRelative, exerciseClass);

  const oneRM = (maxE1rm * 0.6 + weightedAvg * 0.4) * biasCorrection;

  const confidence = clamp(
    0.5 + Math.min(weighted.length, 10) * 0.03 + (hasLowRepData ? 0.15 : 0),
    0,
    0.97
  );
  const band: [number, number] = [
    round1(oneRM * (1 - (1 - confidence) * 0.25)),
    round1(oneRM * (1 + (1 - confidence) * 0.15)),
  ];

  let trend: StrengthTrend | null = null;
  if (weighted.length >= 4) {
    const third = Math.max(1, Math.floor(weighted.length / 3));
    const early = weighted.slice(0, third).reduce((s, w) => s + w.e1rm, 0) / third;
    const recent = weighted.slice(-third).reduce((s, w) => s + w.e1rm, 0) / third;
    const delta = (recent - early) / early;
    trend = delta > 0.03 ? "up" : delta < -0.03 ? "down" : "flat";
  }

  return { oneRM, confidence, trend, band };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scoreStrength(input: ScoreStrengthInput): ScoreStrengthResult {
  const { liftKey, history, latestSet, bodyweightKg, sex, age, isPremium } = input;
  const flags: string[] = [];
  const appliedFactors: string[] = [];

  const { anchor, source, resolvedKey } = resolveLiftAnchor(liftKey);
  const exerciseClass = exerciseClassFor(resolvedKey);
  if (source === "generic") flags.push("estimated-generic-standard");
  const isBodyweightRelative =
    input.isBodyweightRelative ?? BODYWEIGHT_RELATIVE_LIFTS.has(resolvedKey);
  const loadFraction = bodyweightFraction(resolvedKey);
  const exerciseName = input.exerciseName ?? liftKey;

  let oneRM: number;
  let oneRMConfidence: number;
  let trend: StrengthTrend | null = null;
  let oneRMBandKg: [number, number] | null = null;

  if (isPremium && history.length > 0) {
    const adaptive = adaptiveOneRM(
      history,
      bodyweightKg,
      isBodyweightRelative,
      exerciseClass,
      input.weightEntryMode,
      exerciseName,
      loadFraction
    );
    oneRM = adaptive.oneRM;
    oneRMConfidence = adaptive.confidence;
    trend = adaptive.trend;
    oneRMBandKg = adaptive.band;
  } else {
    const scoringWeight = latestSet.weightKg;
    oneRM = estimate1RMFromSet(
      scoringWeight,
      latestSet.reps,
      exerciseClass,
      isBodyweightRelative,
      bodyweightKg,
      loadFraction,
      latestSet.repsInReserve
    );
    oneRM *= subMaxBiasCorrection(
      latestSet.reps + (latestSet.repsInReserve ?? 0) <= 3,
      isBodyweightRelative,
      exerciseClass
    );
    const effectiveRepsTotal =
      latestSet.reps + (latestSet.repsInReserve ?? 0);
    oneRMConfidence =
      effectiveRepsTotal <= 3 ? 0.85 : effectiveRepsTotal <= 6 ? 0.7 : 0.5;
    if (effectiveRepsTotal > 8 && (latestSet.repsInReserve ?? 0) === 0) {
      flags.push("1rm-estimate-low-confidence");
    }
  }

  if (
    input.statedOneRMKg != null &&
    input.statedOneRMKg > 0 &&
    oneRMVarianceFlag(
      latestSet.weightKg,
      latestSet.reps,
      input.statedOneRMKg,
      exerciseClass,
      latestSet.repsInReserve
    )
  ) {
    flags.push("1rm-set-variance");
  }

  if (oneRM <= 0 || bodyweightKg <= 0) {
    return {
      liftKey: resolvedKey,
      score: MIN_SCORE,
      tier: "Beginner",
      oneRM: 0,
      oneRMConfidence: 0,
      bodyweightRatio: 0,
      source,
      appliedFactors,
      nextTier: null,
      flags: [...flags, "no-valid-set"],
      oneRMBandKg: null,
      trend: null,
      suggestion: null,
    };
  }

  let effectiveAnchor = anchor.anchorRatio;
  // Sex/age adjustment expressed the other way round for anchor-table
  // lookups (weightAnchorTable below): rather than making the anchor easier
  // to reach, we improve the athlete's own effective ratio before the table
  // lookup — same direction of credit, different mechanics (a fixed anchor
  // doesn't mean anything for a piecewise table the way it does for the log
  // formula's single anchorRatio).
  let effectiveSexFactor = 1;
  let effectiveAgeFactor = 1;

  if (sex === "female") {
    const sexFactor = SEX_FACTORS[anchor.bodyPart];
    effectiveAnchor *= sexFactor;
    effectiveSexFactor = sexFactor;
    appliedFactors.push(`sex:female ×${sexFactor} standard (beta)`);
    flags.push("sex-factor-beta");
    flags.push("female-strength-beta");
  }

  if (age != null && age > 35) {
    const factor = ageFactor(age);
    effectiveAnchor /= factor;
    effectiveAgeFactor = factor;
    appliedFactors.push(`age:${age} ×${factor.toFixed(3)} standard (beta)`);
    flags.push("age-factor-beta");
  }

  const ratio = relativeStrengthRatio(oneRM, bodyweightKg);
  const weightAnchorTable = WEIGHT_RATIO_ANCHOR_TABLES[resolvedKey];

  let score: number;
  let nextTier: NextTierTarget | null;

  if (weightAnchorTable) {
    // Bench/deadlift (Part G, scoring-calibration-rewrite): scored via
    // direct interpolation across Strength-Level-derived anchors rather
    // than the single-anchorRatio log formula — see WEIGHT_RATIO_ANCHOR_TABLES.
    const effectiveRatio = (ratio / effectiveSexFactor) * effectiveAgeFactor;
    score = clamp(
      Math.round(interpolateWeightAnchors(weightAnchorTable, effectiveRatio)),
      MIN_SCORE,
      MAX_SCORE
    );
    nextTier = computeNextTierFromWeightAnchors(
      score,
      weightAnchorTable,
      bodyweightKg,
      oneRM,
      effectiveSexFactor,
      effectiveAgeFactor
    );
  } else {
    score = scoreFromRatio(ratio, effectiveAnchor);
    nextTier = computeNextTier(score, effectiveAnchor, bodyweightKg, oneRM);
  }

  const tier = tierForScore(score);

  if (score >= NEAR_RECORD_THRESHOLD) {
    flags.push("near-record");
  }

  const suggestion =
    isPremium && oneRMConfidence < 0.7
      ? "Log a heavier set (1–3 reps close to failure) to sharpen this estimate."
      : flags.includes("1rm-estimate-low-confidence")
        ? "Log a heavier set near failure to sharpen your 1RM."
        : flags.includes("1rm-set-variance")
          ? "This 1RM looks inconsistent with your logged set. Was the set not near failure, or is the 1RM a different setup?"
          : null;

  return {
    liftKey: resolvedKey,
    score,
    tier,
    oneRM: round1(oneRM),
    oneRMConfidence: round2(oneRMConfidence),
    bodyweightRatio: round2(ratio),
    source,
    appliedFactors,
    nextTier,
    flags,
    oneRMBandKg: isPremium ? oneRMBandKg : null,
    trend: isPremium ? trend : null,
    suggestion,
  };
}

/**
 * Gate premium fields here — never compute-and-hide on the client. Free
 * users get score/tier/oneRM/bodyweightRatio/nextTier; premium adds
 * oneRMBandKg/trend/suggestion/oneRMConfidence/appliedFactors.
 */
export function serializeStrengthResult(
  result: ScoreStrengthResult,
  isPremium: boolean
): FreeStrengthResult | ScoreStrengthResult {
  if (isPremium) return result;

  const premiumLocked: FreeStrengthResult["premiumLocked"] = [
    "oneRMBandKg",
    "trend",
    "suggestion",
    "oneRMConfidence",
    "appliedFactors",
  ];

  return {
    liftKey: result.liftKey,
    score: result.score,
    tier: result.tier,
    oneRM: result.oneRM,
    bodyweightRatio: result.bodyweightRatio,
    nextTier: result.nextTier,
    source: result.source,
    flags: result.flags,
    premiumLocked,
  };
}

/**
 * Rolls a session's (or a profile's) per-exercise scoreStrength() results
 * into a single headline Lab Index. Weighted toward primary/calibrated
 * lifts and higher-confidence results, so one low-confidence generic
 * accessory doesn't swing the headline number as much as a calibrated
 * compound lift.
 */
export function labIndex(results: ScoreStrengthResult[]): number {
  const scored = results.filter((r) => r.oneRM > 0);
  if (scored.length === 0) return MIN_SCORE;

  const weightFor = (r: ScoreStrengthResult) => {
    const sourceWeight = r.source === "primary" ? 1.0 : r.source === "accessory" ? 0.7 : 0.45;
    const confidenceWeight = 0.5 + r.oneRMConfidence * 0.5;
    return sourceWeight * confidenceWeight;
  };

  const totalWeight = scored.reduce((sum, r) => sum + weightFor(r), 0);
  const weightedSum = scored.reduce((sum, r) => sum + r.score * weightFor(r), 0);
  return clamp(Math.round(weightedSum / totalWeight), MIN_SCORE, MAX_SCORE);
}
