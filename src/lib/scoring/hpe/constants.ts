/**
 * Hybrid Plan Engine — the single versioned constants module.
 *
 * CLAUDE-CODE-BRIEF-hybrid-plan-engine-v2.md, non-negotiable #1: "Every
 * training-logic constant lives in one versioned module, `hpe/constants.ts`.
 * No numeric literal governing training logic elsewhere." Every value here
 * carries a provenance tag so a reviewer can tell a published anchor from a
 * practitioner estimate from something still unvalidated:
 *
 *   [DATA]    published anchor / literature value
 *   [EST]     practitioner consensus, defensible but not a citation
 *   [BETA]    unvalidated — expect it to move
 *   [ASSURED] fixed by the brief itself, not a physiological claim
 *
 * Non-negotiable #2 ("generation is deterministic and stamped with the
 * constants version") is served by HPE_CONSTANTS_VERSION below: every
 * AthleteProfile and every generated plan carries it, so a plan produced
 * under one set of numbers is never silently confused with one produced
 * under another.
 *
 * Scope note: this module governs the HPE (diagnostic → emphasis → session
 * selection → prescription) path only. The brief is explicit that the four
 * engines it consumes — adaptive 1RM, race prediction, personalised HR,
 * ACWR — are not to be reimplemented, refactored or reverted, so their own
 * constants deliberately stay where they are rather than being hoisted here.
 */

/**
 * Bump on any change to a value in this file. Stamped onto every profile and
 * plan (see `constantsVersion` on AthleteProfile) — the audit trail for "why
 * did this athlete's plan change when their data didn't".
 */
export const HPE_CONSTANTS_VERSION = "2.1.0";

// ---------------------------------------------------------------------------
// Fatigue resistance (Riegel exponent)
// ---------------------------------------------------------------------------

/** [DATA] Population norm. Matches the live race-prediction engine's own RIEGEL_K_DEFAULT — deliberately the same number, sourced independently here so the diagnostic never silently inherits a change made for scoring reasons. */
/**
 * [ASSURED] Distance range, as a multiple of 5km, within which a maximal
 * effort may be extrapolated to a 5k prediction.
 *
 * Non-negotiable #6 says bound every extrapolation or refuse, and this one was
 * unbounded. Riegel is a power law: run a hard 2km and it will happily project
 * a 5k time nobody could hold, because it assumes the athlete's fatigue
 * exponent measured over two kilometres continues over five. An 18:25 runner
 * was shown a predicted 17:30 this way.
 *
 * 3km to 10km is the range Riegel is usually quoted as reliable across for a
 * 5k target. Outside it the app's own prediction engine — built from every
 * logged session rather than one effort — is the better answer.
 */
export const RIEGEL_5K_EXTRAPOLATION_RANGE_KM: readonly [number, number] = [3, 10];

export const RIEGEL_K_DEFAULT = 1.06;
/** [DATA] Below this, fatigue resistance is strong — speed, not endurance, is the limiter. */
export const RIEGEL_K_ENDURANCE_STRONG = 1.045;
/** [DATA] Above this, the athlete fades faster than typical as distance rises — endurance is the limiter. */
export const RIEGEL_K_ENDURANCE_WEAK = 1.075;
/** [ASSURED] Maximal efforts needed before a personal k is fitted at all. Fewer than this and the population value is used and labelled as such. */
export const RIEGEL_MIN_EFFORTS = 2;
/** [ASSURED] Efforts shorter than this are excluded from the k fit — a 400m time trial is a different physiological test, not a point on the same fatigue curve. */
export const RIEGEL_MIN_EFFORT_KM = 1.0;

// ---------------------------------------------------------------------------
// Aerobic decoupling (HR drift across a long effort)
// ---------------------------------------------------------------------------

/** [DATA] Below 5% drift: the base supports that duration. */
export const DECOUPLING_GOOD = 0.05;
/** [DATA] Above 10% drift: the base clearly does not support the duration being attempted. */
export const DECOUPLING_POOR = 0.1;
/** [ASSURED] A run needs at least this many per-km split+HR pairs before a first-half/second-half comparison means anything. */
export const DECOUPLING_MIN_SPLITS = 6;
/** [ASSURED] Minimum distance for a run to count as a "long effort" for decoupling. */
export const DECOUPLING_MIN_KM = 8;

// ---------------------------------------------------------------------------
// Easy-pace anchoring
// ---------------------------------------------------------------------------
// Critical implementation note 1 from the brief: easy pace must NOT be
// derived from 5k pace alone. The 5k multiplier assumes the 5k time is
// supported by a matching aerobic base; for an athlete whose own diagnostic
// says it is not, that assumption inflates easy pace by 25-35 s/km — exactly
// the grey-zone error the diagnostic elsewhere warns about.

/** [DATA] Physiological easy band as a fraction of heart-rate reserve. The ceiling comes from HR reserve, NEVER from observed behaviour — fitting it to how hard the athlete currently runs would launder an existing bad habit into a prescription. */
export const EASY_HR_FRACTION_HRR: readonly [number, number] = [0.62, 0.72];
/** [DATA] A 90-minute maximal effort, used as an aerobic anchor independent of the 5k. */
export const LONG_EFFORT_ANCHOR_S = 5400;
/** [DATA] Easy pace relative to that 90-minute effort pace. */
export const LONG_EFFORT_TO_EASY: readonly [number, number] = [1.16, 1.28];
/** [DATA] The naive anchor — 5k pace × this band. Kept for comparison, distrusted when volume adequacy is low. */
export const FIVE_K_TO_EASY: readonly [number, number] = [1.24, 1.34];
/** [EST] Spread (s/km) between anchors that warrants an explicit finding naming which one governs and why. */
export const EASY_ANCHOR_DISAGREEMENT_FLAG = 15.0;

/**
 * [EST] Plausibility bounds on easy pace, as a multiple of the athlete's own
 * 5k pace.
 *
 * A backstop, not a derivation. The three anchors are the derivation; this
 * catches the case where one of them returns something no coach would ever
 * write down. Easy running for a trained runner sits roughly 25-45% slower
 * than 5k pace — beyond about 1.5x it is not easy running, it is walking, and
 * prescribing it to someone chasing a sub-18 5k wastes the session.
 *
 * Needed because "the slowest anchor governs" has no floor of its own: one
 * badly-conditioned anchor propagates straight through to the prescription
 * precisely BECAUSE it is the slowest.
 */
export const EASY_PACE_BOUNDS_VS_5K: readonly [number, number] = [1.22, 1.5];

/**
 * [EST] Where inside the easy band to actually prescribe, for an athlete whose
 * own diagnostic says they run their easy days too hard.
 *
 * The band is a range and the athlete picks a point in it. Someone already in
 * the grey zone picks the fast end — that is what put them there — so handing
 * them the whole band hands them permission to carry on. When the diagnostic
 * has found grey-zone running AND no logged run inside the easy heart-rate
 * band, the prescription narrows to the slower portion.
 *
 * Not a change to the band itself: the anchors are unchanged, the reference
 * athlete still reproduces, and an athlete who already runs easy properly
 * still gets the full range. This only moves the point of prescription for
 * athletes whose own data says the fast end is the problem.
 */
export const GREY_ZONE_EASY_BIAS = 0.45;

// ---------------------------------------------------------------------------
// Intensity discipline
// ---------------------------------------------------------------------------

/** [DATA] Seiler. Below this share of easy running time, the athlete is in the moderate trap. */
export const EASY_FRACTION_TARGET = 0.78;
/** [EST] Percentage-point gap between pace-classified and HR-classified easy fraction that warrants naming the discrepancy. Critical implementation note 2: pace cannot see the grey zone, which is a large part of why the grey zone persists. */
export const PACE_VS_HR_DISCREPANCY_FLAG = 0.25;
/** [ASSURED] HR-classified intensity needs at least this many HR-carrying submaximal runs before it is trusted over pace. */
export const HR_INTENSITY_MIN_RUNS = 4;
/** [ASSURED] Submaximal runs with HR needed before an HR-vs-pace regression is fitted at all. */
export const HR_PACE_MODEL_MIN_POINTS = 6;
/**
 * [EST] How far outside its own fitted speed range the HR-vs-pace regression
 * may be evaluated before it must refuse. Critical implementation note 3: an
 * unbounded easy-run fit extrapolated to interval pace prescribed a heart
 * rate of 205-214 for an athlete with a measured max of 201. Bound every
 * extrapolation or refuse to make it.
 */
export const HR_PACE_MODEL_RANGE_TOLERANCE_LOW = 0.92;
export const HR_PACE_MODEL_RANGE_TOLERANCE_HIGH = 1.08;

// ---------------------------------------------------------------------------
// Volume adequacy
// ---------------------------------------------------------------------------

