/**
 * Hybrid Plan Engine — WP6: session selection driven by the emphasis vector.
 *
 * This is the module Rev 2 rewrote, and it is where the product claim lives.
 * Rev 1 chose sessions from fixed per-phase counts, so two athletes with the
 * same 5k time, the same goal and the same free days got the same plan. Rev 2
 * allocates the week's available sessions PROPORTIONALLY TO THE EMPHASIS
 * VECTOR, then applies the phase's intensity-distribution targets and the hard
 * interference constraints as filters.
 *
 * Allocation order, from the brief:
 *   1. Reserve the mandatory minimums — one long run, and the minimum
 *      maintenance dose for any domain in maintain mode.
 *   2. Allocate remaining slots proportionally to emphasis, largest remainder
 *      first.
 *   3. Apply hard caps: at most three quality endurance sessions, one heavy
 *      lower-body day once loads exceed 82% 1RM.
 *   4. Reconcile against the phase TID targets; where emphasis and phase
 *      conflict, PHASE WINS in specific/peak/taper, EMPHASIS WINS in
 *      base/build.
 *
 * The worked example from the brief: an endurance-limited athlete on 42% of
 * typical volume with no logged quality work gets aerobic_base 0.36,
 * threshold 0.20, neuromuscular 0.15, and therefore a week weighted toward
 * easy volume plus one threshold session and strides — NOT the interval-heavy
 * week a speed-limited athlete with the same 5k time would receive. "That
 * difference is the entire product claim."
 *
 * Non-negotiable #7 is enforced structurally rather than by convention: a
 * session is only ever constructed through `makeSession`, which requires a
 * findingId. There is no way to add a session to the week without naming the
 * diagnostic finding that bought its slot.
 */

import {
  BASE_STRESS_PER_MIN,
  DEFAULT_STRENGTH_STRESS,
  DEFAULT_STRESS_PER_MIN,
  EMPHASIS_KEYS,
  ENDURANCE_SESSIONS_BY_PHASE,
  HEAVY_LOWER_BODY_LOAD_THRESHOLD,
  LIFT_PRESCRIPTIONS,
  GENERAL_STRENGTH_SPEC,
  CORE_ACCESSORY_CAP,
  STRENGTH_WARMUP_MIN,
  STRENGTH_MIN_PER_EXERCISE,
  MIN_EXERCISES_PER_STRENGTH_SESSION,
  TARGET_EXERCISES_PER_STRENGTH_SESSION,
  STRENGTH_ACCESSORY_POOL,
  PRIMARY_LIFT_VARIANTS,
  MAINTENANCE_REPS,
  MAINTENANCE_SETS,
  DEFAULT_TRAINING_SPLIT,
  TRAINING_SPLITS,
  type TrainingSplit,
  NO_GYM_REP_RANGE,
  NO_GYM_SUBSTITUTIONS,
  LONG_RUN_MAX_MINUTE_SHARE,
  LONG_RUN_MIN_MULTIPLE_OF_EASY,
  LONG_RUN_MINUTE_SHARE,
  LONG_RUN_QUALITY_THRESHOLD_MIN,
  MAX_QUALITY_ENDURANCE_SESSIONS,
  MIN_ENDURANCE_SESSION_MIN,
  MIN_QUALITY_SESSION_MIN,
  REP_SESSION_PHASES,
  MMD_ENDURANCE_QUALITY_PER_WEEK,
  MMD_ENDURANCE_SESSIONS_PER_WEEK,
  MMD_STRENGTH_MIN_INTENSITY,
  MMD_STRENGTH_SESSIONS_PER_WEEK,
  QUALITY_SESSION_MINUTE_SHARE,
  STRENGTH_PHASE_SPEC,
  STRENGTH_SESSIONS_BY_PHASE,
  STRENGTH_STRESS,
  TID_BY_PHASE,
  type EmphasisKey,
  type Phase,
} from "./constants";
import { prescribeEndurance, prescribeLift, type EnduranceKind, type Prescription } from "./prescription";
import type { DomainMode } from "./feasibility";
import type { MacrocycleWeek } from "./macrocycle";
import type { Constraints, Goal } from "./intake";
import type { AthleteProfile, Finding, FindingId } from "./types";
import { blockProgress, qualityProgressionFor } from "./progression";

export type SessionKind = EnduranceKind | "squat_heavy" | "squat_volume" | "deadlift_heavy" | "deadlift_volume" | "bench_heavy" | "bench_volume" | "strength_maintenance" | "weak_lift_exposure";

export interface PlannedSession {
  kind: SessionKind;
  /**
   * What the athlete calls this session — "Push", "Legs", "Upper".
   *
   * `kind` is the engine's classification and drives stress and scheduling; a
   * push day genuinely costs what a bench session costs. But the athlete who
   * chose push/pull/legs and was shown "bench_volume" reasonably concluded the
   * split had been ignored, because the only thing they can see is the label.
   */
  label?: string;
  domain: "endurance" | "strength";
  /** 0-1, used by the scheduler's ordering and drift penalties. */
  intensity: number;
  /** F10: a long run over 75 minutes counts as quality FOR SPACING PURPOSES, even though it is run at easy effort. */
  isQuality: boolean;
  minutes: number;
  isHeavyLower: boolean;
  isDeadlift: boolean;
  lift?: string;
  prescription: Prescription;
  /** Which emphasis dimension bought this slot. */
  emphasisKey: EmphasisKey;
  /** Non-negotiable #7 — the named diagnostic finding this session exists to answer. */
  findingId: FindingId;
  stress: number;
}

