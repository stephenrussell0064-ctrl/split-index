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
 * the latest set — only a longer history lets the adaptive model express a
 * trend and blend against a real achieved peak. Both the single-set fallback
 * and the adaptive history model run the same estimator (`bestEstimate1RM`,
 * Strength Level's published rep table) — free tier just doesn't get the
 * extra trend/band/multi-session blending premium does. Gate premium fields
 * at the serializer (`serializeStrengthResult`), not by computing and hiding
 * them on the client.
 *
 * Three 1RM numbers, deliberately, because "my 1RM" means two different
 * things to an athlete and a single figure cannot be both:
 *  - `allTimeOneRM` — the best they have ever hit. A high-water mark: a bad
 *    session can never lower it, only a new best moves it.
 *  - `currentOneRM` — what the recent block says they could do today. A
 *    session worse than the last one pulls this DOWN, which is the entire
 *    point; it is a statement about present fitness, not about a lifetime.
 *  - `oneRM` — the SCORING estimate, unchanged, sitting between the two (see
 *    adaptiveOneRM). The index should neither collapse on one bad day nor be
 *    owned forever by one good one, so it is not simply either of the above.
 * Both athlete-facing numbers are derived from the logged sets on every
 * scoring pass — nothing about them is stored, so they cannot drift from the
 * sets they claim to summarise.
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
 *  - The bodyweight-relative handling (total-load-then-subtract) is an
 *    engineering estimate, not lab-calibrated — validate against real
 *    near-max attempts as they get logged (see `nextTier`/`suggestion`).
 *  - The rep→1RM conversion is Strength Level's own published table, chosen
 *    so the athlete and the population the anchor tables describe are
 *    measured with one ruler. It is not claimed to be the physiologically
 *    best conversion (see strength/one-rm.ts); it is the RIGHT one for this
 *    comparison, and it moves if the tables' source population ever does.
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
import { resolveAttachmentMultiplierByKey } from "@/lib/scoring/strength/attachments";
import { COMMON_EXERCISES } from "@/lib/constants/sports";

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
  /**
   * ISO timestamp of the session `latestSet` belongs to. Defaults to now,
   * which is right for a live log but wrong for a re-score of an old session
   * (`/api/activities/recompute`) — without it, a two-year-old session would
   * be weighted as if it happened today by the recency decay behind
   * `currentOneRM`.
   */
  latestSetPerformedAt?: string;
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
  /**
   * Attachment id (e.g. "rope", "straight-bar") for exercises with
   * attachment options in EXERCISE_ATTACHMENTS (strength/attachments.ts) —
   * user feedback: "equipment/attachment picker for exercises... and
   * predictions differing per attachment". Ignored (no adjustment) for
   * exercises with no defined attachment options.
   */
  attachment?: string | null;
}

export interface NextTierTarget {
  tier: StrengthTier;
  kgNeeded: number;
}

export interface ScoreStrengthResult {
  liftKey: string;
  score: number;
  tier: StrengthTier;
  /** Scoring estimate — what `score` is derived from. Between the two below; see the file header. */
  oneRM: number;
  /**
   * Best 1RM ever achieved across the supplied history plus this set — a
   * high-water mark, never lowered by a worse session.
   *
   * Optional for the same reason as `exerciseIndex` below: results persisted
   * before the split existed genuinely do not have it, and claiming otherwise
   * would make every reader of a stored `score_breakdown` trust a number that
   * isn't there. Fall back to `oneRM` when absent.
   */
  allTimeOneRM?: number;
  /** Recency-weighted estimate of what the athlete could lift now — falls after a worse session. Optional, same reason as `allTimeOneRM`. */
  currentOneRM?: number;
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
  /**
   * This exercise's position in the logged session's exercise list, set by
   * the caller (activity-scorer.ts) after scoring — a stable identifier for
   * matching a result back to its exercise on the activity detail page.
   * liftKey is NOT reliable for this: it's the RESOLVED anchor key (e.g. an
   * aliased exercise name resolves to a different canonical string than
   * what was actually logged — user feedback: "sometimes the lab won't
   * show the score of the exercise... will only show the volume and 1RM
   * prediction", because the UI's name-based lookup silently failed to
   * find this result). Optional so older, already-persisted results
   * (scored before this field existed) still fall back to the previous
   * name/position matching.
   */
  exerciseIndex?: number;
}