/**
 * [EST] Minutes/week historically associated with supporting a given 5k
 * level, keyed by 5k time in seconds. Deliberately conservative — this
 * decides whether volume or intensity is the lever, and over-stating the
 * requirement would push every athlete toward more easy miles by default.
 */
export const VOLUME_ADEQUACY_MIN_PER_WEEK: ReadonlyArray<readonly [number, number]> = [
  [900, 400],
  [1020, 320],
  [1140, 250],
  [1260, 190],
  [1380, 150],
  [1500, 120],
];
/** [EST] Below this ratio of actual to typical weekly minutes, volume — not intensity — is the highest-return lever. */
export const VOLUME_ADEQUACY_LOW = 0.7;
/** [EST] Above this ratio, volume is ample and returns come from intensity quality instead. */
export const VOLUME_ADEQUACY_HIGH = 1.4;

// ---------------------------------------------------------------------------
// Race-pace derivation
// ---------------------------------------------------------------------------

/** [DATA] Threshold pace as a multiple of 5k pace (~7% slower). */
export const THRESHOLD_PACE_MULTIPLIER = 1.07;
/** [DATA] vVO2max / 3-5min interval pace as a multiple of 5k pace. Doubles as maximal aerobic speed for the anaerobic-speed-reserve calculation below. */
export const VO2MAX_PACE_MULTIPLIER = 0.96;

// ---------------------------------------------------------------------------
// Anaerobic speed reserve (critical implementation note 0)
// ---------------------------------------------------------------------------
// The Rev 2 reference computed "speed reserve" from threshold_pace and
// vo2_pace, both fixed multiples of predicted 5k pace. It therefore evaluated
// to 0.1146 for EVERY athlete, below the low threshold, so the finding and
// its multipliers fired universally — inflating `neuromuscular` on the
// reference athlete from 0.077 to 0.116 and pulling `aerobic_base` down from
// 0.532 to 0.500, taking emphasis away from precisely the quality that
// athlete was diagnosed as lacking.
//
// Rebuilt as genuine anaerobic speed reserve: maximal SPRINT speed minus
// maximal AEROBIC speed. The sprint side is independent data the athlete
// either has logged or has not — which is what makes the metric informative
// and what makes refusing to derive it meaningful.

/** [DATA] A maximal effort at or below this distance is a sprint, not a distance effort — the source of the sprint side of the reserve. */
export const SHORT_MAX_EFFORT_MAX_KM = 0.8;
/** [ASSURED] Efforts below this are too short to time reliably from logged data. */
export const SHORT_MAX_EFFORT_MIN_KM = 0.1;
/** [EST] Anaerobic speed reserve, in m/s, below which the athlete has little neuromuscular headroom above their aerobic ceiling. Trained distance runners typically sit 3-5 m/s. */
export const SPEED_RESERVE_LOW_MS = 2.5;
/** [EST] Above this, top-end speed is ample and is not the limiter. */
export const SPEED_RESERVE_HIGH_MS = 4.5;

// ---------------------------------------------------------------------------
// Quality exposure
// ---------------------------------------------------------------------------

/** [EST] A training run faster than 5k pace × this counts as quality exposure. */
export const QUALITY_PACE_CUTOFF_MULTIPLIER = 1.1;
/** [ASSURED] Below this many logged runs, "no quality sessions" is a data gap, not a finding about the athlete. */
export const NO_QUALITY_MIN_RUNS = 8;

// ---------------------------------------------------------------------------
// Strength profile
// ---------------------------------------------------------------------------

/** [EST] Population lift ratios relative to squat. Deviations flag a limiting lift. */
export const LIFT_RATIO_NORM: Readonly<Record<string, number>> = {
  squat: 1.0,
  bench: 0.72,
  deadlift: 1.22,
};
/** [EST] More than this fraction below the norm ratio = weak lift. */
export const LIFT_RATIO_TOLERANCE = 0.1;
/** [EST] e1RM implied by 6-12 rep sets exceeding e1RM implied by 1-3 rep sets by more than this indicates a maximal-strength (neural expression) deficit. Negative beyond it indicates the opposite: neurally efficient but under-built. */
export const REP_PROFILE_NEURAL_GAP = 0.04;
/** [EST] e1RM progression below this over the lookback window = stalled. */
export const STALL_THRESHOLD_KG_PER_WEEK = 0.15;
/** [ASSURED] Weeks of lift history examined for stalling. */
export const STALL_LOOKBACK_WEEKS = 12;
/** [ASSURED] Sets at each end of the rep range needed before a rep-profile gap is computed. */
export const REP_PROFILE_MIN_SETS_PER_END = 3;
/** [ASSURED] Sets of one lift needed before stalling is assessed. */
export const STALL_MIN_SETS = 6;
/** [ASSURED] Weeks a lift's history must span before stalling is assessed — a steep two-week block says nothing about a 12-week trend. */
export const STALL_MIN_SPAN_WEEKS = 4;
/** [DATA] Epley denominator: e1RM = load × (1 + reps / this). */
export const EPLEY_DIVISOR = 30.0;
/** [ASSURED] Rep ceiling for the "low rep" (neural expression) end of the rep-profile comparison. */
export const REP_PROFILE_LOW_MAX_REPS = 3;
/** [ASSURED] Rep window for the "high rep" (muscular) end. */
export const REP_PROFILE_HIGH_REPS: readonly [number, number] = [6, 12];

// ---------------------------------------------------------------------------
// The emphasis vector
// ---------------------------------------------------------------------------

export const EMPHASIS_KEYS = [
  "aerobic_base", // easy volume, long runs
  "threshold", // tempo / cruise intervals
  "vo2max_speed", // 3-5min intervals at vVO2max
  "neuromuscular", // strides, hills, plyometrics, running economy
  "maximal_strength", // low-rep heavy work >= 85% 1RM
  "strength_endurance", // 6-12 rep hypertrophy / work-capacity work
  "weak_lift", // extra exposure to the lagging competition lift
] as const;

export type EmphasisKey = (typeof EMPHASIS_KEYS)[number];

/** Which side of the hybrid each emphasis dimension belongs to — used to decide the limiter and to split the week between cardio and gym goals. */
export const ENDURANCE_EMPHASIS_KEYS: readonly EmphasisKey[] = [
  "aerobic_base",
  "threshold",
  "vo2max_speed",
  "neuromuscular",
];
export const STRENGTH_EMPHASIS_KEYS: readonly EmphasisKey[] = [
  "maximal_strength",
  "strength_endurance",
  "weak_lift",
];

/** [EST] Nothing is ever fully abandoned — every dimension keeps at least this weight. */
export const EMPHASIS_FLOOR = 0.03;

/**
 * [EST] Named multipliers, one per diagnostic finding. Every one of these
 * must emit a plain-English finding string: brief §0d, "Every multiplier
 * must emit a plain-English finding string. Those strings are the product."
 */
export const EMPHASIS_MULTIPLIERS = {
  /** k above the weak threshold: speed is comparatively strong, endurance is the limiter. */
  enduranceLimited: { aerobic_base: 2.0, threshold: 1.4, vo2max_speed: 0.6 },
  /** k below the strong threshold: top-end speed is the limiter, not endurance. */
  speedLimited: { vo2max_speed: 1.8, neuromuscular: 1.4, aerobic_base: 0.8 },
  /** Weekly volume well below what supports this 5k level. */
  lowVolume: { aerobic_base: 1.9 },
  /** Volume ample — returns come from intensity quality. */
  ampleVolume: { threshold: 1.3, vo2max_speed: 1.3 },
  /** HR drift says the base doesn't support the duration being attempted. */
  poorDecoupling: { aerobic_base: 1.6 },
  /** The three easy-pace anchors disagree materially. */
  easyAnchorDisagreement: { aerobic_base: 1.4 },
  /** Not one logged run sits inside the physiological easy band. */
  noEasyRunsLogged: { aerobic_base: 1.5 },
  /** Easy fraction below the polarisation target. */
  greyZone: { aerobic_base: 1.3 },
  /** No structured quality anywhere in the logged history. */
  noQuality: { threshold: 1.5, vo2max_speed: 1.4 },
  /**
   * Little neuromuscular headroom above the aerobic ceiling. Touches
   * `neuromuscular` ONLY: the athlete's own k already carries the
   * speed-versus-endurance balance, so letting speed reserve also move
   * `vo2max_speed` would double-count the same claim from two directions.
   * k governs the aerobic/threshold split; speed reserve governs the
   * neuromuscular weight and nothing else.
   */
  lowSpeedReserve: { neuromuscular: 1.6 },
  /** Ample top-end speed. Genuinely informative in the other direction: sprint capacity is not this athlete's limiter, so the neuromuscular share is trimmed rather than defended. */
  ampleSpeedReserve: { neuromuscular: 0.7 },
  /** High-rep sets imply a higher e1RM than low-rep sets: the muscle is there, the neural expression is not. */
  underExpressed: { maximal_strength: 1.9, strength_endurance: 0.7 },
  /** Low-rep sets imply a higher e1RM than high-rep sets: neurally efficient but under-built. */
  underBuilt: { strength_endurance: 1.8, maximal_strength: 0.8 },
  /** A competition lift materially below its norm ratio to squat. */
  weakLift: { weak_lift: 2.5 },
  /** One or more lifts progressing below the stall threshold. */
  stalledLift: { maximal_strength: 1.2 },
} as const satisfies Record<string, Partial<Record<EmphasisKey, number>>>;