/**
 * Which finding drives each emphasis dimension. Used to attribute a session
 * to the specific finding that earned its slot, so the athlete can read why
 * they are doing it. Ordered by strength of claim — the first finding present
 * in the athlete's own diagnosis wins.
 */
const FINDINGS_BY_EMPHASIS: Record<EmphasisKey, FindingId[]> = {
  aerobic_base: [
    "low-volume",
    "endurance-limited",
    "grey-zone",
    "no-easy-runs-logged",
    "poor-decoupling",
    "easy-anchor-disagreement",
    "pace-vs-hr-discrepancy",
  ],
  threshold: ["no-quality", "endurance-limited", "ample-volume"],
  vo2max_speed: ["speed-limited", "no-quality", "low-speed-reserve", "ample-volume"],
  neuromuscular: ["low-speed-reserve", "speed-limited"],
  maximal_strength: ["under-expressed", "stalled-lift"],
  strength_endurance: ["under-built"],
  weak_lift: ["weak-lift"],
};

/**
 * Non-negotiable #7: "If the engine cannot say *why* this athlete is doing
 * this session, it does not prescribe it." Returns null when no finding in
 * this athlete's diagnosis backs the dimension — the caller must then either
 * drop the session or fall back to the explicit hybrid-baseline rationale,
 * which is itself a named, readable reason rather than a silent default.
 */