/** What a free-tier caller may see. Premium adds oneRMBandKg, trend, suggestion. */
export interface FreeStrengthResult {
  liftKey: string;
  score: number;
  tier: StrengthTier;
  oneRM: number;
  /** Not premium-gated: an achieved best is a personal record, and records are free here (same call as race records in race-records.ts). */
  allTimeOneRM?: number;
  currentOneRM?: number;
  bodyweightRatio: number;
  nextTier: NextTierTarget | null;
  source: StrengthSource;
  flags: string[];
  premiumLocked: Array<"oneRMBandKg" | "trend" | "suggestion" | "oneRMConfidence" | "appliedFactors">;
  exerciseIndex?: number;
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
  // Bench/deadlift anchorRatio now only a fallback reference (kept in sync
  // with whichever ratio scores ~500 in WEIGHT_RATIO_ANCHOR_TABLES below) —
  // actual scoring for these two goes through the corrected anchor table
  // instead (Part G, scoring-calibration-rewrite; re-anchored again per user
  // feedback — see that table's own doc comment). Previous single-anchor
  // value (0.785, "recalibrated so 120×4/110×6/100×9 ≈ 800 @ 80kg BW") scored
  // a real bench PB (140kg @ 83kg BW) at ~850 "Elite" — a full tier more
  // generous than Strength Level's population data implies (~752, Advanced).
  bench: { anchorRatio: 81 / 83, category: "chest", bodyPart: "upperBody" },
  squat: { anchorRatio: 0.9984, category: "legs", bodyPart: "lowerBody" },
  // Deadlift was already close to accurate (200kg @ 83kg BW -> 770 vs. the
  // corrected 725) — least-urgent of the two, still corrected for
  // consistency now the table exists.
  deadlift: { anchorRatio: 128 / 83, category: "back", bodyPart: "pull" },
  ohp: { anchorRatio: 0.4213, category: "shoulders", bodyPart: "upperBody" },
  barbellRow: { anchorRatio: 0.687, category: "back", bodyPart: "pull" },
  frontSquat: { anchorRatio: 0.8103, category: "legs", bodyPart: "lowerBody" },
  // 0.64 -> 0.61 (user feedback: scoring "slightly" too low) — a ~4.7%
  // easier anchor, roughly +2 points on the 0-99.9 display scale for the
  // same lift.
  inclineBench: { anchorRatio: 0.61, category: "chest", bodyPart: "upperBody" },
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
 *
 * Re-anchored again (user feedback): Strength Level's *own* 50th percentile
 * (98kg @ 83kg BW, ~1.2x bodyweight for one rep) is the median of a
 * self-selected population of people who log serious lifts online — not the
 * median of "people who go to the gym," let alone all adults. Scoring that
 * lift a flat 475 ("just barely Semi-Pro") undersold what most people would
 * call a genuinely good bench. Fix: what used to read as Strength Level's
 * 50th percentile now scores what used to be roughly its 70-75th (650, deep
 * into Semi-Pro) — the bottom two anchors (5th/20th) move up with it so the
 * curve stays smooth. The TOP two anchors (80th/95th, 132kg/169kg bench;
 * 200kg/250kg deadlift) were left at 725/850 in that pass specifically to
 * avoid undoing an earlier fix (a 140kg PB no longer over-reading as an
 * inflated 850 "Elite").
 *
 * Re-anchored a THIRD time (user feedback, with exact reference numbers): a
 * 120x3 set (est. 1RM ~132kg) scored 724 — "should be much higher... we are
 * comparing to the average person in gym not the elite athletes" — and a real
 * 200kg deadlift scored 746, "very low for something so impressive." Same
 * root cause as the second pass, just further up the curve: 132kg/200kg are
 * Strength Level's own 80th-percentile point *within a population that
 * already only contains people logging serious lifts online* — i.e. roughly
 * the top 1% of the general population, nowhere near "just above average
 * gym-goer." Cross-checked against Mark Rippetoe's published recreational-
 * lifter standards (Starting Strength categories, an independent source
 * explicitly targeting natural/non-competitive lifters rather than
 * OpenPowerlifting/Strength-Level's online-tracked population): at ~82kg
 * bodyweight, Rippetoe's own "Advanced" bench (125kg) and "Elite" bench
 * (143kg) both sit BELOW Strength Level's raw 80th/95th percentile points
 * (132kg/169kg) — confirming those two anchors undersold what they
 * represent. Bottom three anchors (47/70/98kg bench, 78/112/152kg deadlift)
 * are untouched — already corrected in the prior pass. Top two now score
 * 850 ("Elite" tier boundary) and 950 ("World Class" territory) instead of
 * 725/850, so a genuinely rare lift among actual gym-goers reads as one.
 */
/**
 * The percentile -> index-score mapping every anchor table uses. Fixed by the
 * three bench/deadlift re-anchoring passes above and NOT re-litigated here:
 * whatever else changes, "Strength Level's 50th percentile" means 650 and
 * "their 95th" means 950 for every lift in the catalogue, so two lifts at the
 * same percentile of the same population read as the same number.
 */
const PERCENTILE_SCORES = [150, 400, 650, 850, 950] as const;

/**
 * Bodyweight the SL rows below were read off. Strength Level publishes its
 * standards indexed by bodyweight; the 80 kg male row is the one used
 * throughout, converted into this engine's ratio units by the same allometric
 * function the athlete's own lift goes through — so the table and the athlete
 * are measured with one ruler. (bench/deadlift predate this helper and were
 * read off the 83 kg row, hence their raw `/ REFERENCE_BODYWEIGHT_KG` form;
 * the two conventions agree to within ~1%, and those two are left
 * byte-identical so their pinned fixtures do not move.)
 */
const SL_ROW_BODYWEIGHT_KG = 80;

/**
 * Strength Level's five published standards for one lift, at
 * SL_ROW_BODYWEIGHT_KG, mapped onto PERCENTILE_SCORES. Order: beginner (5th),
 * novice (20th), intermediate (50th), advanced (80th), elite (95th) —
 * Strength Level's own labels for those percentiles.
 */
function slTable(kgAtRowBodyweight: readonly [number, number, number, number, number]): WeightAnchor[] {
  return kgAtRowBodyweight.map(
    (kg, i) => [relativeStrengthRatio(kg, SL_ROW_BODYWEIGHT_KG), PERCENTILE_SCORES[i]] as WeightAnchor
  );
}

/**
 * FINISHING THE TABLE MIGRATION (this pass).
 *
 * The block above promised the remaining ~20 lifts the same treatment,
 * "mechanical, repeatable". Until now they never got it, and that gap — not a
 * global calibration error — is what the athlete was feeling when they said
 * "most scores in general are scoring too low for the average gym goer".
 *
 * A single `anchorRatio` plus the shared SLOPE describes a log-linear curve.
 * A real strength distribution is not log-linear: it is wide at the bottom and
 * compressed at the top. Fitting one anchor to a five-point distribution
 * therefore mis-reads BOTH ends, and which way it errs depends on where that
 * lift's single anchor happened to be pinned — which, for most of these, was
 * one athlete's remark about one set. Measured against this file's OWN
 * percentile mapping the errors ran in both directions, and were large:
 *
 *   Pec Deck at Strength Level's 80th percentile scored 704; it should be 850.
 *   Tricep Pushdown at their 50th scored 800; it should be 650 — and any
 *     ordinary working set (60 kg x 10) pinned the scale at 999.
 *
 * So this is not a buff. It is the same percentile scale applied to the lifts
 * that never received it. Some scores rise, some fall, and every one of them
 * now says the same thing about the athlete's percentile that bench and
 * deadlift have said since Part G.
 *
 * Values are Strength Level's published male standards at 80 kg bodyweight,
 * read September 2026. Dumbbell figures there are PER dumbbell; anchors whose
 * `anchorConvention` (weight-entry.ts) is "total" are doubled here and the
 * per-hand ones are not — the comment on each group says which.
 *
 * Lifts deliberately left WITHOUT a table, so the next pass need not
 * rediscover why:
 *  - dbRow: its alias list is a mixed bag (dumbbell row, seated cable row,
 *    machine row, inverted row, face pull). A face pull and a heavy cable row
 *    are not the same movement, and a table sharp enough to be useful for one
 *    would badly misread the other. Split the aliases first, then table them
 *    separately.
 *  - tricepPress, machineChestPress and the Iso-Lateral machine family: no
 *    Strength Level population data exists for them, so there is nothing to
 *    map. They keep their documented engineering-judgement anchors.
 */
const WEIGHT_RATIO_ANCHOR_TABLES: Partial<Record<string, WeightAnchor[]>> = {
  bench: [
    [47 / REFERENCE_BODYWEIGHT_KG, 150],
    [70 / REFERENCE_BODYWEIGHT_KG, 400],
    [98 / REFERENCE_BODYWEIGHT_KG, 650],
    [132 / REFERENCE_BODYWEIGHT_KG, 850],
    [169 / REFERENCE_BODYWEIGHT_KG, 950],
  ],
  deadlift: [
    [78 / REFERENCE_BODYWEIGHT_KG, 150],
    [112 / REFERENCE_BODYWEIGHT_KG, 400],
    [152 / REFERENCE_BODYWEIGHT_KG, 650],
    [200 / REFERENCE_BODYWEIGHT_KG, 850],
    [250 / REFERENCE_BODYWEIGHT_KG, 950],
  ],

  // --- barbell compounds (total load, bar included) -----------------------
  squat: slTable([75, 101, 132, 168, 206]),
  ohp: slTable([33, 46, 62, 81, 101]),
  barbellRow: slTable([48, 66, 88, 114, 141]),
  barbellCurl: slTable([22, 33, 46, 63, 80]),

  // --- machines and cables (total load on the stack / sled) ---------------
  latPulldown: slTable([47, 64, 85, 108, 133]),
  pecDeck: slTable([42, 63, 89, 119, 152]),
  legExtension: slTable([48, 72, 103, 140, 180]),
  legCurl: slTable([30, 46, 66, 90, 116]),
  calfRaise: slTable([49, 88, 141, 207, 282]),
  tricepPushdown: slTable([22, 36, 56, 80, 107]),
  /**
   * Leg press — the 7.2x overshoot the iso-lateral pass documented and left.
   * With no anchor and no alias it fell to DEFAULT_GENERIC_ANCHOR, so an
   * ordinary 230 kg working set (Strength Level's MEDIAN) pinned the scale at
   * 999, while input-guards.ts simultaneously knew leg presses run to
   * 600-800 kg. The guard layer and the scoring layer now agree.
   */
  legPress: slTable([109, 162, 230, 309, 395]),
  hackSquat: slTable([63, 102, 152, 213, 280]),
  hipThrust: slTable([56, 96, 149, 213, 285]),

  // --- dumbbells, DOUBLED: these anchors are calibrated on TOTAL load ------
  flatDbPress: slTable([38, 56, 80, 106, 136]),
  inclineDbPress: slTable([44, 58, 78, 100, 124]),
  dbShoulderPress: slTable([30, 44, 62, 84, 108]),
  dbShrug: slTable([34, 56, 88, 126, 168]),

  // --- dumbbells, NOT doubled: anchorConvention is perHand -----------------
  lateralRaise: slTable([5, 10, 16, 25, 34]),
  dbCurl: slTable([8, 14, 22, 32, 42]),
  hammerCurl: slTable([11, 16, 24, 33, 42]),
  /**
   * Single-arm pushdown — the one table in this file that is deliberately NOT
   * a percentile mapping, at the athlete's explicit direction. Read the
   * trade-off before changing it.
   *
   * History. The original anchor put a 1RM of 12.7 kg per arm at the 500
   * mark, so an ordinary 20 kg x 10 read 876 ("Elite") and 35 kg x 8 pinned
   * at 999 — a perfect score for a light isolation movement. That was a real
   * defect. Replacing it with a derived percentile table (55% of the two-arm
   * standard) fixed the pin but took a 15 kg x 12 working set down to ~50.
   *
   * The athlete's instruction: "change the way this is scored, e.g. 15 x 12
   * still scores fairly highly at 65-70 but then the score increases up
   * slowly as the weight gets heavier." So the curve is intentionally
   * front-loaded and then compressed: a real working set is credited
   * properly, and getting from there to a heavy single earns progressively
   * less. Measured through the engine: 15x12 -> 67, 20x10 -> 75, 25x10 -> 85,
   * 30x8 -> 87, 35x8 -> 89, 45x6 -> 93. The 999 pin stays gone.
   *
   * THE COST, stated plainly because nothing else in this file pays it: the
   * numbers below are no longer percentile boundaries, so any tier label
   * derived from a score on THIS movement (Advanced, Elite) overstates the
   * athlete's standing against a real population. That is confined to one
   * accessory exercise and does not touch any compound, but it is the reason
   * every other entry here stays honest to its source table.
   *
   * [9, 15, 23, 38, 68] -> the values below, every one scaled by 0.80, WHEN
   * THE ESTIMATOR WAS FIXED (strength/one-rm.ts). Precisely because this
   * table is not a percentile mapping, it cannot take the estimator
   * correction the way the honest tables do: its numbers exist only to
   * reproduce the athlete's dictated (weight x reps -> score) curve, and a
   * ~20% smaller 1RM from the same set would have silently walked all six
   * points down. 0.80 is the estimator's own change factor for this class
   * across the rep counts those points sit at — exact at 10 reps (0.800),
   * within 0.7% at 8 (0.805), 2.2% at 12 (0.783) and 3.7% at 6 (0.831). A
   * single scalar cannot be exact at every rep count because the correction
   * is not flat in reps; 10 is the middle of the dictated cluster.
   *
   * Measured at 83 kg / age 30 (stated, because the six numbers in the
   * paragraph above are not reproducible at any bodyweight and age tried —
   * whoever recorded them did not record the athlete they used):
   *   before  69.5 / 77.7 / 85.9 / 87.3 / 89.8 / 92.8
   *   after   68.7 / 77.7 / 85.9 / 87.4 / 89.9 / 93.6
   * for 15x12, 20x10, 25x10, 30x8, 35x8, 45x6. The front-loaded, then
   * compressed curve the athlete asked for is intact.
   */
  tricepPushdownSingleArm: slTable([7.2, 12.0, 18.4, 30.4, 54.4]),
};

const ACCESSORY_MAP: Record<string, LiftAnchor> = {
  inclineDbPress: { anchorRatio: 0.6776, category: "chest", bodyPart: "upperBody" },
  flatDbPress: { anchorRatio: 0.365, category: "chest", bodyPart: "upperBody" },
  // 0.7846 -> 0.72 (user feedback: "Chest press machine is a bit too low
  // scoring" — also fixed a missing alias so "Chest Press Machine" the
  // catalog entry, distinct from "Machine Chest Press", now actually
  // resolves here too instead of silently falling to the generic
  // DEFAULT_GENERIC_ANCHOR) — a ~8.2% easier anchor, roughly +3 points on
  // the 0-99.9 display scale for the same lift.
  machineChestPress: { anchorRatio: 0.72, category: "chest", bodyPart: "upperBody" },
  cableFly: { anchorRatio: 0.3823, category: "chest", bodyPart: "upperBody" },
  pecDeck: { anchorRatio: 0.8583, category: "chest", bodyPart: "upperBody" },
  // Calibrated (user feedback: 95kg x8 should score ~700, 125kg x8 should
  // score ~875 — "Tricep Press" had no anchor at all before this, so it was
  // silently falling through to the generic accessory fallback). 0.89 was
  // the closest single-anchor fit for both reported points under the
  // shared SLOPE constant (95x8 -> 735, 125x8 -> 840) — same "can't hit
  // both exactly, split the difference" methodology as dbCurl below.
  //
  // 0.89 -> 0.7601 (x 0.8541) IN ORDER TO CHANGE NOTHING. This lift has no
  // Strength Level table — its only calibration evidence is the athlete's two
  // reported (weight x reps -> score) points, and those points were fitted
  // through the old, inflated estimator. Re-fixing the estimator without
  // moving the anchor would answer a question that was already settled, using
  // a set the athlete never re-reported on. 0.8541 is exactly the estimator's
  // own change factor at 8 reps for this class (1.2346 / 1.4455), so both
  // reported points hold. The lifts that DO have population tables take the
  // correction; this one has nothing to take it against.
  tricepPress: { anchorRatio: 0.7601, category: "arms", bodyPart: "upperBody" },
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
  // (A duplicate `singleArmPushdown` anchor lived here, unreachable: the only
  // name that could reach it, "single arm pushdown", is claimed by
  // LIFT_ALIASES for tricepPushdownSingleArm, which wins over the derived
  // alias. Two anchors for one movement can only drift apart, so the dead one
  // is gone rather than left to be found and "fixed" later.)
  dbShoulderPress: { anchorRatio: 0.216, category: "shoulders", bodyPart: "upperBody" },
  // 0.1525 -> 0.145 (user feedback: "cable lat raise" scoring "slightly"
  // too low) — a ~4.9% easier anchor, roughly +2 points on the 0-99.9
  // display scale for the same lift. Shared by every lateral-raise variant
  // (cable/machine/front raise/rear delt work — see the alias list below).
  lateralRaise: { anchorRatio: 0.145, category: "shoulders", bodyPart: "upperBody" },
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

  // -------------------------------------------------------------------------
  // Previously anchor-less. Each of these is a mainstream catalogue exercise
  // (COMMON_EXERCISES in lib/constants/sports.ts) that had no anchor AND no
  // alias, so every logged set fell to DEFAULT_GENERIC_ANCHOR — one
  // barbell-shaped 0.35 shared by sixty-odd movements at once. `anchorRatio`
  // here is the ratio that scores 500 on each lift's own anchor table, kept in
  // step with it so the fallback and the table cannot disagree; the table is
  // what actually scores them.
  // -------------------------------------------------------------------------
  legPress: { anchorRatio: 2.3348, category: "legs", bodyPart: "lowerBody" },
  hackSquat: { anchorRatio: 1.5054, category: "legs", bodyPart: "lowerBody" },
  hipThrust: { anchorRatio: 1.4460, category: "legs", bodyPart: "lowerBody" },
  dbShrug: { anchorRatio: 0.8488, category: "back", bodyPart: "pull" },

  // -------------------------------------------------------------------------
  // Iso-Lateral (Hammer Strength) plate-loaded machines — their OWN anchors.
  //
  // These used to alias onto the nearest free-weight/cable sibling (high row
  // -> dbRow, shoulder press -> dbShoulderPress, ...). That was wrong twice
  // over, and both errors pushed the score the same way — up:
  //
  //  1. CONVENTION. An iso-lateral machine is loaded PER ARM; a dumbbell-row
  //     anchor is defined on the TOTAL of both dumbbells. dbRow's anchor is
  //     0.4524, i.e. a ~37.6kg total 1RM at the 83kg reference — around 19kg
  //     per hand. Judging a plate-loaded machine carrying 100kg PER SIDE
  //     against that is not a calibration error, it's a category error.
  //     Fixed on the input side too: EXERCISE_LOAD_CONFIG (weight-entry.ts)
  //     now defaults these to per-hand entry with a Total option, the same
  //     convention machinery the carries use, and these anchors are all
  //     defined on TOTAL load so the two agree.
  //  2. EQUIPMENT. A fixed machine on rails supports the load, fixes the
  //     path and removes every stabiliser demand a dumbbell row imposes, so
  //     the same athlete moves far more weight on it. Sharing the dumbbell's
  //     anchor credited that extra weight as extra strength.
  //
  //  Reported symptom: Iso-Lateral High Row 100kg x 8 scored 999/1000 —
  //  literally the top of the scale, out-scoring the athlete's own barbell
  //  squat and deadlift, for an ordinary working set.
  //
  // Separate anchor keys (rather than more aliases) also fix a third defect
  // for free: EXERCISE_ATTACHMENTS in strength/attachments.ts is keyed by
  // resolved anchor key, so aliasing to dbRow/latPulldown made these fixed
  // machines offer cable attachments (v-bar / wide bar / single handle) they
  // physically do not have. No attachment entry exists for these keys, so
  // the picker correctly disappears.
  //
  // Anchor values: anchorRatio x 83kg = the TOTAL-load 1RM scoring 500. Set
  // from typical plate-loaded machine loading (20kg plates per side), and
  // cross-checked so that no machine out-scores a comparable barbell lift at
  // the same relative effort. Engineering judgment, not population data —
  // there is no Strength Level table for Hammer Strength machines — so treat
  // them the same way as this file's other documented estimates and refine
  // as real logged data accumulates.
  isoLateralRow: { anchorRatio: 1.59, category: "back", bodyPart: "pull" },
  isoLateralPulldown: { anchorRatio: 1.325, category: "back", bodyPart: "pull" },
  isoLateralChestPress: { anchorRatio: 1.205, category: "chest", bodyPart: "upperBody" },
  isoLateralShoulderPress: { anchorRatio: 0.771, category: "shoulders", bodyPart: "upperBody" },
  isoLateralLegPress: { anchorRatio: 2.41, category: "legs", bodyPart: "lowerBody" },
  isoLateralLegExtension: { anchorRatio: 0.964, category: "legs", bodyPart: "lowerBody" },
  isoLateralLegCurl: { anchorRatio: 0.771, category: "legs", bodyPart: "lowerBody" },
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
  "machine chest press": "machineChestPress", "chest press machine": "machineChestPress",
  // Was aliased to "machineChestPress" — a barbell squat variant scored on a
  // chest-press anchor. A Smith squat is a back squat on rails; the fixed bar
  // path makes it marginally easier than free, nowhere near enough to justify
  // a different movement's standard.
  "smith machine squat": "squat",
  // Plate-loaded squat/press machines. None of these had an alias at all, so
  // all four shared DEFAULT_GENERIC_ANCHOR with the planks and the sit-ups.
  // Pendulum and belt squat have no published standards of their own and take
  // the hack squat's, the closest machine Strength Level does cover — an
  // approximation, and a far smaller one than 0.35 was.
  "leg press": "legPress",
  "hack squat": "hackSquat", "hack squat machine": "hackSquat",
  "pendulum squat": "hackSquat", "belt squat": "hackSquat",
  "hip thrust": "hipThrust", "barbell glute bridge": "hipThrust",
  "dumbbell shrug": "dbShrug",
  // Iso-Lateral (Hammer Strength) machines. These used to alias onto the
  // nearest free-weight/cable sibling (dbRow, dbShoulderPress, ...), which
  // both mismatched the per-arm loading convention and credited a supported
  // machine as if it were a dumbbell — see the ISO-LATERAL block in
  // PRIMARY/ACCESSORY_MAP above for the full reasoning. They now resolve to
  // their own anchors, calibrated on total load, with no attachment options.
  "iso-lateral chest press": "isoLateralChestPress",
  "iso-lateral incline press": "isoLateralChestPress",
  "iso-lateral decline press": "isoLateralChestPress",
  "iso-lateral shoulder press": "isoLateralShoulderPress",
  "iso-lateral row": "isoLateralRow",
  "iso-lateral high row": "isoLateralRow",
  "iso-lateral low row": "isoLateralRow",
  // Same machine family, catalogued under the manufacturer's name rather
  // than the "Iso-Lateral" range name — it was falling through to
  // DEFAULT_GENERIC_ANCHOR entirely.
  "hammer strength row": "isoLateralRow",
  "iso-lateral wide pulldown": "isoLateralPulldown",
  "iso-lateral front pulldown": "isoLateralPulldown",
  // Was the one member of the family with no alias at all, so it landed on
  // DEFAULT_GENERIC_ANCHOR (0.35) — a barbell-shaped anchor for a machine
  // that moves several hundred kg.
  "iso-lateral leg press": "isoLateralLegPress",
  "iso-lateral leg extension": "isoLateralLegExtension",
  "iso-lateral leg curl": "isoLateralLegCurl",
  "cable fly": "cableFly", "low-to-high cable fly": "cableFly", "high-to-low cable fly": "cableFly",
  "dumbbell fly": "cableFly", "incline dumbbell fly": "cableFly",
  "pec deck": "pecDeck",
  "rope pushdown": "tricepPushdown", "tricep pushdown": "tricepPushdown", "tricep extension": "tricepPushdown",
  // The catalogue entry is "Single Arm Pushdown", but the athlete's own words
  // for it were "single arm tricep pushdowns" — typed as a custom exercise,
  // that spelling missed every alias and landed on DEFAULT_GENERIC_ANCHOR, so
  // the same movement scored hundreds of points differently depending on how
  // it was typed. Cover the obvious spellings.
  "single arm pushdown": "tricepPushdownSingleArm",
  "single arm tricep pushdown": "tricepPushdownSingleArm",
  "single arm tricep extension": "tricepPushdownSingleArm",
  "single arm rope pushdown": "tricepPushdownSingleArm",
  "one arm pushdown": "tricepPushdownSingleArm",
  "one arm tricep pushdown": "tricepPushdownSingleArm",
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

  // Variants of an already-calibrated barbell lift that had no alias, so they
  // sat in the generic bucket and were scored on a different curve from the
  // movement they ARE. With the primaries now on anchor tables that gap became
  // absurd rather than merely sloppy — at 60 kg x 8 a Zercher Squat read 542
  // against the Squat's 234, and a Floor Press 726 against the Bench Press's
  // 542. A variant should never out-score its own parent lift at the same
  // load; if anything each of these is marginally harder than the parent.
  "zercher squat": "squat", "safety bar squat": "squat",
  "spoto press": "bench", "floor press": "bench",
  "pin press": "ohp",
  "deficit deadlift": "deadlift", "block pull": "deadlift", "jefferson deadlift": "deadlift",
  "landmine row": "barbellRow",
  "incline dumbbell curl": "dbCurl",
  "overhead cable extension": "tricepPushdown",
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
  // Compound categories are pinned to the 500-point of that pattern's own
  // now-tabled reference lift, so a category fallback can never be softer
  // than the calibrated movement it stands in for.
  "chest:compound": { anchorRatio: 0.9783, category: "chest", bodyPart: "upperBody" }, // bench's 500-point
  "chest:accessory": { anchorRatio: 0.3823, category: "chest", bodyPart: "upperBody" }, // cableFly — a pullover/Svend press is a fly-shaped movement
  "back:compound": { anchorRatio: 0.9237, category: "back", bodyPart: "pull" }, // barbellRow's 500-point
  "back:accessory": { anchorRatio: 0.4524, category: "back", bodyPart: "pull" },
  /**
   * Legs compound is deliberately NOT squat's 1.4004 500-point. What is left
   * in this bucket after the aliases above is single-leg work and the
   * Olympic lifts — a power clean is ~60-65% of a back squat and a single-leg
   * press is loaded per leg. Held at the squat's OLD single-anchor value,
   * which lands about 70% of the new squat 500-point: the right neighbourhood
   * for both, and honest about being a compromise across a mixed bucket.
   */
  "legs:compound": { anchorRatio: 0.9984, category: "legs", bodyPart: "lowerBody" },
  "legs:accessory": { anchorRatio: 0.5, category: "legs", bodyPart: "lowerBody" },
  "shoulders:compound": { anchorRatio: 0.6471, category: "shoulders", bodyPart: "upperBody" }, // ohp's 500-point
  "shoulders:accessory": { anchorRatio: 0.1525, category: "shoulders", bodyPart: "upperBody" },
  "arms:compound": { anchorRatio: 0.6395, category: "arms", bodyPart: "upperBody" },
  "arms:accessory": { anchorRatio: 0.3197, category: "arms", bodyPart: "upperBody" },
  /**
   * Core was the one category the flat 0.35 was too GENEROUS for, and routing
   * it here at 0.25 would have made that worse, not better: a 60kg cable
   * crunch — an ordinary working set — pinned the scale at 999 either way.
   * 0.50 puts a 60kg loaded-core 1RM near 650 and a 20kg weighted sit-up
   * near 230. Engineering judgement: Strength Level has no cable/machine
   * crunch table, and this bucket mixes loaded crunches with bodyweight
   * movements that log no weight at all (those already exit early through
   * the no-valid-set path and are unaffected).
   */
  "core:compound": { anchorRatio: 0.75, category: "core", bodyPart: "lowerBody" },
  "core:accessory": { anchorRatio: 0.50, category: "core", bodyPart: "lowerBody" },
};
const DEFAULT_GENERIC_ANCHOR: LiftAnchor = { anchorRatio: 0.35, category: "other", bodyPart: "upperBody" };

/**
 * Catalogue name -> its category/kind, so an exercise the athlete picked from
 * the app's own list can inherit a movement-pattern anchor instead of the flat
 * generic one. Built once at module load from the single source of truth
 * (COMMON_EXERCISES) rather than duplicated here, so a new catalogue entry is
 * scored sensibly the day it is added, not the day someone remembers to add a
 * second list entry for it.
 *
 * `sports.ts` imports nothing from `scoring/`, so this direction of dependency
 * adds no cycle.
 */
const CATALOGUE_CATEGORY_BY_NAME: Record<string, { category: string; kind: "compound" | "accessory" }> =
  Object.fromEntries(
    COMMON_EXERCISES.map((ex) => [normalizeName(ex.name), { category: ex.category, kind: ex.kind }])
  );

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

/**
 * Movement taxonomy (Part D). It is still threaded through the scoring path
 * and still classifies every anchored lift correctly, but READ THIS BEFORE
 * ASSUMING IT DOES ANYTHING: it no longer selects a 1RM coefficient, because
 * there is only one rep→1RM curve now. See strength/one-rm.ts — the per-class
 * Epley k values it used to pick (22 for accessory, 15 for isolation) had no
 * published basis and were the largest term in a 6-28% over-read of every
 * logged set.
 *
 * Kept rather than deleted: the classification itself is sound and is the
 * obvious place to hang a per-class curve if one is ever earned from real
 * data. Hoeger et al. (1990) is evidence that per-exercise curves DO exist —
 * it just measured them running the opposite way from these k values.
 */
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
  hackSquat: "accessory",
  hipThrust: "accessory",
  dbShrug: "accessory",
  // Iso-Lateral machines: "accessory" matches their calibrated machine
  // siblings (machineChestPress, dbRow, legExtension) rather than the
  // "compound" class the barbell lifts use — the rep-to-1RM curve on a
  // supported, fixed-path machine is closer to a machine press than to a
  // free-standing squat.
  isoLateralRow: "accessory",
  isoLateralPulldown: "accessory",
  isoLateralChestPress: "accessory",
  isoLateralShoulderPress: "accessory",
  isoLateralLegPress: "accessory",
  isoLateralLegExtension: "accessory",
  isoLateralLegCurl: "accessory",
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
};

export function exerciseClassFor(resolvedKey: string): ExerciseClass {
  return EXERCISE_CLASS[resolvedKey] ?? "accessory";
}

/**
 * USA Powerlifting's Foster age coefficients for junior lifters — the
 * published other half of an age curve this engine only ever had the top of.
 *
 * The curve below was flat at 1.0 for every age at or under 35, so a
 * 19-year-old was scored against a 30-year-old's standard while a 50-year-old
 * received 11% of credit. That asymmetry is not what the data says. Foster's
 * premise is explicit and is the same one the masters half rests on: maximal
 * strength peaks between roughly 23 and 40 and falls away on BOTH sides of
 * that window. A junior is not merely untrained-for-their-age; they are
 * pre-peak.
 *
 * Cross-checked against Strength Level's own by-age tables — the same dataset
 * the anchors above come from — which put the 20-24 male bench standards about
 * 2-2.5% under the 25-39 peak (intermediate 94 kg vs 96 kg, advanced 124 kg vs
 * 127 kg). Foster says 1.03 at age 20. Two independent sources, one
 * competitive and one observational, agreeing to within half a percent is as
 * good as this file's evidence gets.
 *
 * The effect is deliberately small — 4% of ratio at 19, about +15 index points
 * on a log-formula lift. "Slightly higher", which is what was asked for, and
 * it moves nobody over 23.
 */
const JUNIOR_AGE_COEFFICIENTS: Record<number, number> = {
  14: 1.23,
  15: 1.18,
  16: 1.13,
  17: 1.08,
  18: 1.06,
  19: 1.04,
  20: 1.03,
  21: 1.02,
  22: 1.01,
};
/** Foster's table starts at 14; anything younger is held there rather than extrapolated off the end of published data. */
const YOUNGEST_TABULATED_AGE = 14;

/**
 * Age curve, applied as a multiplier on the athlete's ratio (equivalently: the
 * anchor gets easier). Foster junior coefficients below 23, flat through the
 * 23-35 peak, then the gentle masters climb.
 *
 * The masters half is unchanged: an ESTIMATE derived from Legion's
 * strength-by-age chart — refine with published McCulloch/Masters coefficients
 * (see roadmap). Verified: a 50-year-old benching the same 140kg as a
 * 25-year-old scores ~11% higher on the ratio (890 vs 850, still comfortably
 * inside the same Elite band — "gentle," not tier-jumping).
 *
 * Note the two halves disagree slightly about where the peak ENDS: Foster (and
 * McCulloch) put it at 40, this curve starts easing at 35. Left alone — moving
 * it would LOWER the score of every athlete aged 36-40, which is a separate
 * decision with its own evidence to gather, not a side effect of crediting
 * juniors.
 */
export function ageFactor(age: number): number {
  if (age < 23) return JUNIOR_AGE_COEFFICIENTS[Math.max(Math.floor(age), YOUNGEST_TABULATED_AGE)] ?? 1.0;
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

/**
 * [EST] Ceiling for a lift scored against a GENERIC anchor rather than a
 * calibrated one.
 *
 * 724 is the top of the Semi-Pro band — the highest tier that does not claim
 * the athlete is exceptional. An unrecognised movement can be scored as a good
 * lift and cannot be scored as a world-class one, because nothing in the engine
 * knows what the movement is.
 */
const GENERIC_ANCHOR_MAX_SCORE = 724;
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

/**
 * THE +6% SUB-MAX BIAS CORRECTION IS GONE. It used to multiply every
 * formula-derived 1RM from a set of four reps or more (bodyweight-relative
 * and isolation lifts excepted) on the premise that a sub-maximal set reads
 * ~3-14% low against a truly tested max.
 *
 * The premise is not wrong about physiology. It is wrong about what is being
 * compared. Every anchor table below is Strength Level's published standards,
 * and those standards are built from the ordinary logged sets of Strength
 * Level's own users, converted by Strength Level's own rep table. Whatever
 * under-reading affects a set logged here affects the population it is being
 * ranked against, identically, and cancels. Applying the correction to one
 * side of that comparison and not the other was a flat 6% handout on top of
 * the estimator over-read documented in strength/one-rm.ts — the two stacked.
 *
 * Near-max evidence (`hasLowRepData`) still matters, and still does what it
 * always did: it raises `oneRMConfidence` and widens or narrows the reported
 * band. It just no longer moves the estimate itself.
 */

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

  // Catalogue exercise with no anchor of its own: inherit its movement
  // pattern's anchor rather than the flat DEFAULT_GENERIC_ANCHOR. Still
  // `source: "generic"` — a weaker claim than a calibrated anchor, and the
  // "estimated-generic-standard" flag must keep saying so — but "a legs
  // compound" is a far better guess about a Hip Thrust than "0.35".
  const catalogued = CATALOGUE_CATEGORY_BY_NAME[key];
  if (catalogued) {
    return {
      anchor: genericAnchorForCategory(catalogued.category, catalogued.kind),
      source: "generic",
      resolvedKey: key,
    };
  }

  // Genuinely unknown name (a custom exercise the athlete typed). Degrades to
  // the flat generic rather than throwing — pinned by test, and correct.
  return { anchor: DEFAULT_GENERIC_ANCHOR, source: "generic", resolvedKey: key };
}

/** Resolve a generic (non-anchored, non-aliased) exercise via its catalog category/kind. Used by the adapter layer, not the engine itself. */
export function genericAnchorForCategory(category: string, kind: "compound" | "accessory"): LiftAnchor {
  return GENERIC_CATEGORY_ANCHORS[`${category}:${kind}`] ?? DEFAULT_GENERIC_ANCHOR;
}

/**
 * The resolved anchor key for a free-text exercise name (e.g. "Tricep
 * Pushdown" -> "tricepPushdown") — exported so callers outside the engine
 * (the attachment picker's option lookup, UI code that needs to know which
 * canonical lift an athlete is looking at) resolve names identically to
 * scoreStrength() itself, rather than re-implementing the alias chain.
 */
export function resolveAnchorKey(exerciseName: string): string {
  return resolveLiftAnchor(exerciseName).resolvedKey;
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
  effectiveAgeFactor: number,
  attachmentMultiplier: number
): NextTierTarget | null {
  const currentIdx = TIER_THRESHOLDS.findIndex((t) => t.tier === tierForScore(score));
  if (currentIdx === -1 || currentIdx === TIER_THRESHOLDS.length - 1) return null;
  const next = TIER_THRESHOLDS[currentIdx + 1];
  const targetEffectiveRatio = inverseInterpolateWeightAnchors(table, next.min);
  const targetRatio =
    (targetEffectiveRatio * effectiveSexFactor * attachmentMultiplier) / effectiveAgeFactor;
  const targetOneRM = oneRMForRatio(targetRatio, bodyweightKg);
  const kgNeeded = Math.max(0, targetOneRM - currentOneRM);
  return { tier: next.tier, kgNeeded: round1(kgNeeded) };
}

// ---------------------------------------------------------------------------
// History-derived 1RMs — the premium scoring blend, plus the all-time/current
// split every tier sees (see the file header for what each number means)
// ---------------------------------------------------------------------------

interface AdaptiveEstimate {
  oneRM: number;
  confidence: number;
  trend: StrengthTrend | null;
  band: [number, number];
}

/** The two athlete-facing 1RMs — see the file header. */
export interface OneRMSplit {
  allTimeOneRM: number;
  currentOneRM: number;
}

/** One logged set reduced to an estimated 1RM, tagged with when it happened. */
interface DatedEstimate {
  e1rm: number;
  daysAgo: number;
  reps: number;
  /** Session identity — every set logged in one session shares its `performedAt`. */
  performedAt: string;
}

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

/** Days between `performedAt` and `now`, treating an unparseable timestamp as today rather than letting a NaN poison every average downstream of it. */
function daysSince(performedAt: string, now: number): number {
  const at = new Date(performedAt).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, (now - at) / 86_400_000);
}