/** [ASSURED] Goal priority (0 = pure endurance, 1 = pure strength) tilts the whole vector by this factor before normalisation. */
export const PRIORITY_TILT_SCALE = 2;
/** [ASSURED] Default priority when the athlete has stated no preference — an even hybrid split. */
export const DEFAULT_GOAL_PRIORITY = 0.5;

// ---------------------------------------------------------------------------
// Data-sufficiency tiers
// ---------------------------------------------------------------------------

export interface TierRequirement {
  runs: number;
  weeks: number;
  efforts: number;
  liftSets: number;
}

/** [ASSURED] Straight from brief §0e. */
export const TIER_REQUIREMENTS: Readonly<Record<3 | 2 | 1, TierRequirement>> = {
  3: { runs: 24, weeks: 12, efforts: 2, liftSets: 40 },
  2: { runs: 12, weeks: 8, efforts: 1, liftSets: 20 },
  1: { runs: 4, weeks: 3, efforts: 0, liftSets: 6 },
};

/** [ASSURED] Confidence attached to each tier's diagnosis. Tier 0 is "no plan". */
export const TIER_CONFIDENCE: Readonly<Record<0 | 1 | 2 | 3, number>> = {
  0: 0.0,
  1: 0.45,
  2: 0.72,
  3: 0.9,
};

// ---------------------------------------------------------------------------
// Session selection (WP6)
// ---------------------------------------------------------------------------

/** [DATA] Never more than three quality endurance sessions in a week, whatever the emphasis vector says. Hard cap, applied after proportional allocation. */
export const MAX_QUALITY_ENDURANCE_SESSIONS = 3;
/** [DATA] One heavy lower-body day per week once prescribed loads exceed this fraction of 1RM. */
export const HEAVY_LOWER_BODY_LOAD_THRESHOLD = 0.82;
/**
 * [EST] Ceiling on how far the emphasis vector may pull the week away from
 * the athlete's own stated goals. The diagnostic decides what the athlete
 * NEEDS; their goals decide what they came here for. An endurance-limited
 * diagnosis tilting a lifter's week toward running is correct coaching; it
 * taking the week over is not the product.
 */
export const EMPHASIS_GOAL_TILT_MAX = 0.35;

// ---------------------------------------------------------------------------
// Prescription resolution (WP7)
// ---------------------------------------------------------------------------

/** [DATA] Pace multipliers off predicted 5k pace, used when the easy band does not govern (quality sessions). */
export const SESSION_PACE_BANDS: Readonly<Record<string, readonly [number, number]>> = {
  recovery_run: [1.35, 1.45],
  easy_run: [1.24, 1.34],
  long_run: [1.22, 1.32],
  threshold_run: [1.05, 1.09],
  interval_run: [0.96, 1.0],
  rep_run: [0.9, 0.94],
};

/** [DATA] HR-reserve fallback bands per session kind — used only when the athlete's own regression refuses (pace outside its fitted range) and always labelled as the fallback in the prescription string. */
export const SESSION_HR_RESERVE_BANDS: Readonly<Record<string, readonly [number, number]>> = {
  recovery_run: [0.5, 0.6],
  easy_run: [0.6, 0.72],
  long_run: [0.62, 0.74],
  threshold_run: [0.82, 0.88],
  interval_run: [0.9, 0.97],
  rep_run: [0.9, 0.97],
};

/** [EST] Recovery runs sit this much slower than the prescribed easy band. */
export const RECOVERY_VS_EASY: readonly [number, number] = [1.06, 1.08];
/**
 * [EST] Long-run band relative to the easy band.
 *
 * This was 0.99 on the low end, described as "may drift marginally quicker at
 * its front end". Because pace is seconds per kilometre, a multiplier below 1
 * makes the long run FASTER than easy — an athlete was shown easy 5:14-5:17
 * and a long run at 5:11-5:17, quicker at the sharp end than the easy run it
 * is supposed to be gentler than. A long run is aerobic work made hard by
 * duration, not by pace, and it should sit at easy effort or a shade below.
 */
export const LONG_RUN_VS_EASY: readonly [number, number] = [1.0, 1.04];

/**
 * [EST] How much longer the long run must be than the week's other easy runs.
 *
 * The share fell back to `1 / slots` in low-frequency weeks, to stop a long
 * run coming out shorter than an easy one. It overcorrected into identical:
 * at two running slots both sessions got exactly 50% of the week, which is how
 * an athlete ended up with a 6.5km easy run and a 6.7km "long" run. If the
 * long run is not distinctly the longest session of the week it is not a long
 * run, it is a second easy run wearing the name.
 */
export const LONG_RUN_MIN_MULTIPLE_OF_EASY = 1.5;

/** [DATA] Fraction of an interval session's clock actually spent at rep pace; the rest is recovery. */
export const INTERVAL_WORK_FRACTION = 0.55;
/** [ASSURED] Rep-count bounds for a 1000m interval session. */
export const INTERVAL_REPS_MIN = 4;
export const INTERVAL_REPS_MAX = 8;
/** [ASSURED] Standard interval rep distance. */
export const INTERVAL_REP_METERS = 1000;
/** [ASSURED] Recovery between interval reps, seconds. */
export const INTERVAL_RECOVERY_S = 90;

/** [DATA] Fraction of a threshold session's clock spent in the working blocks (the rest is warm-up and cooldown). */
export const THRESHOLD_WORK_FRACTION = 0.6;
/** [ASSURED] Block count for a threshold session, below/above this session length in minutes. */
export const THRESHOLD_BLOCKS_SHORT = 3;
export const THRESHOLD_BLOCKS_LONG = 4;
export const THRESHOLD_BLOCK_SPLIT_MINUTES = 45;
/** [ASSURED] Jog recovery between threshold blocks, seconds. */
export const THRESHOLD_RECOVERY_S = 120;

/** [ASSURED] Rep-run (neuromuscular) session shape. HR is deliberately not the target for these. */
export const REP_RUN_REPS = 8;
export const REP_RUN_METERS = 400;
export const REP_RUN_RECOVERY_S = 90;

/** [DATA] Finest realistic loadable jump on a standard barbell/plate setup. */
export const WEIGHT_ROUNDING_KG = 2.5;

/**
 * [EST] What an accessory's prescribed load is, as a fraction of the maximal
 * load for that rep count.
 *
 * Inverse Epley gives the weight for a set of N reps taken to failure.
 * Accessories are prescribed at RIR 2-3, so quoting the maximal load would be
 * prescribing a set the athlete cannot repeat — the second and third sets of a
 * 3x12 would both be misses. Roughly one rep in reserve per 3% of load is the
 * usual working figure; two to three reps puts the multiplier here.
 */
export const ACCESSORY_RIR_LOAD_HAIRCUT = 0.93;

/**
 * [DATA] Lift prescriptions per strength emphasis. `maximal_strength` is the
 * heavy low-rep end (>= 85% 1RM per brief §0d), `strength_endurance` the
 * 6-12 rep accumulation end, `weak_lift` the extra moderate-load exposure a
 * lagging competition lift earns.
 */
export const LIFT_PRESCRIPTIONS: Readonly<
  Record<"maximal_strength" | "strength_endurance" | "weak_lift", {
    sets: number;
    repsLow: number;
    repsHigh: number;
    intensityLow: number;
    intensityHigh: number;
    rir: string;
  }>
> = {
  maximal_strength: { sets: 5, repsLow: 1, repsHigh: 3, intensityLow: 0.85, intensityHigh: 0.92, rir: "1-2" },
  strength_endurance: { sets: 4, repsLow: 6, repsHigh: 10, intensityLow: 0.68, intensityHigh: 0.76, rir: "2-3" },
  weak_lift: { sets: 4, repsLow: 5, repsHigh: 8, intensityLow: 0.72, intensityHigh: 0.8, rir: "2-3" },
};

