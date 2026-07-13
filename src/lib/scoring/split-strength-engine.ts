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
 * Bodyweight-relative lifts (`BODYWEIGHT_RELATIVE_LIFTS` — currently just
 * weighted pull-ups): the logged weight is *added* load, not the total load
 * under tension. 1RM is estimated from bodyweight + added weight, then
 * bodyweight is subtracted back out so the result is expressed the same way
 * it was logged.
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

import { bestEstimate1RM } from "@/lib/scoring/strength/one-rm";

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
}

export interface ScoreStrengthInput {
  /** Exercise name as logged — resolved against the anchor tables below. */
  liftKey: string;
  /** Full logged history for this lift across all past sessions (any order). Required for the premium adaptive path. */
  history: LoggedSet[];
  /** Most recent/best set from the current session — the free-tier path scores off this alone. */
  latestSet: { weightKg: number; reps: number };
  bodyweightKg: number;
  sex: Sex;
  age: number | null;
  isPremium: boolean;
  /** When true, latestSet.weightKg is added load on top of bodyweight (dips, pull-ups). */
  isBodyweightRelative?: boolean;
  /** How weight was logged — doubles for per-hand when resolving history sets. */
  weightEntryMode?: import("@/lib/scoring/weight-entry").WeightEntryMode;
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
  // Bench family recalibrated so 120×4 / 110×6 / 100×9 ≈ 800 @ 80kg BW.
  bench: { anchorRatio: 0.785, category: "chest", bodyPart: "upperBody" },
  squat: { anchorRatio: 0.9984, category: "legs", bodyPart: "lowerBody" },
  deadlift: { anchorRatio: 1.1841, category: "back", bodyPart: "pull" },
  ohp: { anchorRatio: 0.4213, category: "shoulders", bodyPart: "upperBody" },
  barbellRow: { anchorRatio: 0.687, category: "back", bodyPart: "pull" },
  frontSquat: { anchorRatio: 0.8103, category: "legs", bodyPart: "lowerBody" },
  inclineBench: { anchorRatio: 0.64, category: "chest", bodyPart: "upperBody" },
  weightedPullup: { anchorRatio: 0.3327, category: "back", bodyPart: "pull" },
  weightedDips: { anchorRatio: 0.4731, category: "chest", bodyPart: "upperBody" },
};