function e1rmSeries(
  sets: LoggedSet[],
  now: number,
  bodyweightKg: number,
  isBodyweightRelative: boolean,
  exerciseClass: ExerciseClass,
  weightEntryMode?: WeightEntryMode,
  exerciseName?: string,
  loadFraction = 1.0
): DatedEstimate[] {
  return sets.map((s) => ({
    e1rm: estimate1RMFromSet(
      effectiveSetWeight(s.weightKg, weightEntryMode, exerciseName),
      s.reps,
      exerciseClass,
      isBodyweightRelative,
      bodyweightKg,
      loadFraction,
      s.repsInReserve
    ),
    daysAgo: daysSince(s.performedAt, now),
    reps: s.reps,
    performedAt: s.performedAt,
  }));
}

/** Near-max evidence: a set at 3 reps or fewer, which is what anchors a rep-formula estimate. */
function hasLowRepData(series: DatedEstimate[]): boolean {
  return series.some((s) => s.reps <= 3);
}

/**
 * Blends the heaviest e1RM ever logged (a real achieved data point) with a
 * recency- and intensity-weighted average across the full history. Constants
 * here are engineering judgment calls, not lab-derived — the point is a
 * materially better estimate than a single set, not a precise one.
 *
 * `nearMaxEvidence` used to also scale the estimate up when absent (the +6%
 * sub-max correction, removed — see its note above). It now only feeds
 * confidence, and through confidence the reported band.
 */