/** [EST] Variation exercises prescribed for a stalled competition lift before returning to the lift itself. */
export const STALL_VARIATIONS: Readonly<Record<string, string>> = {
  squat: "Pause Squat",
  bench: "Close-Grip Bench Press",
  deadlift: "Deficit Deadlift",
};

// ===========================================================================
// Rev B register — from hybrid_plan_engine_v2.py, the normative reference for
// WP3-WP7. Every value below closed a numbered finding in
// HPE-COACH-ASSURANCE-REVIEW.md; the finding is named where it applies.
// ===========================================================================

// ---------------------------------------------------------------------------
// Interference and scheduling
// ---------------------------------------------------------------------------

/** [DATA] Preferred hours between two sessions of different domains on the same day. */
export const MIN_SEPARATION_H = 6.0;
/** [DATA] Absolute floor on that separation — below this is a hard violation, not a preference. */
export const FLOOR_SEPARATION_H = 3.0;
/** [DATA] Clearance required after a heavy lower-body session before quality endurance. */
export const HEAVY_LOWER_TO_QUALITY_ENDURANCE_H = 48.0;
/** [DATA] Clearance required after quality endurance before heavy lower-body work. */
export const QUALITY_ENDURANCE_TO_HEAVY_LOWER_H = 24.0;
/** [ASSURED] F11-adjacent: deadlifting close before a long run is a lumbar-loading risk. */
export const DEADLIFT_TO_LONG_RUN_H = 48.0;
/** [EST] Longest run of consecutive training days before a rest day is forced. */
export const MAX_CONSECUTIVE_TRAINING_DAYS = 6;
/** [ASSURED] F10: any long run over this many minutes counts as QUALITY for spacing purposes. A 90-minute long run 37 hours after heavy squats must not pass the spacing checks. */
export const LONG_RUN_QUALITY_THRESHOLD_MIN = 75;

/** [ASSURED] Default clock times for AM/PM slots. The intake spec is explicit that the 6h separation rule must be computed from the athlete's REAL session times, not assumed — these are the documented fallback only. */
export const DEFAULT_SLOT_HOUR: Readonly<Record<"AM" | "PM", number>> = { AM: 7.0, PM: 18.0 };

// ---------------------------------------------------------------------------
// Minimum maintenance doses
// ---------------------------------------------------------------------------

/** [DATA] Spiering 2021 — strength is maintained on one session a week provided intensity is held. */
export const MMD_STRENGTH_SESSIONS_PER_WEEK = 1;
/** [DATA] The intensity that must be held for that maintenance dose to work. Dropping intensity as well is detraining, not maintenance. */
export const MMD_STRENGTH_MIN_INTENSITY = 0.8;
/** [DATA] Endurance maintenance dose. */
export const MMD_ENDURANCE_SESSIONS_PER_WEEK = 2;
export const MMD_ENDURANCE_QUALITY_PER_WEEK = 1;

// ---------------------------------------------------------------------------
// Progression, on-ramp and deload (F3, F4, F5)
// ---------------------------------------------------------------------------

/** [ASSURED] F3/F5: weekly endurance volume never rises faster than this. */
export const MAX_WEEKLY_VOLUME_RAMP = 0.08;
/** [ASSURED] F3: week 1 IS the athlete's current load. The single most common way generated plans injure people is starting 60% above where the athlete actually is. */
export const ONRAMP_START_MULTIPLIER = 1.0;
/** [ASSURED] Ceiling on total volume growth across a block, as a multiple of the starting load. */
export const ONRAMP_MAX_MULTIPLE = 2.6;
/** [EST] Ramp rate is halved for athletes under this many years of consistent running. */
export const NOVICE_ENDURANCE_YEARS = 0.5;
export const NOVICE_RAMP_MULTIPLIER = 0.5;
/** [ASSURED] F4: deload every fourth week. Twenty-four weeks of uninterrupted progression appears in no credible programme in either sport. */
export const DELOAD_EVERY_N_WEEKS = 4;
/** [ASSURED] -40% volume with intensity HELD. Dropping both is detraining, not deloading. */
export const DELOAD_VOLUME_MULTIPLIER = 0.6;

/** [DATA] Gabbett. Matches the live injury-risk engine's own warning line. */
export const ACWR_WARN = 1.3;
/** [ASSURED] QC-4 hard ceiling — any week breaching this is scaled back, not merely flagged. */
export const ACWR_BLOCK = 1.5;
/** [DATA] Below this the athlete is detraining. An on-ramp week may sit here, but it must be surfaced as deliberately easy rather than left looking like a bug. */
export const ACWR_FLOOR = 0.8;
/** [ASSURED] Rolling window, in weeks, for the chronic side of the ratio. */
export const ACWR_CHRONIC_WEEKS = 4;
/** [ASSURED] Iterations of the cap-and-recompute loop before giving up. */
export const ACWR_ENFORCEMENT_PASSES = 10;

// ---------------------------------------------------------------------------
// Rates of improvement per 12-week block
// ---------------------------------------------------------------------------

export type TrainingAge = "novice" | "intermediate" | "advanced" | "elite";


/** [EST] Fractional strength gain per 12-week block by training age. */
export const STRENGTH_GAIN_PER_BLOCK: Readonly<Record<TrainingAge, number>> = {
  novice: 0.1,
  intermediate: 0.04,
  advanced: 0.018,
  elite: 0.008,
};
/** [EST] Fractional endurance gain (time reduction) per 12-week block. */
export const ENDURANCE_GAIN_PER_BLOCK: Readonly<Record<TrainingAge, number>> = {
  novice: 0.07,
  intermediate: 0.03,
  advanced: 0.015,
  elite: 0.006,
};
/** [DATA] Wilson 2012 — concurrent training attenuates strength adaptation by this fraction. */
export const CONCURRENT_ATTENUATION_STRENGTH = 0.18;
/** [EST] The smaller reciprocal cost to endurance. */
export const CONCURRENT_ATTENUATION_ENDURANCE = 0.05;
/** [DATA-derived] Llanos-Lagos 2024 — strength work improves running economy independently of aerobic gain. */
export const RUNNING_ECONOMY_BONUS_PER_BLOCK = 0.01;
/** [ASSURED] How far the priority slider may skew the split of adaptation between domains. */
export const PRIORITY_SHARE_SKEW = 0.6;
/** [ASSURED] A domain is "develop" rather than "maintain" once the gap exceeds this fraction of the available headroom. */
export const DEVELOP_GAP_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Bodyweight frontier — BOUNDED (F2, F7)
// ---------------------------------------------------------------------------
// F2 is the finding the assurance review would put first in any conversation:
// a paid app telling someone their goal becomes reachable at a lower
// bodyweight is a meaningful push, and hybrid athletes chasing a weight class
// and a run time are a higher-risk population for low energy availability.
// The engine must never produce calorie targets, macro splits or
// rate-of-loss plans under any configuration (non-negotiable #5).

/** [EST] Seconds per km per kg of bodyweight. Band 2.0-3.5. */
export const PACE_COST_S_PER_KM_PER_KG = 2.7;
/** [ASSURED] F7: the frontier refuses to report beyond ±8% of current bodyweight. Rev A extrapolated to a 14:10 5k at 60kg, which is nonsense. */
export const FRONTIER_MAX_DELTA_FRACTION = 0.08;
/** [ASSURED] Hard floor. Below this BMI no bodyweight-reduction pathway is offered at all. */
/**
 * [EST] Intensity ceilings, as a fraction of 1RM, imposed by the health screen.
 *
 * These replace the screen's refusals. The reasoning is on `safetyScreen`: a
 * refusal assumes the alternative to a cautious plan is no training, when the
 * real alternative is the same training with no cap and no referral. So the
 * answers set how hard the plan is allowed to be instead of whether it exists.
 *
 * Ordered by how much the engine should back off. Exertional chest pain and
 * pregnancy hold everything at genuinely submaximal loads; a current injury
 * sits just above; a healed one from the last twelve weeks barely bites and is
 * mostly carried by the halved ramp.
 */
export const MEDICAL_CLEARANCE_INTENSITY_CEILING = 0.65;
export const CURRENT_INJURY_INTENSITY_CEILING = 0.75;
export const RECENT_SURGERY_INTENSITY_CEILING = 0.8;
export const RECENT_INJURY_INTENSITY_CEILING = 0.88;
/** [EST] Under-18s train for development, not for a maximal total. */
export const YOUTH_INTENSITY_CEILING = 0.85;

export const MIN_HEALTHY_BMI = 19.0;
/** [ASSURED] Ceiling on rate of loss used ONLY to state how many weeks a change would take — never as a prescription. */
export const MAX_SAFE_LOSS_RATE_PCT_PER_WEEK = 0.006;
/** [DATA] Matches the live SRI engine's allometric exponent. */
export const ALLOMETRIC_EXPONENT = 0.67;

