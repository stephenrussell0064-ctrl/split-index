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
  LIFT_ROTATION,
  LONG_RUN_MINUTE_SHARE,
  LONG_RUN_QUALITY_THRESHOLD_MIN,
  LONG_RUN_MIN_WEEKLY_CARDIO,
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
import { qualityProgressionFor } from "./progression";

export type SessionKind = EnduranceKind | "squat_heavy" | "squat_volume" | "deadlift_heavy" | "deadlift_volume" | "bench_heavy" | "bench_volume" | "strength_maintenance" | "weak_lift_exposure";

export interface PlannedSession {
  kind: SessionKind;
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

function makeSession(
  kind: SessionKind,
  domain: "endurance" | "strength",
  emphasisKey: EmphasisKey,
  findingId: FindingId,
  prescription: Prescription,
  opts: { intensity: number; isQuality: boolean; minutes?: number; isHeavyLower?: boolean; isDeadlift?: boolean; lift?: string }
): PlannedSession {
  const minutes = opts.minutes ?? 0;
  return {
    kind,
    domain,
    intensity: opts.intensity,
    isQuality: opts.isQuality,
    minutes,
    isHeavyLower: opts.isHeavyLower ?? false,
    isDeadlift: opts.isDeadlift ?? false,
    lift: opts.lift,
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

export function buildSessionSet(input: SessionSetInput): SessionSet {
  const { profile, week, mode, goal, constraints, suppressHeartRate = false, autoregMultiplier = 1 } = input;
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
  // In a week with few enough runs that the long one IS most of the week, it
  // takes a proportional share rather than a fixed 28% — otherwise a
  // two-session deload week prescribes a "long run" shorter than its easy run.
  const longShare =
    enduranceSlots >= LONG_RUN_MIN_WEEKLY_CARDIO ? LONG_RUN_MINUTE_SHARE : 1 / Math.max(1, enduranceSlots);
  const longMinutes = Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(totalMinutes * longShare));
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
      const receiver = QUALITY_EMPHASIS.filter((k) => repSessionsAllowed || k !== "neuromuscular").sort(
        (a, b) => profile.emphasis[b] - profile.emphasis[a]
      )[0];
      allocation[receiver] += 1;
      allocation.aerobic_base -= 1;
      current++;
    }
  }

  // ---- build the endurance sessions ---------------------------------------
  const qualitySlots = QUALITY_EMPHASIS.flatMap((k) => Array.from({ length: allocation[k] }, () => k));

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
  const rotationSize = Math.min(4, Math.max(2, rotationSlots)) as 2 | 3 | 4;
  const rotation = mode.strength === "maintain" ? ["squat", "bench"] : LIFT_ROTATION[rotationSize];

  let heavyLowerUsed = false;
  for (let i = 0; i < Math.min(rotationSlots, rotation.length); i++) {
    const lift = rotation[i];

    if (mode.strength === "maintain") {
      const findingId = attributeFinding("maximal_strength", profile.findings) ?? "hybrid-baseline";
      const prescription = prescribeLift(profile, findingId, {
        lift,
        sets: 3,
        reps: [2, 2],
        intensity: [MMD_STRENGTH_MIN_INTENSITY, MMD_STRENGTH_MIN_INTENSITY],
        rir: [2, 2],
      });
      sessions.push(
        makeSession("strength_maintenance", "strength", "maximal_strength", findingId, prescription, {
          intensity: MMD_STRENGTH_MIN_INTENSITY,
          isQuality: false,
          lift,
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
    const shifted = shiftPhaseSpec(phase, emphasisKey);
    const sets = Math.max(2, shifted.sets - (deload ? 1 : 0));
    const reps = shifted.reps;
    const intensity = shifted.pct;
    const rir = shifted.rir;

    const accessories = lift === "bench" ? ["2 upper accessories 3x8-10"] : undefined;
    const prescription = prescribeLift(profile, findingId, { lift, sets, reps, intensity, rir, accessories });

    if (lift === "squat") {
      const isHeavy: boolean = heavyLoads && !heavyLowerUsed;
      heavyLowerUsed = heavyLowerUsed || isHeavy;
      sessions.push(
        makeSession(isHeavy ? "squat_heavy" : "squat_volume", "strength", emphasisKey, findingId, prescription, {
          intensity: isHeavy ? 0.9 : 0.7,
          isQuality: heavyLoads,
          isHeavyLower: isHeavy,
          lift,
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
        })
      );
    } else {
      sessions.push(
        makeSession(heavyLoads ? "bench_heavy" : "bench_volume", "strength", emphasisKey, findingId, prescription, {
          intensity: heavyLoads ? 0.88 : 0.65,
          isQuality: false,
          lift,
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
        })
      );
    }
  }

  return { sessions, allocation, notes };
}