function adaptiveOneRM(
  series: DatedEstimate[],
  nearMaxEvidence: boolean
): AdaptiveEstimate {
  const weighted = series.map((s) => {
    const recencyWeight = Math.exp(-s.daysAgo / 180); // ~6-month half-life
    const repWeight = s.reps <= 3 ? 1.0 : s.reps <= 6 ? 0.8 : s.reps <= 10 ? 0.55 : 0.35;
    return { e1rm: s.e1rm, daysAgo: s.daysAgo, weight: recencyWeight * repWeight };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0) || 1;
  const weightedAvg = weighted.reduce((sum, w) => sum + w.e1rm * w.weight, 0) / totalWeight;
  const maxE1rm = Math.max(...weighted.map((w) => w.e1rm));

  const oneRM = maxE1rm * 0.6 + weightedAvg * 0.4;

  const confidence = clamp(
    0.5 + Math.min(weighted.length, 10) * 0.03 + (nearMaxEvidence ? 0.15 : 0),
    0,
    0.97
  );
  const band: [number, number] = [
    round1(oneRM * (1 - (1 - confidence) * 0.25)),
    round1(oneRM * (1 + (1 - confidence) * 0.15)),
  ];

  let trend: StrengthTrend | null = null;
  if (weighted.length >= 4) {
    // Oldest first. The caller's history arrives in whatever order the rows
    // came back from the database, and "early third vs recent third" is
    // meaningless — occasionally backwards — read off an unsorted array.
    const chronological = [...weighted].sort((a, b) => b.daysAgo - a.daysAgo);
    const third = Math.max(1, Math.floor(chronological.length / 3));
    const early = chronological.slice(0, third).reduce((s, w) => s + w.e1rm, 0) / third;
    const recent = chronological.slice(-third).reduce((s, w) => s + w.e1rm, 0) / third;
    const delta = (recent - early) / early;
    trend = delta > 0.03 ? "up" : delta < -0.03 ? "down" : "flat";
  }

  return { oneRM, confidence, trend, band };
}

/**
 * Half-life (days) of the recency decay behind `currentOneRM`. ESTIMATE, not
 * lab-calibrated: detraining work puts the onset of measurable loss of
 * maximal strength somewhere around 2–4 weeks off training, and a training
 * block typically runs 3–6 weeks, so three weeks keeps the block the athlete
 * is actually in dominant while a session from six weeks ago still counts for
 * a quarter of a session logged today.
 *
 * Deliberately far shorter than the 180-day constant in adaptiveOneRM above:
 * that number answers "how strong is this athlete", this one answers "how
 * strong are they right now", and those two questions want different memories.
 */
const CURRENT_ONE_RM_HALF_LIFE_DAYS = 21;

/**
 * Both athlete-facing 1RMs, derived from the same set history on every
 * scoring pass rather than stored — a high-water mark recomputed from the
 * sets can never disagree with them, needs no backfill, and stays correct
 * when a mis-logged session is edited or deleted.
 *
 * `currentOneRM` averages SESSION bests, not every set: warm-ups and back-off
 * sets say nothing about what the athlete could manage that day, and letting
 * them into the mean would make simply doing more volume look like getting
 * weaker. Because the newest session always carries the largest decay weight,
 * a session below the running estimate necessarily drags it down — that
 * property is the whole reason this number exists.
 */
function splitOneRM(series: DatedEstimate[]): OneRMSplit {
  const bestPerSession = new Map<string, DatedEstimate>();
  for (const s of series) {
    const previous = bestPerSession.get(s.performedAt);
    if (!previous || s.e1rm > previous.e1rm) bestPerSession.set(s.performedAt, s);
  }
  const sessions = [...bestPerSession.values()];
  if (sessions.length === 0) return { allTimeOneRM: 0, currentOneRM: 0 };

  const allTimeOneRM = Math.max(...sessions.map((s) => s.e1rm));

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of sessions) {
    const weight = 0.5 ** (s.daysAgo / CURRENT_ONE_RM_HALF_LIFE_DAYS);
    weightedSum += s.e1rm * weight;
    totalWeight += weight;
  }

  // Every session old enough for its decay weight to underflow to zero (~60
  // years): report the high-water mark rather than dividing by nothing.
  const currentOneRM = totalWeight > 0 ? weightedSum / totalWeight : allTimeOneRM;

  return { allTimeOneRM, currentOneRM };
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

  const now = Date.now();
  const historySeries = e1rmSeries(
    history,
    now,
    bodyweightKg,
    isBodyweightRelative,
    exerciseClass,
    input.weightEntryMode,
    exerciseName,
    loadFraction
  );
  // latestSet.weightKg arrives already resolved to a scoring weight by the
  // caller, while history sets do not — putting it through effectiveSetWeight
  // as well would double a per-hand dumbbell load. It is appended rather than
  // assumed to be in `history`: for a freshly logged session the row doesn't
  // exist yet, and on an edit or a merge the caller deliberately excludes it.
  const latestEstimate: DatedEstimate = {
    e1rm: estimate1RMFromSet(
      latestSet.weightKg,
      latestSet.reps,
      exerciseClass,
      isBodyweightRelative,
      bodyweightKg,
      loadFraction,
      latestSet.repsInReserve
    ),
    daysAgo: input.latestSetPerformedAt ? daysSince(input.latestSetPerformedAt, now) : 0,
    reps: latestSet.reps,
    performedAt: input.latestSetPerformedAt ?? new Date(now).toISOString(),
  };
  const fullSeries = [...historySeries, latestEstimate];
  const split = splitOneRM(fullSeries);

  let oneRM: number;
  let oneRMConfidence: number;
  let trend: StrengthTrend | null = null;
  let oneRMBandKg: [number, number] | null = null;

  if (isPremium && history.length > 0) {
    const nearMaxEvidence = hasLowRepData(historySeries);
    const adaptive = adaptiveOneRM(historySeries, nearMaxEvidence);
    oneRM = adaptive.oneRM;
    oneRMConfidence = adaptive.confidence;
    trend = adaptive.trend;
    oneRMBandKg = adaptive.band;
  } else {
    oneRM = latestEstimate.e1rm;
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
      allTimeOneRM: 0,
      currentOneRM: 0,
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

  const attachmentMultiplier = resolveAttachmentMultiplierByKey(resolvedKey, input.attachment);
  if (attachmentMultiplier !== 1.0) {
    effectiveAnchor *= attachmentMultiplier;
    appliedFactors.push(`attachment:${input.attachment} ×${attachmentMultiplier}`);
    flags.push("attachment-adjusted");
  }

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

  // Gated on the factor, not on `age > 35`. The old test asked whether the
  // athlete was a MASTER; it therefore threw away every junior coefficient
  // ageFactor() now returns, silently, with no flag to show for it. Ask the
  // curve instead, and it credits both ends of it.
  if (age != null && Number.isFinite(age)) {
    const factor = ageFactor(age);
    if (factor !== 1) {
      effectiveAnchor /= factor;
      effectiveAgeFactor = factor;
      appliedFactors.push(`age:${age} ×${factor.toFixed(3)} standard (beta)`);
      flags.push("age-factor-beta");
    }
  }

  const ratio = relativeStrengthRatio(oneRM, bodyweightKg);
  const weightAnchorTable = WEIGHT_RATIO_ANCHOR_TABLES[resolvedKey];

  let score: number;
  let nextTier: NextTierTarget | null;

  if (weightAnchorTable) {
    // Bench/deadlift (Part G, scoring-calibration-rewrite): scored via
    // direct interpolation across Strength-Level-derived anchors rather
    // than the single-anchorRatio log formula — see WEIGHT_RATIO_ANCHOR_TABLES.
    // The attachment multiplier makes the ANCHOR harder in the log path; the
    // table path has no single anchor to scale, so the equivalent is to
    // deflate the athlete's ratio by it. Without this line the table path
    // ignored attachments entirely — invisible while only bench and deadlift
    // had tables (neither has attachments), a real defect the moment tricep
    // pushdown and lat pulldown get one.
    const effectiveRatio =
      ((ratio / effectiveSexFactor) * effectiveAgeFactor) / attachmentMultiplier;
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
      effectiveAgeFactor,
      attachmentMultiplier
    );
  } else {
    score = scoreFromRatio(ratio, effectiveAnchor);
    nextTier = computeNextTier(score, effectiveAnchor, bodyweightKg, oneRM);
  }

  /*
    AN EXERCISE WE CANNOT IDENTIFY CANNOT EARN A WORLD-CLASS SCORE.

    A free-text name that matches nothing in the catalogue falls through to
    DEFAULT_GENERIC_ANCHOR — ratio 0.35, i.e. "0.35 x bodyweight scores 500".
    That is a deliberately soft standard for an unknown movement, and combined
    with an uncapped curve it meant ANY invented string scored 999 at an
    ordinary load. Measured, 80 kg lifter, one exercise, 100 kg x 5:

        "unknown 500-character name"   999   "World Class"
        emoji name                     999   "World Class"
        "squat\n\n\nDROP TABLE"          999   "World Class"

    So the top of the strength scale was reachable by typing nonsense, and the
    leaderboards read these numbers directly.

    The cap is the honest reading of what a generic anchor supports: it is a
    guess at a standard, so it can say "this is a solid lift" and must not say
    "this is among the best in the world". Calibrated primary and accessory
    lifts are untouched and can still reach 999. The flag saying the standard
    was estimated was already there — this makes the score agree with it.
  */
  if (source === "generic" && score > GENERIC_ANCHOR_MAX_SCORE) {
    score = GENERIC_ANCHOR_MAX_SCORE;
    flags.push("capped-unrecognised-exercise");
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
    allTimeOneRM: round1(split.allTimeOneRM),
    currentOneRM: round1(split.currentOneRM),
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
    allTimeOneRM: result.allTimeOneRM,
    currentOneRM: result.currentOneRM,
    bodyweightRatio: result.bodyweightRatio,
    nextTier: result.nextTier,
    source: result.source,
    flags: result.flags,
    premiumLocked,
    exerciseIndex: result.exerciseIndex,
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