// ---------------------------------------------------------------------------
// Same-day dual-event acute decrements
// ---------------------------------------------------------------------------

/** [BETA] All four of these are unvalidated and should be treated as directional. */
export const MEET_THEN_RACE_5K_PENALTY = 0.045;
export const RACE_THEN_MEET_SQUAT_PENALTY = 0.07;
export const RACE_THEN_MEET_BENCH_PENALTY = 0.025;
export const RACE_THEN_MEET_DEADLIFT_PENALTY = 0.08;
/** [BETA] Fraction of the decrement cleared per hour between events. */
export const INTER_EVENT_RECOVERY_PER_HOUR = 0.06;
export const INTER_EVENT_RECOVERY_MAX = 0.55;
/**
 * [ASSURED] F11. Maximal deadlift attempts with fatigued erectors,
 * compromised bracing and depleted glycogen are the highest-risk lumbar
 * loading scenario in the sport, attempted in the worst possible state. This
 * is a SAFETY block requiring explicit override, not a cost to be weighed
 * against a priority slider.
 */
export const DEADLIFT_AFTER_RACE_IS_UNSAFE = true;

// ---------------------------------------------------------------------------
// Taper
// ---------------------------------------------------------------------------

export const TAPER_DAYS = 10;
/** [DATA] Strength volume cut. */
export const TAPER_VOLUME_REDUCTION = 0.5;
/** [DATA] Intensity floor held through the taper — cutting both is detraining. */
export const TAPER_MIN_INTENSITY = 0.85;
/** [DATA] Endurance volume cut from peak. */
export const TAPER_ENDURANCE_VOLUME_REDUCTION = 0.45;
/**
 * [ASSURED] F12. NOT a marathon load. Rev A prescribed 8-10 g/kg before a 5k;
 * the associated glycogen-bound water adds 1.5-2kg, which costs 5k time AND
 * moves weigh-in mass for a same-day meet. Framed as normal high-carbohydrate
 * eating, never as a loading protocol — and never as a calorie or macro
 * target, which non-negotiable #5 forbids outright.
 */
export const TAPER_CHO_G_PER_KG: readonly [number, number] = [6.0, 7.0];

// ---------------------------------------------------------------------------
// Intensity distribution by phase
// ---------------------------------------------------------------------------

export type Phase = "base" | "build" | "specific" | "peak" | "taper";

export const PHASE_ORDER: readonly Phase[] = ["base", "build", "specific", "peak", "taper"];

/** [DATA] (zone 1, zone 2, zone 3) shares of endurance sessions per phase. */
export const TID_BY_PHASE: Readonly<Record<Phase, readonly [number, number, number]>> = {
  base: [0.8, 0.15, 0.05],
  build: [0.78, 0.12, 0.1],
  specific: [0.8, 0.04, 0.16],
  peak: [0.82, 0.03, 0.15],
  taper: [0.85, 0.0, 0.15],
};

/** [ASSURED] Share of the non-taper macrocycle spent in each phase. */
export const PHASE_SHARE: Readonly<Record<Phase, number>> = {
  base: 0.35,
  build: 0.28,
  specific: 0.22,
  peak: 0.1,
  taper: 0.05,
};

/** [DATA] Strength prescription per phase. */
export const STRENGTH_PHASE_SPEC: Readonly<
  Record<Phase, { pct: readonly [number, number]; reps: readonly [number, number]; rir: readonly [number, number]; sets: number }>
> = {
  base: { pct: [0.65, 0.75], reps: [6, 10], rir: [2, 3], sets: 4 },
  build: { pct: [0.75, 0.85], reps: [3, 6], rir: [1, 3], sets: 4 },
  specific: { pct: [0.82, 0.9], reps: [2, 4], rir: [1, 2], sets: 4 },
  peak: { pct: [0.88, 0.95], reps: [1, 3], rir: [1, 2], sets: 3 },
  taper: { pct: [0.85, 0.92], reps: [1, 2], rir: [2, 3], sets: 2 },
};

/** [ASSURED] Strength sessions per week per phase when developing. */
export const STRENGTH_SESSIONS_BY_PHASE: Readonly<Record<Phase, number>> = {
  base: 4,
  build: 4,
  specific: 4,
  peak: 3,
  taper: 2,
};
/** [ASSURED] Endurance sessions per week per phase when developing. */
export const ENDURANCE_SESSIONS_BY_PHASE: Readonly<Record<Phase, number>> = {
  base: 5,
  build: 5,
  specific: 5,
  peak: 4,
  taper: 3,
};

/** [ASSURED] Share of weekly endurance minutes allocated to each quality session, and to the long run. */
export const QUALITY_SESSION_MINUTE_SHARE = 0.15;
/**
 * [DATA] Race distance in kilometres for each endurance event the intake offers.
 *
 * The intake has always asked what the athlete is training for and the answer
 * has never reached the engine: `Goal` carried `target5kS` and nothing else,
 * so a marathon runner and a 5k runner were programmed identically. That is
 * how someone training for a half was handed a 7km long run.
 *
 * Null means the event is not a run, so it sets no long-run target.
 */
export const EVENT_DISTANCE_KM: Readonly<Record<string, number | null>> = {
  "5k": 5,
  "10k": 10,
  half: 21.0975,
  marathon: 42.195,
  "2k_row": null,
  powerlifting: null,
  hyrox: null,
};

/**
 * [DATA] Peak long run as a fraction of race distance.
 *
 * Shorter races are limited by the weekly-volume share rather than by this —
 * a 5k runner's long run is not driven by the 5k. The marathon fraction is
 * deliberately well under 1.0: the standard practice is to peak around 30-35km
 * rather than run the full distance in training, because the recovery cost of
 * a full-distance run outweighs what it teaches.
 */
export const LONG_RUN_PEAK_FRACTION_OF_RACE: Readonly<Record<string, number>> = {
  "5k": 2.4,
  "10k": 1.8,
  half: 0.95,
  marathon: 0.78,
};

/**
 * [ASSURED] Hard ceiling on a single long run, whatever the race distance says.
 *
 * Above about three hours the session stops buying aerobic adaptation in
 * proportion to what it costs to recover from, and this is the number most
 * marathon coaching caps on rather than distance.
 */
export const LONG_RUN_MAX_MINUTES = 180;

export const LONG_RUN_MINUTE_SHARE = 0.28;

/**
 * [EST] Shortest endurance session worth prescribing. A low-volume athlete
 * divided across five slots produces 17-minute "interval sessions" that are
 * shorter than their own warm-up — arithmetically consistent and not a
 * session. The week's session COUNT flexes down to keep each session real,
 * rather than the duration flexing down to keep the count.
 */
export const MIN_ENDURANCE_SESSION_MIN = 25;
/** [EST] A quality session needs longer still — there is a warm-up and a cooldown inside it before any work happens. */
export const MIN_QUALITY_SESSION_MIN = 30;

/**
 * [DATA] Neuromuscular work is delivered as strides appended to easy runs
 * during base and build, and only earns a standalone rep session in the
 * specific and peak phases. This is standard practice rather than a
 * compromise: strides are how running economy is trained while the aerobic
 * base is still being built, and a separate track session that early buys
 * fatigue the athlete cannot yet absorb.
 */
export const REP_SESSION_PHASES: readonly Phase[] = ["specific", "peak"];

// ---------------------------------------------------------------------------
// Session stress units
// ---------------------------------------------------------------------------

/** [BETA] Stress per minute by endurance session kind. */
export const BASE_STRESS_PER_MIN: Readonly<Record<string, number>> = {
  recovery_run: 0.55,
  easy_run: 0.8,
  long_run: 0.95,
  threshold_run: 1.55,
  interval_run: 1.75,
  rep_run: 1.5,
  easy_bike: 0.55,
  easy_row: 0.7,
};

/**
 * [EST] How long a strength session actually takes: a fixed warm-up plus time
 * per exercise.
 *
 * Strength sessions were built with `minutes` defaulting to 0. They displayed
 * as "0min", and — worse — the athlete's own `maxHoursPerWeek` and
 * `maxSessionMin` limits could not see them at all, so someone who said they
 * had seven hours a week was given seven hours of running plus however much
 * lifting the emphasis vector asked for.
 */
export const STRENGTH_WARMUP_MIN = 12;
export const STRENGTH_MIN_PER_EXERCISE = 9;

/** [BETA] Flat stress per strength session kind. */
export const STRENGTH_STRESS: Readonly<Record<string, number>> = {
  squat_heavy: 95,
  squat_volume: 80,
  deadlift_heavy: 100,
  deadlift_volume: 82,
  bench_heavy: 58,
  bench_volume: 52,
  upper_accessory: 40,
  strength_maintenance: 42,
  weak_lift_exposure: 45,
};
/** [BETA] Fallback for an unrecognised session kind. */
export const DEFAULT_STRESS_PER_MIN = 0.8;
export const DEFAULT_STRENGTH_STRESS = 50;