export function attributeFinding(emphasisKey: EmphasisKey, findings: Finding[]): FindingId | null {
  const present = new Set(findings.map((f) => f.id));
  for (const candidate of FINDINGS_BY_EMPHASIS[emphasisKey]) {
    if (present.has(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proportional allocation, largest remainder first
// ---------------------------------------------------------------------------

/**
 * Distributes `total` whole slots across fractional weights so the integer
 * allocations sum EXACTLY to `total` — each key takes its floor, then the
 * largest remainders take the few left over, one at a time. Naive rounding
 * over- or under-counts by a session or two, which in a 6-session week is a
 * 15% error in what the athlete actually does.
 */
export function largestRemainderAllocate(weights: number[], total: number): number[] {
  if (total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...base];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) result[order[k].i] += 1;
  return result;
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

export interface SessionSetInput {
  profile: AthleteProfile;
  week: MacrocycleWeek;
  mode: Record<"strength" | "endurance", DomainMode>;
  goal: Goal;
  constraints: Constraints;
  /** From the safety screen — beta blockers and similar drop HR prescription entirely. */
  suppressHeartRate?: boolean;
  /** F16: a reduction imposed by autoregulation on the previous week's feedback. 1 = no reduction. */
  autoregMultiplier?: number;
  /**
   * Ceiling on prescribed relative intensity, from the health screen. 1 means
   * unrestricted. This is what an injury answer now does instead of refusing
   * the plan — see the note on `safetyScreen`.
   */
  intensityCeiling?: number;
}

export interface SessionSet {
  sessions: PlannedSession[];
  /** How the week's slots were split across emphasis dimensions, after caps and TID reconciliation. Surfaced so the athlete can see the allocation, not just its output. */
  allocation: Record<EmphasisKey, number>;
  notes: string[];
}

function stressFor(kind: SessionKind, minutes: number, domain: "endurance" | "strength"): number {
  if (domain === "strength") return STRENGTH_STRESS[kind] ?? DEFAULT_STRENGTH_STRESS;
  return (BASE_STRESS_PER_MIN[kind] ?? DEFAULT_STRESS_PER_MIN) * minutes;
}

/** Exercises in a prescription. Rationale lives in `notes`, so this counts only lifts. */
function exerciseCount(text: string): number {
  return text.split("·").filter((x) => x.trim().length > 0).length;
}

function makeSession(
  kind: SessionKind,
  domain: "endurance" | "strength",
  emphasisKey: EmphasisKey,
  findingId: FindingId,
  prescription: Prescription,
  opts: { intensity: number; isQuality: boolean; minutes?: number; isHeavyLower?: boolean; isDeadlift?: boolean; lift?: string; label?: string }
): PlannedSession {
  const minutes =
    opts.minutes ??
    (domain === "strength"
      ? STRENGTH_WARMUP_MIN + exerciseCount(prescription.text) * STRENGTH_MIN_PER_EXERCISE
      : 0);
  return {
    kind,
    domain,
    intensity: opts.intensity,
    isQuality: opts.isQuality,
    minutes,
    isHeavyLower: opts.isHeavyLower ?? false,
    isDeadlift: opts.isDeadlift ?? false,
    lift: opts.lift,
    label: opts.label,
    prescription,
    emphasisKey,
    findingId,
    stress: stressFor(kind, minutes, domain),
  };
}

/**
 * Emphasis dimensions grouped by the session kind they buy. `aerobic_base`
 * buys easy volume and the long run; the three quality dimensions each buy
 * their own kind of hard session.
 */
const ENDURANCE_EMPHASIS_TO_KIND: Record<string, EnduranceKind> = {
  aerobic_base: "easy_run",
  threshold: "threshold_run",
  vo2max_speed: "interval_run",
  neuromuscular: "rep_run",
};

const QUALITY_EMPHASIS: EmphasisKey[] = ["threshold", "vo2max_speed", "neuromuscular"];

/** Phase ladder, easiest to heaviest. A strength emphasis moves the athlete one rung along it. */
const STRENGTH_LADDER: Phase[] = ["base", "build", "specific", "peak"];

/**
 * Load and rep range move together. `maximal_strength` shifts one rung
 * heavier than the phase would otherwise prescribe, `strength_endurance` one
 * rung lighter — but the shift is bounded by the ladder, so a base-phase week
 * can never end up prescribing peak-phase singles, and a peak week never
 * drops to hypertrophy volume.
 */
export function shiftPhaseSpec(phase: Phase, emphasisKey: EmphasisKey) {
  const idx = STRENGTH_LADDER.indexOf(phase);
  if (idx < 0) return STRENGTH_PHASE_SPEC[phase]; // taper is not shifted
  const delta = emphasisKey === "maximal_strength" ? 1 : emphasisKey === "strength_endurance" ? -1 : 0;
  const target = STRENGTH_LADDER[Math.max(0, Math.min(STRENGTH_LADDER.length - 1, idx + delta))];
  return STRENGTH_PHASE_SPEC[target];
}


/**
 * Accessory lines for a split day, drawn from its movement patterns and
 * rotated by week.
 *
 * This used to take the first two entries of a three-deep pool, so a Push day
 * was the bench press and the same two accessories for the whole block —
 * three exercises, identical every week, which an athlete correctly called a
 * terrible session. It now fills the day to a real session size and walks the
 * pool by week index, so the patterns stay constant while the exercises that
 * train them change.
 */
function accessoriesForDay(
  day: (typeof TRAINING_SPLITS)[TrainingSplit]["days"][number],
  primaryLift: string,
  week: number
): string[] {
  const patterns = day.patterns.length > 0 ? day.patterns : ["push"];
  // The primary already covers one slot, so the accessories fill the rest.
  const wanted = Math.max(MIN_EXERCISES_PER_STRENGTH_SESSION, TARGET_EXERCISES_PER_STRENGTH_SESSION) - 1;
  const out: string[] = [];

  // Round-robin across the day's patterns so a two-pattern day alternates
  // rather than exhausting one pool before starting the other. Core is capped
  // at one line: it is listed as a pattern so that a legs day finishes with
  // some trunk work, and an even split turned that into a legs day that was
  // half abs.
  const takenPerPattern: Record<string, number> = {};
  for (let depth = 0; out.length < wanted; depth += 1) {
    let addedThisPass = false;
    for (const pattern of patterns) {
      const pool = STRENGTH_ACCESSORY_POOL[pattern] ?? [];
      if (pool.length === 0) continue;
      if (pattern === "core" && (takenPerPattern.core ?? 0) >= CORE_ACCESSORY_CAP) continue;
      // Rotating the offset by week is what stops eleven identical sessions.
      const line = pool[(depth + week) % pool.length];
      if (out.length >= wanted) break;
      // Never list the primary again as its own accessory.
      if (line.toLowerCase().includes(primaryLift.toLowerCase())) continue;
      if (out.includes(line)) continue;
      out.push(line);
      takenPerPattern[pattern] = (takenPerPattern[pattern] ?? 0) + 1;
      addedThisPass = true;
    }
    // Every pool exhausted — stop rather than spin.
    if (!addedThisPass && depth > 8) break;
  }
  return out;
}

/**
 * The exercise that leads the session.
 *
 * An athlete peaking a total must keep meeting the competition lift, because
 * specificity is what a peaking block is for. An athlete training for size or
 * general strength does not: a push day led by an incline dumbbell press is
 * still a push day, and their bench goes up anyway. Rotating the lead by week
 * gives them the variety the plan was missing without changing what the
 * session trains.
 */
function primaryExerciseFor(lift: string, week: number, peakingATotal: boolean): string | undefined {
  if (peakingATotal) return undefined;
  const variants = PRIMARY_LIFT_VARIANTS[lift];
  if (!variants || variants.length === 0) return undefined;
  return variants[week % variants.length];
}


/**
 * Hold a prescribed intensity range under the health screen's ceiling.
 *
 * Both ends move, and the range never inverts: an athlete capped at 75% gets
 * a band that ends at 75%, not one that starts above it.
 */
function capIntensity(
  range: readonly [number, number],
  ceiling: number
): readonly [number, number] {
  if (ceiling >= 1) return range;
  const hi = Math.min(range[1], ceiling);
  const lo = Math.min(range[0], hi);
  return [lo, hi];
}

/**
 * Which KIND of quality session a single slot should be.
 *
 * Emphasis alone always picked the same dimension, so an athlete with one
 * quality slot a week got eleven consecutive weeks of threshold running and
 * never a single interval session. No real 5k programme looks like that, and
 * a 5k is heavily vVO2max-dependent — threshold alone will not move it.
 *
 * Two corrections. The phase's own intensity distribution says which kind
 * belongs: base and build are z2-dominant (threshold), specific and peak are
 * z3-dominant (intervals), which is the specificity the block is for. And
 * within a phase the type rotates by week, because doing the identical
 * session every week for a whole block is not a progression.
 */
function qualityKindForSlot(
  phase: Phase,
  week: number,
  profile: AthleteProfile,
  repSessionsAllowed: boolean
): EmphasisKey {
  const [, z2, z3] = TID_BY_PHASE[phase];
  const pool: EmphasisKey[] = z3 > z2 ? ["vo2max_speed", "threshold"] : ["threshold", "vo2max_speed"];
  if (repSessionsAllowed && profile.emphasis.neuromuscular > profile.emphasis.threshold) {
    pool.push("neuromuscular");
  }
  // Alternate across weeks so a one-quality week is not the same session every
  // time, while keeping the phase-appropriate kind in the majority.
  return pool[week % pool.length];
}

export function buildSessionSet(input: SessionSetInput): SessionSet {
  const {
    profile, week, mode, goal, constraints,
    suppressHeartRate = false, autoregMultiplier = 1, intensityCeiling = 1,
  } = input;
  const { phase, deload } = week;
  const notes: string[] = [];
  const sessions: PlannedSession[] = [];
  const totalMinutes = Math.max(0, week.enduranceMin * autoregMultiplier);
  if (autoregMultiplier < 1) {
    notes.push(
      `Volume reduced ${Math.round((1 - autoregMultiplier) * 100)}% this week off your logged feedback from last week.`
    );
  }

  // ---- how many slots does each domain get? -------------------------------
  // The emphasis vector is allocated WITHIN each domain rather than across
  // both at once. Allocating one seven-way split over the whole week lets a
  // strongly endurance-tilted vector round the strength dimensions to zero
  // and delete strength from the plan entirely — which is not what "emphasis"
  // means, and would silently drop the minimum maintenance dose the evidence
  // base is clearest about.
  const enduranceWanted =
    mode.endurance === "develop"
      ? Math.max(3, ENDURANCE_SESSIONS_BY_PHASE[phase] - (goal.priority >= 0.5 ? 1 : 0))
      : MMD_ENDURANCE_SESSIONS_PER_WEEK;
  const strengthWanted =
    mode.strength === "develop"
      ? Math.max(2, STRENGTH_SESSIONS_BY_PHASE[phase] - (goal.priority < 0.5 ? 1 : 0))
      : Math.max(MMD_STRENGTH_SESSIONS_PER_WEEK, 2);

  // Each endurance session has to be long enough to be a session. Where the
  // week's minutes cannot support the session count, the COUNT gives way —
  // never the duration.
  const affordableBySessionLength =
    totalMinutes > 0 ? Math.max(1, Math.floor(totalMinutes / MIN_ENDURANCE_SESSION_MIN)) : 0;
  let enduranceSlots = Math.min(enduranceWanted, affordableBySessionLength);
  let strengthSlots = strengthWanted;
  if (enduranceSlots < enduranceWanted) {
    notes.push(
      `Fewer, longer runs this week — ${Math.round(totalMinutes)} minutes split any further would be sessions too ` +
        `short to be worth doing.`
    );
  }

  // Fit inside the athlete's own stated ceiling, trimming whichever domain is
  // furthest above its minimum dose first.
  while (enduranceSlots + strengthSlots > constraints.maxSessionsPerWeek) {
    const enduranceHeadroom = enduranceSlots - MMD_ENDURANCE_SESSIONS_PER_WEEK;
    const strengthHeadroom = strengthSlots - MMD_STRENGTH_SESSIONS_PER_WEEK;
    if (enduranceHeadroom <= 0 && strengthHeadroom <= 0) {
      if (enduranceSlots >= strengthSlots) enduranceSlots--;
      else strengthSlots--;
    } else if (enduranceHeadroom >= strengthHeadroom) {
      enduranceSlots--;
    } else {
      strengthSlots--;
    }
  }
  enduranceSlots = Math.max(0, enduranceSlots);
  strengthSlots = Math.max(0, strengthSlots);

  // ---- step 1: reserve the mandatory minimums -----------------------------
  // The long run is reserved before the emphasis vector bids for anything —
  // it is the one session emphasis may not take away.
  // Reserved whenever there is any running at all outside the taper. A
  // deload week that drops the long run entirely is not a deload, it is a
  // gap in the one session the whole aerobic block is built around.
  const wantsLongRun = phase !== "taper" && enduranceSlots >= 1;
  const remainingEnduranceSlots = Math.max(0, enduranceSlots - (wantsLongRun ? 1 : 0));

  // ---- step 2: allocate the rest proportionally to emphasis ---------------
  // Neuromuscular work is delivered as strides on easy runs during base and
  // build, and only claims a session of its own in specific and peak. Its
  // weight is not discarded when it cannot claim a session — it folds into
  // aerobic base, where the strides actually happen.
  const repSessionsAllowed = REP_SESSION_PHASES.includes(phase);
  const enduranceDims: EmphasisKey[] = repSessionsAllowed
    ? ["aerobic_base", "threshold", "vo2max_speed", "neuromuscular"]
    : ["aerobic_base", "threshold", "vo2max_speed"];
  const enduranceWeights = enduranceDims.map((k) =>
    k === "aerobic_base" && !repSessionsAllowed
      ? profile.emphasis.aerobic_base + profile.emphasis.neuromuscular
      : profile.emphasis[k]
  );
  const enduranceCounts = largestRemainderAllocate(enduranceWeights, remainingEnduranceSlots);

  const allocation = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 0])) as Record<EmphasisKey, number>;
  enduranceDims.forEach((k, i) => {
    allocation[k] = enduranceCounts[i];
  });
  if (wantsLongRun) allocation.aerobic_base += 1;

  // The weak-lift dimension only buys a session when the diagnostic actually
  // named a weak lift. Without one there is no finding behind the session,
  // and non-negotiable #7 says a session the engine cannot justify is not
  // prescribed — the weight goes to the rotation instead.
  const strengthDims: EmphasisKey[] = profile.weakLift
    ? ["maximal_strength", "strength_endurance", "weak_lift"]
    : ["maximal_strength", "strength_endurance"];
  const strengthWeights = strengthDims.map((k) =>
    k === "maximal_strength" && !profile.weakLift
      ? profile.emphasis.maximal_strength + profile.emphasis.weak_lift
      : profile.emphasis[k]
  );
  const strengthCounts = largestRemainderAllocate(strengthWeights, strengthSlots);
  strengthDims.forEach((k, i) => {
    allocation[k] = strengthCounts[i];
  });

  // ---- step 2b: size the long run against the easy runs it sits beside ----
  //
  // The long run has to be distinctly the longest session of the week. The
  // share used to fall back to `1 / slots` in low-frequency weeks, to stop it
  // coming out shorter than an easy run, and overcorrected into identical: at
  // two slots both took exactly 50% of the week, which is how an athlete was
  // handed a 6.5km easy run and a 6.7km "long" run.
  //
  // This has to run AFTER the allocation, not before it. Quality sessions take
  // a fixed share off the top, so the long run is not competing with every
  // other slot — only with the easy runs that divide what is left. Sizing it
  // against the raw slot count was the first fix and it still produced 67
  // minutes against 60, because it counted the interval session as a rival for
  // minutes it had already been given.
  //
  // With q the fraction spent on quality and e easy runs sharing the rest,
  // long/easy = L·e/(1-L-q), so holding that at or above R needs
  // L >= R(1-q)/(e+R).
  const qualityEnduranceCount = QUALITY_EMPHASIS.reduce((n, k) => n + allocation[k], 0);
  const easyRunCount = Math.max(1, allocation.aerobic_base - (wantsLongRun ? 1 : 0));
  const qualityFraction = Math.min(0.8, qualityEnduranceCount * QUALITY_SESSION_MINUTE_SHARE);
  const ratioShare =
    (LONG_RUN_MIN_MULTIPLE_OF_EASY * (1 - qualityFraction)) /
    (easyRunCount + LONG_RUN_MIN_MULTIPLE_OF_EASY);
  const longShare = Math.min(
    LONG_RUN_MAX_MINUTE_SHARE,
    Math.max(LONG_RUN_MINUTE_SHARE, ratioShare)
  );
  const longMinutes = Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(totalMinutes * longShare));

  // ---- step 3: hard caps ---------------------------------------------------
  const qualityMinutes = Math.round(totalMinutes * QUALITY_SESSION_MINUTE_SHARE);
  const longRunCountsAsQuality = wantsLongRun && longMinutes >= LONG_RUN_QUALITY_THRESHOLD_MIN;
  const qualityAllocated = () => QUALITY_EMPHASIS.reduce((s, k) => s + allocation[k], 0);
  const demote = (reason: string) => {
    const donor = QUALITY_EMPHASIS.filter((k) => allocation[k] > 0).sort(
      (a, b) => profile.emphasis[a] - profile.emphasis[b]
    )[0];
    if (!donor) return false;
    allocation[donor] -= 1;
    allocation.aerobic_base += 1;
    if (reason && !notes.includes(reason)) notes.push(reason);
    return true;
  };

  // A quality session shorter than its own warm-up is not a quality session.
  if (qualityMinutes < MIN_QUALITY_SESSION_MIN) {
    while (qualityAllocated() > 1 && demote("")) {
      /* keep one, fold the rest into easy volume */
    }
    if (qualityAllocated() > 0) {
      notes.push(
        `One quality session this week rather than several — at ${Math.round(totalMinutes)} weekly minutes, ` +
          `splitting the hard work further would leave none of it long enough to do anything.`
      );
    }
  }

  // At most three quality endurance sessions in a week, whatever the vector
  // says. F10: a long run over 75 minutes counts toward that ceiling.
  while (qualityAllocated() + (longRunCountsAsQuality ? 1 : 0) > MAX_QUALITY_ENDURANCE_SESSIONS) {
    if (!demote(`Quality capped at ${MAX_QUALITY_ENDURANCE_SESSIONS} sessions this week — the slot moves to easy volume.`)) break;
  }

  const spec = STRENGTH_PHASE_SPEC[phase];
  const heavyLoads = spec.pct[1] > HEAVY_LOWER_BODY_LOAD_THRESHOLD;

  // ---- step 4: reconcile against the phase's TID target --------------------
  // Where emphasis and phase conflict, phase wins in specific/peak/taper and
  // emphasis wins in base/build. Early in a block the diagnostic knows better
  // than the calendar what this athlete needs; close to the event, the
  // calendar knows better than the diagnostic what the event demands.
  const phaseGovernsTid = phase === "specific" || phase === "peak" || phase === "taper";

  // A quality FLOOR in every phase, not just the ones where the phase governs.
  //
  // Emphasis winning in base and build was letting a dominant aerobic_base
  // weight drive quality to zero for the whole first half of a block — an
  // athlete chasing a sub-18 5k was getting nothing but easy and long runs
  // for six weeks. No emphasis vector legitimately outputs "no quality at
  // all" for someone with a race goal: even the base phase's own TID target
  // is 80/15/5, which is 20% quality, not none. Emphasis still decides how
  // much ABOVE the floor and which kind; it does not get to decide none.
  if (
    !phaseGovernsTid &&
    mode.endurance === "develop" &&
    !deload &&
    qualityMinutes >= MIN_QUALITY_SESSION_MIN &&
    qualityAllocated() < MMD_ENDURANCE_QUALITY_PER_WEEK &&
    allocation.aerobic_base > (wantsLongRun ? 2 : 1)
  ) {
    const receiver = qualityKindForSlot(phase, week.week, profile, repSessionsAllowed);
    allocation[receiver] += 1;
    allocation.aerobic_base -= 1;
    notes.push(
      "One quality session is held in every week outside a deload — a block of nothing but easy running will not " +
        "move a 5k, whatever your emphasis says."
    );
  }

  if (phaseGovernsTid && qualityMinutes >= MIN_QUALITY_SESSION_MIN) {
    const [, z2, z3] = TID_BY_PHASE[phase];
    const floor = deload || phase === "taper" ? 1 : MMD_ENDURANCE_QUALITY_PER_WEEK;
    const targetQuality = Math.min(
      MAX_QUALITY_ENDURANCE_SESSIONS - (longRunCountsAsQuality ? 1 : 0),
      Math.max(floor, Math.round(enduranceSlots * (z2 + z3)))
    );
    let current = qualityAllocated();
    while (current > targetQuality && demote("")) current--;
    while (current < targetQuality && allocation.aerobic_base > (wantsLongRun ? 2 : 1)) {
      // The phase decides HOW MUCH quality; the emphasis vector still decides
      // WHICH quality.
      const receiver = qualityKindForSlot(phase, week.week + current, profile, repSessionsAllowed);
      allocation[receiver] += 1;
      allocation.aerobic_base -= 1;
      current++;
    }
  }

  // ---- build the endurance sessions ---------------------------------------
  // Emphasis decides HOW MANY quality sessions; the phase and the week decide
  // WHICH KIND. Taking the kind straight from the allocation meant an athlete
  // whose threshold weight edged out their vo2max weight got eleven
  // consecutive weeks of threshold running and never one interval session —
  // for a 5k goal, which is heavily vVO2max-dependent.
  const qualityCount = QUALITY_EMPHASIS.reduce((sum, k) => sum + allocation[k], 0);
  const qualitySlots: EmphasisKey[] = Array.from({ length: qualityCount }, (_, i) =>
    qualityKindForSlot(phase, week.week + i, profile, repSessionsAllowed)
  );

  for (const emphasisKey of qualitySlots) {
    const kind = ENDURANCE_EMPHASIS_TO_KIND[emphasisKey];
    const findingId = attributeFinding(emphasisKey, profile.findings) ?? "hybrid-baseline";
    const progression = qualityProgressionFor(kind, week, profile, goal);
    const minutes = Math.max(MIN_QUALITY_SESSION_MIN, qualityMinutes);
    const prescription = prescribeEndurance(profile, kind, findingId, {
      minutes,
      suppressHeartRate,
      ...progression,
    });
    sessions.push(
      makeSession(kind, "endurance", emphasisKey, findingId, prescription, {
        intensity: kind === "interval_run" ? 0.95 : kind === "rep_run" ? 0.9 : 0.8,
        isQuality: true,
        minutes,
      })
    );
  }

  if (wantsLongRun) {
    const findingId = attributeFinding("aerobic_base", profile.findings) ?? "hybrid-baseline";
    const prescription = prescribeEndurance(profile, "long_run", findingId, {
      minutes: longMinutes,
      suppressHeartRate,
      // F13: strides close the long run. Cheap neuromuscular exposure that
      // costs nothing aerobically and was absent from Rev A entirely.
      extra: "Finish with 6x20s strides, walking back to full recovery between.",
    });
    sessions.push(
      makeSession("long_run", "endurance", "aerobic_base", findingId, prescription, {
        intensity: 0.45,
        // F10 — a long run past 75 minutes is quality for spacing purposes.
        isQuality: longRunCountsAsQuality,
        minutes: longMinutes,
      })
    );
  }

  const easySlots = Math.max(0, allocation.aerobic_base - (wantsLongRun ? 1 : 0));
  const usedMinutes = sessions.reduce((s, x) => s + x.minutes, 0);
  const easyMinutes =
    easySlots > 0
      ? Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round((totalMinutes - usedMinutes) / easySlots))
      : 0;
  for (let i = 0; i < easySlots; i++) {
    const findingId = attributeFinding("aerobic_base", profile.findings) ?? "hybrid-baseline";
    const kind: EnduranceKind = phase === "taper" ? "recovery_run" : "easy_run";
    // Strides are how neuromuscular work is delivered outside the specific
    // and peak phases — the dimension's weight bought this, and it is spent
    // here rather than silently dropped.
    const stridesHere = !repSessionsAllowed && phase !== "taper" && i < 2;
    const prescription = prescribeEndurance(profile, kind, findingId, {
      minutes: easyMinutes,
      suppressHeartRate,
      extra: stridesHere ? "Finish with 6x20s strides, walking back to full recovery between." : undefined,
    });
    sessions.push(
      makeSession(kind, "endurance", "aerobic_base", findingId, prescription, {
        intensity: kind === "recovery_run" ? 0.3 : 0.35,
        isQuality: false,
        minutes: easyMinutes,
      })
    );
  }

  // ---- build the strength sessions ----------------------------------------
  // F8: lift-specific days, not "lower/upper". Deadlift frequency is
  // deliberately lowest — highest systemic fatigue cost, competes most
  // directly with running.
  const weakLiftSlots = allocation.weak_lift;
  const rotationSlots = Math.max(0, strengthSlots - weakLiftSlots);
  // The split the athlete chose decides how the week is carved up; the
  // emphasis vector still decides how hard each day is and which lift leads
  // it. Handing someone a "bench day" when they train push/pull/legs reads as
  // a fragment of a session rather than a session.
  const split = TRAINING_SPLITS[constraints.trainingSplit ?? DEFAULT_TRAINING_SPLIT];
  const splitDays = split.days;
  // The split governs in BOTH modes. Maintenance previously hardcoded
  // squat+bench and ignored the athlete's choice entirely, so someone who
  // asked for push/pull/legs got a bench day and a squat day.
  const rotation = splitDays.map((d) => d.primaryLift ?? "squat").slice(0, Math.max(2, rotationSlots));

  // Whether the athlete can actually perform what is about to be prescribed.
  // `constraints.equipment` was previously written and never read, so a
  // no-gym athlete was still handed a barbell rotation — the gym-access
  // question was collected, stored, and then ignored by the only code that
  // mattered.
  const hasBarbell = constraints.equipment.includes("barbell");

  let heavyLowerUsed = false;
  for (let i = 0; i < Math.min(rotationSlots, rotation.length); i++) {
    const lift = rotation[i];

    if (mode.strength === "maintain") {
      const findingId = attributeFinding("maximal_strength", profile.findings) ?? "hybrid-baseline";
      const maintDay = splitDays[i % splitDays.length];
      const prescription = prescribeLift(profile, findingId, {
        lift,
        // No barbell: a substitution, named as one. See NO_GYM_SUBSTITUTIONS.
        substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
        sets: MAINTENANCE_SETS,
        // Spiering's dose holds INTENSITY; it does not require doubles. Three
        // to five keeps the load high enough to maintain without making a
        // maintenance week read like a peaking week.
        reps: MAINTENANCE_REPS,
        intensity: capIntensity([MMD_STRENGTH_MIN_INTENSITY, MMD_STRENGTH_MIN_INTENSITY + 0.05], intensityCeiling),
        rir: [2, 3],
        // A maintenance session is still a session. Prescribing one lift and
        // nothing else is not a gym visit anybody would make.
        accessories: accessoriesForDay(maintDay, lift, week.week),
      });
      sessions.push(
        makeSession("strength_maintenance", "strength", "maximal_strength", findingId, prescription, {
          intensity: MMD_STRENGTH_MIN_INTENSITY,
          isQuality: false,
          lift,
          label: maintDay.label,
        })
      );
      continue;
    }

    // Which strength emphasis this slot serves decides the rep scheme. This
    // is where the diagnostic's rep-profile gap actually changes what the
    // athlete does: an under-expressed athlete gets heavy singles, an
    // under-built one gets accumulation volume, out of the same phase.
    const emphasisKey: EmphasisKey =
      profile.emphasis.maximal_strength >= profile.emphasis.strength_endurance
        ? "maximal_strength"
        : "strength_endurance";
    const findingId = attributeFinding(emphasisKey, profile.findings) ?? "hybrid-baseline";

    // The emphasis dimension shifts the athlete one step along the phase
    // ladder — it does NOT set reps and load independently. Pairing the
    // maximal-strength rep range with a base-phase percentage produces
    // "4x1-3 @ 65-75% 1RM", which is not a heavy single, it is a fast
    // sub-maximal rep with a rep target that makes no sense against the load.
    // Load and rep range have to move together or neither is a prescription.
    // Peaking a total and building general strength are different jobs. The
    // phase ladder descends toward singles because it exists to peak three
    // lifts on a date; an athlete with no numeric target wants size and
    // strength, and 2 reps at 80% delivers neither.
    const peakingATotal = goal.targetTotalKg != null || goal.targetSquatKg != null ||
      goal.targetBenchKg != null || goal.targetDeadliftKg != null;
    const shifted = peakingATotal
      ? shiftPhaseSpec(phase, emphasisKey)
      : GENERAL_STRENGTH_SPEC[
          Math.min(
            GENERAL_STRENGTH_SPEC.length - 1,
            Math.floor(blockProgress(week) * GENERAL_STRENGTH_SPEC.length)
          )
        ];
    const sets = Math.max(2, shifted.sets - (deload ? 1 : 0));
    const reps = shifted.reps;
    // The health screen's ceiling lands here. An athlete carrying an injury
    // gets the same session structure at a load they can actually train
    // through, which is what asking about the injury was for.
    const intensity = capIntensity(shifted.pct, intensityCeiling);
    const rir = shifted.rir;

    // Accessories follow the day's patterns rather than the single lift, so a
    // "Push" day is a push session rather than a bench press with two
    // afterthoughts attached.
    const splitDay = splitDays[i % splitDays.length];
    const accessories = accessoriesForDay(splitDay, lift, week.week);
    const prescription = prescribeLift(profile, findingId, {
      lift,
      // No barbell: substitute the pattern and say plainly it is a
      // substitution rather than silently swapping the lift.
      substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
      // Peaking a total means meeting the competition lift every week. Anyone
      // else gets the pattern led by a rotating variation instead, which is
      // the same training with less monotony.
      variant: hasBarbell ? primaryExerciseFor(lift, week.week, peakingATotal) : undefined,
      sets,
      reps: hasBarbell ? reps : NO_GYM_REP_RANGE,
      intensity,
      rir,
      accessories,
    });

    if (lift === "squat") {
      const isHeavy: boolean = heavyLoads && !heavyLowerUsed;
      heavyLowerUsed = heavyLowerUsed || isHeavy;
      sessions.push(
        makeSession(isHeavy ? "squat_heavy" : "squat_volume", "strength", emphasisKey, findingId, prescription, {
          intensity: isHeavy ? 0.9 : 0.7,
          isQuality: heavyLoads,
          isHeavyLower: isHeavy,
          lift,
          label: splitDay.label,
        })
      );
    } else if (lift === "deadlift") {
      sessions.push(
        makeSession(heavyLoads ? "deadlift_heavy" : "deadlift_volume", "strength", emphasisKey, findingId, prescription, {
          intensity: heavyLoads ? 0.9 : 0.72,
          isQuality: heavyLoads,
          isHeavyLower: heavyLoads,
          isDeadlift: true,
          lift,
          label: splitDay.label,
        })
      );
    } else {
      sessions.push(
        makeSession(heavyLoads ? "bench_heavy" : "bench_volume", "strength", emphasisKey, findingId, prescription, {
          intensity: heavyLoads ? 0.88 : 0.65,
          isQuality: false,
          lift,
          label: splitDay.label,
        })
      );
    }
  }

  // A weak lift earns an EXTRA weekly exposure at moderate load, on top of
  // the rotation — that is what the 2.5x multiplier on the weak_lift
  // dimension is buying, and without this it would buy nothing at all.
  if (mode.strength === "develop" && weakLiftSlots > 0) {
    const lift = profile.weakLift ?? rotation[0];
    const findingId = attributeFinding("weak_lift", profile.findings) ?? "hybrid-baseline";
    const wl = LIFT_PRESCRIPTIONS.weak_lift;
    for (let i = 0; i < weakLiftSlots; i++) {
      const prescription = prescribeLift(profile, findingId, {
        lift,
        // No barbell: a substitution, named as one. See NO_GYM_SUBSTITUTIONS.
        substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
        sets: wl.sets,
        reps: [wl.repsLow, wl.repsHigh],
        intensity: [wl.intensityLow, wl.intensityHigh],
        rir: [2, 3],
      });
      sessions.push(
        makeSession("weak_lift_exposure", "strength", "weak_lift", findingId, prescription, {
          intensity: wl.intensityHigh,
          isQuality: false,
          lift,
          // Named for what it is. This session exists outside the split — it is
          // an extra exposure the diagnostic bought for a lagging lift — so
          // borrowing a "Push"/"Pull" label would misdescribe it.
          label: `Extra ${lift} exposure`,
        })
      );
    }
  }

  return { sessions, allocation, notes };
}