const ACCESSORY_MAP: Record<string, LiftAnchor> = {
  inclineDbPress: { anchorRatio: 0.6776, category: "chest", bodyPart: "upperBody" },
  flatDbPress: { anchorRatio: 0.365, category: "chest", bodyPart: "upperBody" },
  machineChestPress: { anchorRatio: 0.7846, category: "chest", bodyPart: "upperBody" },
  cableFly: { anchorRatio: 0.3823, category: "chest", bodyPart: "upperBody" },
  pecDeck: { anchorRatio: 0.8583, category: "chest", bodyPart: "upperBody" },
  tricepPushdown: { anchorRatio: 0.3138, category: "arms", bodyPart: "upperBody" },
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
  "weighted pull up": "weightedPullup", "weighted pull-up": "weightedPullup", "weighted chin up": "weightedPullup",
  "pull up": "weightedPullup", "pull-up": "weightedPullup", "chin up": "weightedPullup",
  "weighted dips": "weightedDips", dips: "weightedDips", "chest dips": "weightedDips", "bench dips": "weightedDips",
  "romanian deadlift": "deadlift", rdl: "deadlift", "stiff leg deadlift": "deadlift",
  // accessories
  "incline dumbbell press": "inclineDbPress", "decline dumbbell press": "inclineDbPress",
  "dumbbell bench press": "flatDbPress", "push up": "flatDbPress", "weighted push up": "flatDbPress",
  "machine chest press": "machineChestPress", "smith machine squat": "machineChestPress",
  "cable fly": "cableFly", "low-to-high cable fly": "cableFly", "high-to-low cable fly": "cableFly",
  "dumbbell fly": "cableFly", "incline dumbbell fly": "cableFly",
  "pec deck": "pecDeck",
  "rope pushdown": "tricepPushdown", "tricep pushdown": "tricepPushdown", "tricep extension": "tricepPushdown",
  "single arm pushdown": "singleArmPushdown", "skull crusher": "tricepPushdown", "overhead tricep extension": "tricepPushdown",
  "cable overhead extension": "tricepPushdown", "dumbbell kickback": "tricepPushdown", "jm press": "tricepPushdown",
  "dumbbell shoulder press": "dbShoulderPress", "seated dumbbell press": "dbShoulderPress", "machine shoulder press": "dbShoulderPress", "arnold press": "dbShoulderPress",
  "cable lateral raise": "lateralRaise", "machine lateral raise": "lateralRaise", "front raise": "lateralRaise", "rear delt fly": "lateralRaise", "reverse pec deck": "lateralRaise", "upright row": "lateralRaise", "cable rear delt pull": "lateralRaise",
  "dumbbell row": "dbRow", "single arm cable row": "dbRow", "seated cable row": "dbRow", "inverted row": "dbRow", "face pull": "dbRow", "machine row": "dbRow",
  "ez bar curl": "barbellCurl", "dumbbell curl": "barbellCurl", "hammer curl": "barbellCurl", "cross body hammer curl": "barbellCurl", "cable curl": "barbellCurl", "bayesian cable curl": "barbellCurl", "concentration curl": "barbellCurl", "reverse curl": "barbellCurl", "wrist curl": "barbellCurl",
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
 * Female standard, expressed as a fraction of the male anchor, derived from
 * Legion/Henriques female-vs-male strength-standard data. ESTIMATES — refine
 * with real female lifter data (see roadmap). Verified: a woman benching
 * 84kg at 83kg bodyweight scores ~850, matching a man benching 140kg —
 * equivalent relative strength, equivalent score.
 */
export const SEX_FACTORS: Record<BodyPart, number> = {
  lowerBody: 0.78,
  upperBody: 0.60,
  pull: 0.65,
};

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
const BODYWEIGHT_RELATIVE_LIFTS = new Set<string>(["weightedPullup", "weightedDips"]);

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
function subMaxBiasCorrection(hasLowRepData: boolean, isBodyweightRelative: boolean): number {
  if (isBodyweightRelative) return 1.0;
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
  weightEntryMode?: import("@/lib/scoring/weight-entry").WeightEntryMode
): number {
  return weightEntryMode === "per_hand" ? weightKg * 2 : weightKg;
}

function adaptiveOneRM(
  history: LoggedSet[],
  bodyweightKg: number,
  isBodyweightRelative: boolean,
  weightEntryMode?: import("@/lib/scoring/weight-entry").WeightEntryMode
): AdaptiveEstimate {
  const now = Date.now();
  const weighted = history.map((s) => {
    const logged = effectiveSetWeight(s.weightKg, weightEntryMode);
    const effectiveWeight = isBodyweightRelative ? bodyweightKg + logged : logged;
    const totalE1rm = bestEstimate1RM(effectiveWeight, s.reps);
    const e1rm = isBodyweightRelative ? totalE1rm - bodyweightKg : totalE1rm;
    const daysAgo = Math.max(0, (now - new Date(s.performedAt).getTime()) / 86_400_000);
    const recencyWeight = Math.exp(-daysAgo / 180); // ~6-month half-life
    const repWeight = s.reps <= 3 ? 1.0 : s.reps <= 6 ? 0.8 : s.reps <= 10 ? 0.55 : 0.35;
    return { e1rm, weight: recencyWeight * repWeight, reps: s.reps };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0) || 1;
  const weightedAvg = weighted.reduce((sum, w) => sum + w.e1rm * w.weight, 0) / totalWeight;
  const maxE1rm = Math.max(...weighted.map((w) => w.e1rm));

  const hasLowRepData = weighted.some((w) => w.reps <= 3);
  const biasCorrection = subMaxBiasCorrection(hasLowRepData, isBodyweightRelative);

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
  if (source === "generic") flags.push("estimated-generic-standard");
  const isBodyweightRelative =
    input.isBodyweightRelative ?? BODYWEIGHT_RELATIVE_LIFTS.has(resolvedKey);

  let oneRM: number;
  let oneRMConfidence: number;
  let trend: StrengthTrend | null = null;
  let oneRMBandKg: [number, number] | null = null;

  if (isPremium && history.length > 0) {
    const adaptive = adaptiveOneRM(
      history,
      bodyweightKg,
      isBodyweightRelative,
      input.weightEntryMode
    );
    oneRM = adaptive.oneRM;
    oneRMConfidence = adaptive.confidence;
    trend = adaptive.trend;
    oneRMBandKg = adaptive.band;
  } else {
    const effectiveWeight = isBodyweightRelative
      ? bodyweightKg + latestSet.weightKg
      : latestSet.weightKg;
    const rawEstimate = bestEstimate1RM(effectiveWeight, latestSet.reps);
    // Subtract bodyweight back out *before* the (skipped, for this category —
    // see subMaxBiasCorrection) bias correction, not after: multiplying a
    // correction into the total load and only then subtracting amplifies it
    // hugely on the much smaller added-weight result. Kept in this order so
    // the two corrections stay independent and composable if that changes.
    const rawAddedWeight = isBodyweightRelative ? rawEstimate - bodyweightKg : rawEstimate;
    oneRM = rawAddedWeight * subMaxBiasCorrection(latestSet.reps <= 3, isBodyweightRelative);
    oneRMConfidence = latestSet.reps <= 3 ? 0.85 : latestSet.reps <= 6 ? 0.7 : 0.5;
    if (latestSet.reps > 8) flags.push("1rm-estimate-low-confidence");
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

  if (sex === "female") {
    const sexFactor = SEX_FACTORS[anchor.bodyPart];
    effectiveAnchor *= sexFactor;
    appliedFactors.push(`sex:female ×${sexFactor} standard (beta)`);
    flags.push("sex-factor-beta");
  }

  if (age != null && age > 35) {
    const factor = ageFactor(age);
    effectiveAnchor /= factor;
    appliedFactors.push(`age:${age} ×${factor.toFixed(3)} standard (beta)`);
    flags.push("age-factor-beta");
  }

  const ratio = relativeStrengthRatio(oneRM, bodyweightKg);
  const score = scoreFromRatio(ratio, effectiveAnchor);
  const tier = tierForScore(score);
  const nextTier = computeNextTier(score, effectiveAnchor, bodyweightKg, oneRM);

  if (score >= NEAR_RECORD_THRESHOLD) {
    flags.push("near-record");
  }

  const suggestion =
    isPremium && oneRMConfidence < 0.7
      ? "Log a heavy set (1–3 reps close to failure) to sharpen this estimate."
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