// ---------------------------------------------------------------------------
// Scheduler penalties
// ---------------------------------------------------------------------------

export const PENALTY: Readonly<Record<string, number>> = {
  sep_below_floor: 1000,
  sep_below_preferred: 120,
  heavy_lower_before_quality: 400,
  quality_before_heavy_lower: 150,
  heavy_lower_too_close: 350,
  deadlift_before_long_run: 300,
  no_rest_day: 300,
  consecutive_days_exceeded: 250,
  day_unavailable: 10000,
  daily_stress_cap: 2,
  volume_before_intensity: 45,
  wrong_order_same_day: 60,
  avoidable_double_day: 25,
  consecutive_lower_days: 70,
  intensity_drift: 8,
  same_lift_consecutive_days: 90,
  // Soft, and genuinely soft: the athlete said they would rather rest Sunday
  // and go long on Saturday, not that they cannot do otherwise. Weighted below
  // every physiological rule so a preference never displaces a separation
  // requirement — but above zero, which is what they were worth before.
  preferred_rest_day_used: 55,
  preferred_long_day_missed: 35,
};

/**
 * Penalties that represent HARD rules. The acceptance criterion is zero of
 * these — but note the assurance review's own warning: "Constraint
 * satisfaction is a necessary condition and a poor proxy for quality.
 * Whatever dashboard you build for this, do not let '0 violations' become the
 * metric anyone watches."
 */
export const HARD_PENALTIES: ReadonlySet<string> = new Set([
  "sep_below_floor",
  "sep_below_preferred",
  "heavy_lower_before_quality",
  "quality_before_heavy_lower",
  "heavy_lower_too_close",
  "deadlift_before_long_run",
  "no_rest_day",
  "consecutive_days_exceeded",
  "day_unavailable",
]);

export const DAILY_STRESS_CAP = 150.0;

/** [ASSURED] Deterministic search budget. Non-negotiable #2 requires generation to be deterministic, so the local search is seeded and its iteration count fixed. */
export const SCHEDULER_ITERATIONS = 6000;
export const SCHEDULER_RESTARTS = 6;
export const SCHEDULER_SEED = 7;
/**
 * [ASSURED] Iterations without improvement before a restart gives up. The
 * reference implementation always burns its full budget; on a seven-day week
 * with fewer than a dozen sessions the search has long since converged, and
 * the remaining iterations only cost time. Deterministic either way — a
 * plateau is a property of the search path, not of wall-clock timing.
 */
export const SCHEDULER_PLATEAU_ITERATIONS = 400;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type DayName = (typeof DAYS)[number];

// ---------------------------------------------------------------------------
// WP8 — F15: quality-session progression across the block
// ---------------------------------------------------------------------------
// "The engine currently prescribes 5x1000m at 5k pace in week 5 and in week
// 21. Interval sessions must progress in volume, density or pace across the
// block." Indexed by position within the phase (0 = first week of the phase,
// 1 = last), so a long base phase and a short peak both progress smoothly.

/** [EST] Interval rep count at the start and end of a phase. */
export const INTERVAL_REPS_PROGRESSION: readonly [number, number] = [4, 6];
/** [EST] Recovery between reps shortens across the block — the density half of the progression. */
export const INTERVAL_RECOVERY_PROGRESSION_S: readonly [number, number] = [90, 75];
/**
 * [EST] Rep pace moves from CURRENT 5k pace toward TARGET 5k pace across the
 * block. Expressed as the fraction of the way from current to target — never
 * beyond 1.0, because prescribing faster than the athlete's own goal pace is
 * not a progression, it is a fantasy.
 */
export const INTERVAL_PACE_PROGRESSION: readonly [number, number] = [0.0, 1.0];
/** [EST] Threshold block duration in minutes, start to end of phase. */
export const THRESHOLD_BLOCK_MIN_PROGRESSION: readonly [number, number] = [6, 10];

// ---------------------------------------------------------------------------
// WP8 — F16: autoregulation from logged session feedback
// ---------------------------------------------------------------------------

/** [ASSURED] Consecutive sessions below prescription that trigger a reduction in the following week. */
export const AUTOREG_CONSECUTIVE_SHORTFALLS = 3;
/** [ASSURED] Session RPE this far above the expected value for the session type also triggers a reduction. */
export const AUTOREG_RPE_OVERSHOOT = 2.0;
/** [EST] Size of the reduction applied to the following week's volume when autoregulation fires. */
export const AUTOREG_VOLUME_REDUCTION = 0.15;
/** [EST] Expected session RPE by kind, used as the reference point for the overshoot test. */
export const EXPECTED_RPE_BY_KIND: Readonly<Record<string, number>> = {
  recovery_run: 3,
  easy_run: 4,
  long_run: 5,
  threshold_run: 7,
  interval_run: 8.5,
  rep_run: 7,
  easy_bike: 3,
  easy_row: 4,
  squat_heavy: 8.5,
  squat_volume: 7,
  deadlift_heavy: 8.5,
  deadlift_volume: 7,
  bench_heavy: 8,
  bench_volume: 6.5,
  strength_maintenance: 6,
  weak_lift_exposure: 6.5,
};

// ---------------------------------------------------------------------------
// WP8 — F18: attempt selection and race pacing
// ---------------------------------------------------------------------------

/** [DATA] Opener / second / third attempt as a fraction of expected best. */
export const ATTEMPT_FRACTIONS: Readonly<Record<"opener" | "second" | "third", readonly [number, number]>> = {
  opener: [0.91, 0.93],
  second: [0.96, 0.98],
  third: [1.0, 1.03],
};
/** [ASSURED] A hybrid athlete on a dual-event day opens more conservatively than usual. */
export const DUAL_EVENT_ATTEMPT_DISCOUNT = 0.02;
/** [DATA] First-km pace offset when the 5k follows a meet — even splits protect the back half. */
export const POST_MEET_FIRST_KM_OFFSET_S: readonly [number, number] = [3, 5];

// ---------------------------------------------------------------------------
// WP8 — Rev 2 addition: the diagnostic re-runs and the plan regenerates
// ---------------------------------------------------------------------------

/** [ASSURED] The diagnostic re-runs every four weeks against accumulating data. */
export const DIAGNOSTIC_RERUN_WEEKS = 4;
/** [ASSURED] An emphasis shift larger than this on any dimension regenerates the remaining macrocycle and shows the athlete what changed and why. */
export const EMPHASIS_DRIFT_REGENERATE_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// Planning horizon when there is no event date
// ---------------------------------------------------------------------------
// Product decision, overriding the intake spec's "Block" on event_date: an
// athlete without a race still deserves a plan. A block is only defensible
// when proceeding would be unsafe, and not having entered a date is not
// unsafe — it just means the engine picks the horizon instead of the calendar.

/** [ASSURED] Offered timeframes when the athlete has no event, in weeks. */
export const PLANNING_HORIZONS: readonly { weeks: number; label: string; blurb: string }[] = [
  { weeks: 12, label: "3 months", blurb: "One full training block. Long enough to move a 5k time or a lift, short enough to stay committed to." },
  { weeks: 24, label: "6 months", blurb: "Two blocks with a genuine base phase. The best choice if your aerobic base is the limiter." },
  { weeks: 52, label: "A year", blurb: "Long-range. The later phases will be rebuilt as your data accumulates, so treat the back half as a sketch." },
];

/** [ASSURED] Used when the athlete gives neither an event date nor a timeframe. Twelve weeks is the standard block length and the horizon every gain-rate constant in this file is expressed against. */
export const DEFAULT_PLANNING_HORIZON_WEEKS = 12;

/** [ASSURED] Bounds on any horizon, however it was arrived at. */
export const MIN_HORIZON_WEEKS = 4;
export const MAX_HORIZON_WEEKS = 52;

// ---------------------------------------------------------------------------
// Plan tailoring — how individual this plan actually is
// ---------------------------------------------------------------------------
// The engine no longer refuses to generate when data is thin. It generates and
// says plainly how much of the plan is this athlete versus how much is the
// population. Refusing taught the athlete nothing and lost them; a labelled
// provisional plan gives them something to do today and a reason to log it.

export type TailoringLevel = "provisional" | "developing" | "tailored" | "individualised";

/** The four data-sufficiency tiers, as a key type. */
export type DataTierKey = 0 | 1 | 2 | 3;

/** [ASSURED] Which tailoring level each data-sufficiency tier produces. */
export const TAILORING_BY_TIER: Readonly<Record<0 | 1 | 2 | 3, TailoringLevel>> = {
  0: "provisional",
  1: "developing",
  2: "tailored",
  3: "individualised",
};

/**
 * [EST] How conservative the on-ramp is at each tailoring level. A provisional
 * plan is built on population numbers, so it starts lower and ramps slower —
 * the uncertainty is paid for in caution rather than in a refusal.
 */
export const TAILORING_RAMP_MULTIPLIER: Readonly<Record<TailoringLevel, number>> = {
  provisional: 0.5,
  developing: 0.75,
  tailored: 1.0,
  individualised: 1.0,
};

/** [EST] Starting weekly running minutes when there is no logged history at all to anchor on. Deliberately low: the on-ramp exists to be climbed. */
export const PROVISIONAL_START_RUN_MIN_PER_WEEK = 60;

/**
 * [EST] How much of an athlete's ESTABLISHED weekly running they are brought
 * back to after a layoff, when their recent average has fallen below it.
 *
 * Returning to roughly half of previous volume and rebuilding is the ordinary
 * coaching answer to a few weeks off, and it is bounded on both sides here: it
 * can only ever RAISE the anchor toward what the athlete has actually held, and
 * it can never exceed that figure.
 *
 * The case it exists for: an athlete averaging 55min/week whenever they train,
 * six weeks idle, with a 5k eight weeks out. Their trailing-8-week average was
 * 4.7min/week, so the multiplicative on-ramp started from 4.7 and — at
 * MAX_WEEKLY_VOLUME_RAMP — could not reach anything in eight weeks. The engine
 * was simultaneously willing to start a total stranger at
 * PROVISIONAL_START_RUN_MIN_PER_WEEK, twelve times higher, on no evidence at
 * all. Being more generous to an athlete you know nothing about than to one
 * whose history you can read is not caution, it is an artefact.
 */
export const RETURNING_ATHLETE_VOLUME_SHARE = 0.5;
/** [EST] Sessions per week assumed for a provisional plan before the athlete says otherwise. */
export const PROVISIONAL_SESSIONS_PER_WEEK = 4;

// ---------------------------------------------------------------------------
// Training without a gym
// ---------------------------------------------------------------------------

/**
 * [EST] What each competition lift becomes when the athlete has no barbell.
 *
 * These are substitutions, not equivalents, and the plan says so. A goblet
 * squat is not a back squat and no amount of programming makes it one — but
 * prescribing a back squat to someone who has told us they train in a
 * bedroom is worse than substituting, because it produces a plan they cannot
 * perform and therefore will not follow.
 */
export const NO_GYM_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  squat: "Goblet or split squat",
  bench: "Push-up progression or dumbbell press",
  deadlift: "Single-leg Romanian deadlift or hip hinge",
};

/** [EST] Reps run higher without load to reach a comparable stimulus. */
export const NO_GYM_REP_RANGE: readonly [number, number] = [8, 15];

// ---------------------------------------------------------------------------
// Gym training splits
// ---------------------------------------------------------------------------
// The engine allocated strength work per LIFT — "squat day", "bench day" —
// which is correct for a powerlifter peaking three lifts and is not how most
// people train. An athlete who runs a push/pull/legs split wants a push day,
// not a bench day, and handing them a single lift reads as a fragment of a
// session rather than a session.
//
// The split is the athlete's own choice and is asked, not inferred: two people
// with identical diagnostics can reasonably prefer different structures, and
// this is a preference rather than a physiological finding. The emphasis
// vector still decides how HARD each day is and which lift leads it — the
// split decides only how the week is carved up.

export type TrainingSplit = "lift_specific" | "upper_lower" | "ppl" | "ppl_ul" | "full_body";

export interface SplitDay {
  /** Shown to the athlete: "Push", "Legs", "Upper". */
  label: string;
  /** Which competition lift leads the day, where one does. */
  primaryLift: string | null;
  /** Movement patterns this day covers, for accessory selection. */
  patterns: readonly ("push" | "pull" | "legs" | "core")[];
}

/**
 * [EST] The day rotations. Ordered so that consecutive days do not repeat a
 * pattern — the scheduler's spacing rules then have something to work with
 * rather than being handed four leg days in a row.
 */
export const TRAINING_SPLITS: Readonly<Record<TrainingSplit, { label: string; blurb: string; days: readonly SplitDay[] }>> = {
  lift_specific: {
    label: "Lift-specific",
    blurb: "A day per competition lift — squat, bench, deadlift. Best if you are peaking a powerlifting total.",
    days: [
      { label: "Squat", primaryLift: "squat", patterns: ["legs"] },
      { label: "Bench", primaryLift: "bench", patterns: ["push"] },
      { label: "Deadlift", primaryLift: "deadlift", patterns: ["legs", "pull"] },
      { label: "Bench", primaryLift: "bench", patterns: ["push"] },
    ],
  },
  upper_lower: {
    label: "Upper / Lower",
    blurb: "Two days, alternating. The most time-efficient split, and the easiest to fit around running.",
    days: [
      { label: "Lower", primaryLift: "squat", patterns: ["legs", "core"] },
      { label: "Upper", primaryLift: "bench", patterns: ["push", "pull"] },
      { label: "Lower", primaryLift: "deadlift", patterns: ["legs", "pull"] },
      { label: "Upper", primaryLift: "bench", patterns: ["push", "pull"] },
    ],
  },
  ppl: {
    label: "Push / Pull / Legs",
    blurb: "Three days. More room per muscle group than upper/lower, and it needs three gym days to work.",
    days: [
      { label: "Push", primaryLift: "bench", patterns: ["push"] },
      { label: "Pull", primaryLift: "deadlift", patterns: ["pull"] },
      { label: "Legs", primaryLift: "squat", patterns: ["legs", "core"] },
    ],
  },
  ppl_ul: {
    label: "Push / Pull / Legs + Upper / Lower",
    blurb: "Five days. High frequency and high total volume — hard to combine with serious running volume.",
    days: [
      { label: "Push", primaryLift: "bench", patterns: ["push"] },
      { label: "Pull", primaryLift: "deadlift", patterns: ["pull"] },
      { label: "Legs", primaryLift: "squat", patterns: ["legs", "core"] },
      { label: "Upper", primaryLift: "bench", patterns: ["push", "pull"] },
      { label: "Lower", primaryLift: "squat", patterns: ["legs", "core"] },
    ],
  },
  full_body: {
    label: "Full body",
    blurb: "Every session covers everything. The best choice on two gym days a week, or when running is the priority.",
    days: [
      { label: "Full body", primaryLift: "squat", patterns: ["legs", "push", "pull", "core"] },
      { label: "Full body", primaryLift: "bench", patterns: ["push", "pull", "legs"] },
      { label: "Full body", primaryLift: "deadlift", patterns: ["pull", "legs", "core"] },
    ],
  },
};

/**
 * [ASSURED] Accessory pool per movement pattern, deep enough to rotate.
 *
 * The old pool held three lines per pattern and took the first two, so a Push
 * day was bench plus the same two accessories for the entire block — three
 * exercises, identical every week. Three is not a gym session, and repeating
 * it for eleven weeks is not a programme. The pool is now deep enough that the
 * week index can rotate through it, so the athlete meets the same patterns
 * with different exercises as the block goes on.
 *
 * Everything here is achievable in a commercial gym, which is the whole
 * premise of asking about gym access rather than about a barbell.
 */
export const STRENGTH_ACCESSORY_POOL: Readonly<Record<string, readonly string[]>> = {
  push: [
    "Incline dumbbell press 3x8-12",
    "Overhead press 3x6-10",
    "Dips or close-grip press 3x8-12",
    "Cable fly or pec deck 3x12-15",
    "Lateral raise 3x12-15",
    "Triceps rope pushdown 3x12-15",
    "Machine chest press 3x10-12",
  ],
  pull: [
    "Barbell row 3x8-12",
    "Pull-up or lat pulldown 3x8-12",
    "Seated cable row 3x10-12",
    "Single-arm dumbbell row 3x10-12 each",
    "Face pull 3x12-15",
    "Barbell or dumbbell curl 3x10-12",
    "Rear-delt fly 3x12-15",
  ],
  legs: [
    "Romanian deadlift 3x8-12",
    "Bulgarian split squat 3x10 each",
    "Leg press 3x10-15",
    "Walking lunge 3x12 each",
    "Leg curl 3x12-15",
    "Leg extension 3x12-15",
    "Calf raise 3x12-15",
  ],
  core: [
    "Hanging leg raise 3x10-12",
    "Weighted plank 3x45s",
    "Cable woodchop 3x12 each",
    "Ab wheel rollout 3x8-12",
  ],
};

/**
 * [ASSURED] The pulling a LOWER-BODY day does.
 *
 * `patterns` carried one token, `pull`, for two unrelated things: the
 * upper-body pull that a Pull day is built around, and the hip hinge that a
 * Lower day pulls from the floor. `STRENGTH_ACCESSORY_POOL.pull` is upper-body
 * throughout, so the `upper_lower` split's deadlift-led Lower day — patterns
 * `["legs", "pull"]` — was filled with pull-ups and cable rows, and an athlete
 * was handed "Deficit Deadlift · Bulgarian split squat · Pull-up or lat
 * pulldown · Leg press · Seated cable row · Walking lunge" and correctly said
 * it was not a lower session.
 *
 * The pattern was never wrong; the pool behind it was the only one that
 * existed. On a lower-body day `pull` now resolves here instead — the same
 * movement pattern, trained by the muscles the day is for. Nothing about a
 * Pull day changes: a row and a pull-up are exactly what belongs there.
 *
 * `Romanian deadlift` deliberately appears in the legs pool as well. The
 * round-robin de-duplicates by line, so a day drawing from both meets it once.
 */
export const POSTERIOR_CHAIN_ACCESSORY_POOL: readonly string[] = [
  "Romanian deadlift 3x8-12",
  "Hip thrust 3x8-12",
  "Back extension 3x12-15",
  "Glute-ham raise or Nordic curl 3x6-10",
  "Single-leg Romanian deadlift 3x10 each",
  "Good morning 3x8-12",
  "Cable pull-through 3x12-15",
];

/**
 * [ASSURED] How many exercises a strength session should contain.
 *
 * The engine prescribed three — a primary and two accessories — which an
 * athlete correctly called a terrible session. Five to six is the range a
 * commercial-gym session actually occupies, and it is what the hypertrophy
 * volume literature assumes when it counts hard sets per muscle per week.
 */
/**
 * [ASSURED] Most core lines a session may carry.
 *
 * Core is listed as a pattern so a legs day finishes with some trunk work.
 * Round-robining it evenly against the legs pool produced a legs day that was
 * half abs, which is not a legs day.
 */
export const CORE_ACCESSORY_CAP = 1;

export const MIN_EXERCISES_PER_STRENGTH_SESSION = 5;
export const TARGET_EXERCISES_PER_STRENGTH_SESSION = 6;

/**
 * [ASSURED] Variants that train the same pattern as the competition lift.
 *
 * Not everybody is peaking a total. An athlete training for size, or for
 * general strength, does not need to barbell bench every push day for eleven
 * weeks — an incline dumbbell press trains the same pattern with less joint
 * cost and more variety, and the bench goes up anyway. So the primary rotates
 * through these when there is no numeric target on that lift, and stays on the
 * competition lift when there is one, because specificity is the whole point
 * of a peaking block.
 */
/**
 * [ASSURED] What the competition lift is CALLED when the rotation lands back
 * on it.
 *
 * The rotation in `PRIMARY_LIFT_VARIANTS` alternates a variation with the
 * lift itself, so half the weeks lead with "Back squat" — which is the squat,
 * under a display name. Prescribing that by effort because the string did not
 * literally equal "squat" told an athlete with a 140kg squat on file to use "a
 * load you can hold for the reps", which is the app declining to say a number
 * it holds.
 *
 * Only the lift's own name belongs here. A front squat is NOT a back squat at
 * a different name, and quoting 65-75% of a back-squat 1RM beside one would
 * overshoot by about the difference between the two lifts.
 */
export const COMPETITION_LIFT_DISPLAY_NAME: Readonly<Record<string, string>> = {
  squat: "back squat",
  bench: "bench press",
  deadlift: "deadlift",
};

export const PRIMARY_LIFT_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  squat: ["Back squat", "Front squat", "Back squat", "Hack squat or pendulum squat"],
  bench: ["Bench press", "Incline dumbbell press", "Bench press", "Close-grip bench press"],
  deadlift: ["Deadlift", "Romanian deadlift", "Deadlift", "Trap-bar deadlift"],
};

/** [ASSURED] Chosen when the athlete has not picked one. Lift-specific only suits a peaking powerlifter, so it is not the default. */
export const DEFAULT_TRAINING_SPLIT: TrainingSplit = "upper_lower";

// ---------------------------------------------------------------------------
// General strength, when there is no numeric target
// ---------------------------------------------------------------------------

/**
 * [DATA] The rep scheme for an athlete developing strength and size without a
 * competition total to peak for.
 *
 * The phase ladder in STRENGTH_PHASE_SPEC descends toward singles because it
 * is built to peak three lifts on a date. Most people lifting are not doing
 * that — they want to be bigger and stronger, and 2 reps at 80% delivers
 * neither. Hypertrophy needs work close to failure in the 6-12 range and
 * strength needs exposure to heavy loads, so a general block carries both
 * rather than descending out of the growth range entirely.
 *
 * Indexed by position through the block: the balance shifts toward the heavy
 * end over time, but never abandons the range that builds tissue.
 */
export const GENERAL_STRENGTH_SPEC: readonly {
  pct: readonly [number, number];
  reps: readonly [number, number];
  rir: readonly [number, number];
  sets: number;
}[] = [
  { pct: [0.65, 0.75], reps: [8, 12], rir: [2, 3], sets: 4 },
  { pct: [0.7, 0.8], reps: [6, 10], rir: [1, 3], sets: 4 },
  { pct: [0.75, 0.85], reps: [5, 8], rir: [1, 2], sets: 4 },
  { pct: [0.78, 0.88], reps: [4, 6], rir: [1, 2], sets: 5 },
];

/** [DATA] Spiering's maintenance dose still holds intensity, but a maintenance session is not an excuse for a single lift and nothing else. */
export const MAINTENANCE_REPS: readonly [number, number] = [3, 5];
export const MAINTENANCE_SETS = 3;

/**
 * [EST] Ceiling on projected endurance improvement across a whole block,
 * whatever the gain-rate arithmetic produces.
 *
 * The projection multiplies a training-age rate by block count by a priority
 * share that can reach 1.6x. For an athlete tagged "novice" who has set only
 * endurance goals that compounds to 10.7% in eleven weeks — an 18:25 5k
 * projected to 16:26 — which is not a forecast, it is a fantasy, and the
 * athlete reads it as a promise.
 *
 * The deeper problem is that training age is self-reported and defaults
 * generously, so the engine treats a genuinely fast runner as a beginner. A
 * cap is the blunt guard; `inferredEnduranceTrainingAge` below is the better
 * one, and both are applied.
 */
export const MAX_ENDURANCE_GAIN_PER_BLOCK = 0.05;

/**
 * [EST] Hard ceiling on how far the modelled gain may exceed the athlete's own
 * published per-block rate.
 *
 * The absolute caps above are a backstop for the novice rates, which are
 * genuinely large — a beginner really does go 30:00 to 27:00 in a season. They
 * do nothing for a trained athlete, whose rate is small and whose projection
 * went wrong by being MULTIPLIED rather than by starting too high. This cap is
 * relative, so it scales itself: an advanced runner is held near the advanced
 * rate no matter what the priority slider does.
 */
/**
 * [EST] Share of the modelled gain the CAUTIOUS end of a projection assumes.
 *
 * The range used to run from the modelled best down to the athlete's current
 * time, so its slow end said "this block may do nothing for you". That was an
 * overcorrection from the opposite error — a single optimistic number read as
 * a promise — and it is wrong in its own way: a block the athlete actually
 * completes should be expected to make them faster, and quoting their own PB
 * back to them as a possible outcome of sixteen weeks' work is dispiriting and
 * not what the evidence says either.
 *
 * A third of the modelled gain is the conservative end now. The whole band
 * therefore sits faster than where they are today, and the caveat that
 * progress is not linear is stated in words instead of smuggled into the
 * arithmetic — which is the honest place for it, because a plateau is a real
 * possibility rather than a number.
 */
export const CAUTIOUS_GAIN_SHARE = 0.35;

export const MAX_GAIN_MULTIPLE_OF_RATE = 1.5;
/** [EST] Same, for strength. Totals move faster than 5k times but not without limit. */
export const MAX_STRENGTH_GAIN_PER_BLOCK = 0.08;

/**
 * [DATA] 5k times above which an athlete cannot reasonably be treated as a
 * novice or intermediate, whatever they told the intake.
 *
 * Someone running 18:25 is not an endurance beginner, and novice gain rates
 * applied to them produce projections no coach would sign. Performance is the
 * more reliable signal here than self-report, which is why the intake spec's
 * own cross-check rule says to take the more conservative of the two.
 */
export const ENDURANCE_TRAINING_AGE_FLOOR_BY_5K: ReadonlyArray<readonly [number, TrainingAge]> = [
  [960, "elite"],
  [1140, "advanced"],
  [1380, "intermediate"],
];
