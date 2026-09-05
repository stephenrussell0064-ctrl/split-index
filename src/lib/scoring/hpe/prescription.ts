/**
 * Hybrid Plan Engine — WP7: prescription resolution.
 *
 * Closes F9 (Major): "Rev A output the string `easy_run`. A plan that does
 * not say how far, how fast, and at what heart rate is not a plan."
 *
 * Every session emits distance, split and heart rate, all resolved from the
 * athlete's OWN data:
 *
 *  - **Distance and duration: both, always.** `9.4km in 45min` beats either
 *    alone.
 *  - **Split:** a band in mm:ss/km derived from the athlete's predicted 5k
 *    pace using their own k, plus per-rep target times for interval sessions.
 *  - **Heart rate:** from the athlete's own HR-vs-pace regression where the
 *    pace falls inside the fitted range; from HR reserve otherwise; ALWAYS
 *    clamped to their measured or estimated max; and the source is stated in
 *    the prescription string so the athlete knows how much to trust it.
 *  - **Easy runs carry an upper HR bound as the primary instruction**,
 *    because the diagnostic's most common finding is easy running done too
 *    hard.
 *  - **Lifts:** load in kg and %1RM, sets, rep range, RIR, plus the variation
 *    where a lift is stalled.
 *  - **Cadence: captured and reported as a trend, never prescribed.** The
 *    evidence for imposing a cadence target is weak, individual optima vary
 *    widely, and a step change in cadence is a plausible injury pathway.
 *    Report it; do not coach it. `cadenceNote` is the only cadence output in
 *    this module and it is descriptive.
 *
 * Where `medicationAffectingHr` is set, HR is dropped entirely and the
 * session is prescribed by pace and RPE — prescribing zones to someone on
 * beta blockers is a straightforward way to produce a useless plan.
 */

import {
  ACCESSORY_RIR_LOAD_HAIRCUT,
  COMPETITION_LIFT_DISPLAY_NAME,
  EPLEY_DIVISOR,
  INTERVAL_RECOVERY_S,
  INTERVAL_REPS_MAX,
  INTERVAL_REPS_MIN,
  INTERVAL_REP_METERS,
  INTERVAL_WORK_FRACTION,
  GREY_ZONE_EASY_BIAS,
  LONG_RUN_VS_EASY,
  RECOVERY_VS_EASY,
  REP_RUN_METERS,
  REP_RUN_RECOVERY_S,
  REP_RUN_REPS,
  SESSION_HR_RESERVE_BANDS,
  SESSION_PACE_BANDS,
  STALL_VARIATIONS,
  THRESHOLD_BLOCKS_LONG,
  THRESHOLD_BLOCKS_SHORT,
  THRESHOLD_BLOCK_SPLIT_MINUTES,
  THRESHOLD_RECOVERY_S,
  THRESHOLD_WORK_FRACTION,
  WEIGHT_ROUNDING_KG,
} from "./constants";
import { predictHrAtPace } from "./diagnostics";
// modality.ts imports `EnduranceKind` from this file as a TYPE only, so this is
// not a runtime cycle — the type import is erased before either module loads.
import {
  MODALITY_SPEC,
  formatModalityBand,
  metresAtPace,
  modalityPaceBand,
  type ModalityFitness,
} from "./modality";
import type { AthleteProfile, FindingId } from "./types";

export type EnduranceKind = "recovery_run" | "easy_run" | "long_run" | "threshold_run" | "interval_run" | "rep_run";

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function roundToPlate(kg: number): number {
  return Math.round(kg / WEIGHT_ROUNDING_KG) * WEIGHT_ROUNDING_KG;
}

// ---------------------------------------------------------------------------
// Pace bands
// ---------------------------------------------------------------------------

/**
 * The pace band for a session kind. Easy, long and recovery are anchored to
 * the diagnostic's own three-anchor easy band — NOT to a multiple of 5k pace,
 * which is the defect critical implementation note 1 exists to prevent.
 * Quality sessions use the 5k multipliers, which is appropriate: those paces
 * genuinely are defined relative to race pace.
 */
/**
 * The athlete's own diagnostic says they run easy days too hard, and they have
 * never logged a run inside their easy heart-rate band. Handing them the full
 * band hands them the fast end, which is exactly the habit the finding is
 * about — so the prescription narrows to the slower portion of their own band.
 */
function runsEasyTooHard(profile: AthleteProfile): boolean {
  const ids = new Set(profile.findings.map((f) => f.id));
  return ids.has("grey-zone") && profile.runsInsideEasyBand === 0;
}

export function paceBandFor(profile: AthleteProfile, kind: EnduranceKind): { lo: number; hi: number } {
  const easy = profile.easyBand;
  if (easy && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")) {
    if (runsEasyTooHard(profile)) {
      // Slower portion only. The band is unchanged; where inside it we
      // prescribe is what moves.
      const biasedLo = easy.lo + (easy.hi - easy.lo) * GREY_ZONE_EASY_BIAS;
      if (kind === "recovery_run") return { lo: biasedLo * RECOVERY_VS_EASY[0], hi: easy.hi * RECOVERY_VS_EASY[1] };
      if (kind === "long_run") return { lo: biasedLo * LONG_RUN_VS_EASY[0], hi: easy.hi * LONG_RUN_VS_EASY[1] };
      return { lo: biasedLo, hi: easy.hi };
    }
    if (kind === "recovery_run") return { lo: easy.lo * RECOVERY_VS_EASY[0], hi: easy.hi * RECOVERY_VS_EASY[1] };
    if (kind === "long_run") return { lo: easy.lo * LONG_RUN_VS_EASY[0], hi: easy.hi * LONG_RUN_VS_EASY[1] };
    return { lo: easy.lo, hi: easy.hi };
  }
  const base = profile.predicted5kS / 5.0;
  const band = SESSION_PACE_BANDS[kind] ?? SESSION_PACE_BANDS.easy_run;
  return { lo: base * band[0], hi: base * band[1] };
}

// ---------------------------------------------------------------------------
// Heart rate, with its source stated
// ---------------------------------------------------------------------------

export interface HrBand {
  lo: number;
  hi: number;
  /** Stated in the prescription string so the athlete knows how much to trust it. */
  source: string;
}

/**
 * Resolution order, and the reason for it:
 *
 *  1. Easy/long/recovery use the physiological band from HR reserve. The
 *     ceiling must come from HR reserve, never from observed behaviour —
 *     fitting it to how hard the athlete currently runs would launder an
 *     existing bad habit into a prescription.
 *  2. Quality sessions try the athlete's own regression first.
 *  3. Outside the regression's fitted range it REFUSES and falls back to HR
 *     reserve, labelling the fallback honestly.
 *
 * Every path clamps to the athlete's max. There is no path that does not.
 */
export function hrBandFor(profile: AthleteProfile, kind: EnduranceKind, paceBand: { lo: number; hi: number }): HrBand | null {
  const { hrMax, hrRest } = profile;
  const clamp = (v: number) => Math.min(hrMax, Math.max(hrRest, Math.round(v)));

  if (profile.easyBand && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")) {
    return {
      lo: clamp(profile.easyBand.hrLo),
      hi: clamp(profile.easyBand.hrHi),
      source: "physiological easy band from HR reserve",
    };
  }

  // Rep runs are neuromuscular, not aerobic — heart rate is not the target
  // and pretending otherwise invites the athlete to chase it.
  if (kind === "rep_run") return null;

  const fromModelLo = predictHrAtPace(profile.hrPaceModel, paceBand.hi, hrMax, hrRest);
  const fromModelHi = predictHrAtPace(profile.hrPaceModel, paceBand.lo, hrMax, hrRest);
  if (fromModelLo != null && fromModelHi != null) {
    return {
      lo: clamp(Math.min(fromModelLo, fromModelHi)),
      hi: clamp(Math.max(fromModelLo, fromModelHi)),
      source: "from your own HR-vs-pace data",
    };
  }

  const reserve = SESSION_HR_RESERVE_BANDS[kind] ?? SESSION_HR_RESERVE_BANDS.easy_run;
  return {
    lo: clamp(hrRest + reserve[0] * (hrMax - hrRest)),
    hi: clamp(hrRest + reserve[1] * (hrMax - hrRest)),
    source: "HR reserve — this pace is outside the range your own HR data covers",
  };
}

// ---------------------------------------------------------------------------
// Endurance prescriptions
// ---------------------------------------------------------------------------

export interface EndurancePrescriptionOptions {
  minutes: number;
  /** F15: interval rep count, recovery and target pace progress across the block. See progression.ts. */
  intervalReps?: number;
  intervalRecoveryS?: number;
  thresholdBlockMin?: number;
  /** Overrides the derived pace band — used by the F15 progression to move rep pace from current toward target 5k pace. */
  paceOverride?: { lo: number; hi: number };
  /** Beta blockers and similar: drop HR, prescribe by pace and RPE. */
  suppressHeartRate?: boolean;
  /** Appended verbatim — e.g. the strides that close a long run (F13). */
  extra?: string;
}

export interface Prescription {
  text: string;
  /** Why this session looks the way it does. Kept out of `text` so rationale never reads as an exercise. */
  notes?: string[];
  /** Non-negotiable #7: if the engine cannot say WHY this athlete is doing this session, it does not prescribe it. */
  findingId: FindingId;
  /** Present for every endurance session — WP7 requires distance and duration together, always. */
  distanceKm?: number;
  minutes: number;
  paceLoSPerKm?: number;
  paceHiSPerKm?: number;
  hrLo?: number;
  hrHi?: number;
  hrSource?: string;
}

export function prescribeEndurance(
  profile: AthleteProfile,
  kind: EnduranceKind,
  findingId: FindingId,
  options: EndurancePrescriptionOptions
): Prescription {
  const { minutes, suppressHeartRate = false } = options;
  const band = options.paceOverride ?? paceBandFor(profile, kind);
  const mid = (band.lo + band.hi) / 2;
  const hr = suppressHeartRate ? null : hrBandFor(profile, kind, band);

  const hrText = hr
    ? `HR ${hr.lo}-${hr.hi} (${hr.source})`
    : kind === "rep_run"
      ? "Neuromuscular, not aerobic — HR is not the target"
      : "Prescribed by pace and RPE (heart-rate zones are not meaningful on your medication)";

  const paceText = `${mmss(band.lo)}-${mmss(band.hi)}/km`;

  if (kind === "interval_run") {
    const reps = Math.min(
      INTERVAL_REPS_MAX,
      Math.max(INTERVAL_REPS_MIN, options.intervalReps ?? Math.round((minutes * 60 * INTERVAL_WORK_FRACTION) / mid))
    );
    const recovery = options.intervalRecoveryS ?? INTERVAL_RECOVERY_S;
    const repTime = (INTERVAL_REP_METERS / 1000) * mid;
    return {
      text:
        `${reps} x ${INTERVAL_REP_METERS}m in ${mmss(repTime)} each (${paceText}), ${recovery}s jog recovery. ` +
        `${hrText} on the reps. About ${((reps * INTERVAL_REP_METERS) / 1000).toFixed(1)}km of work inside a ` +
        `${Math.round(minutes)}min session.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: (reps * INTERVAL_REP_METERS) / 1000,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  if (kind === "threshold_run") {
    const blocks = minutes < THRESHOLD_BLOCK_SPLIT_MINUTES ? THRESHOLD_BLOCKS_SHORT : THRESHOLD_BLOCKS_LONG;
    const perBlockMin = options.thresholdBlockMin ?? (minutes * THRESHOLD_WORK_FRACTION) / blocks;
    const perBlockKm = (perBlockMin * 60) / mid;
    return {
      text:
        `${blocks} x ${perBlockMin.toFixed(0)}min at ${paceText} (about ${perBlockKm.toFixed(1)}km per block), ` +
        `${THRESHOLD_RECOVERY_S / 60}min jog between. ${hrText}. ${Math.round(minutes)}min total including ` +
        `warm-up and cooldown.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: blocks * perBlockKm,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  if (kind === "rep_run") {
    return {
      text:
        `${REP_RUN_REPS} x ${REP_RUN_METERS}m in ${mmss(mid * (REP_RUN_METERS / 1000))} each (${paceText}), ` +
        `full ${REP_RUN_RECOVERY_S}s recovery. ${hrText} — run these for turnover and economy, not for effort. ` +
        `${Math.round(minutes)}min including warm-up.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: (REP_RUN_REPS * REP_RUN_METERS) / 1000,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
    };
  }

  // Continuous runs — easy, long, recovery.
  const distanceKm = (minutes * 60) / mid;
  const upperBoundLine =
    hr && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")
      ? ` Do not exceed ${hr.hi} — on easy days the upper bound matters more than the lower one.`
      : "";
  return {
    text:
      `${distanceKm.toFixed(1)}km in ${Math.round(minutes)}min at ${paceText}. ${hrText}.${upperBoundLine}` +
      `${options.extra ? ` ${options.extra}` : ""}`,
    findingId,
    distanceKm,
    minutes,
    paceLoSPerKm: band.lo,
    paceHiSPerKm: band.hi,
    hrLo: hr?.lo,
    hrHi: hr?.hi,
    hrSource: hr?.source,
  };
}

// ---------------------------------------------------------------------------
// Endurance prescriptions in a modality that is not running
// ---------------------------------------------------------------------------

/**
 * The same session, prescribed in the athlete's own sport's units.
 *
 * Kept as a separate function rather than a branch inside `prescribeEndurance`
 * on purpose. Everything above this line is denominated in running seconds per
 * kilometre and is fitted on `RunLog`; threading a modality through it would
 * have meant either converting rowing into fake running pace (the failure this
 * exists to prevent) or rewriting the running path, which is the one part of
 * this engine with a calibrated regression suite behind it. Two functions that
 * each say one true thing beat one function that says two half-true ones.
 *
 * Three deliberate omissions:
 *
 *  - `paceLoSPerKm` / `paceHiSPerKm` are NOT set. They are read downstream and
 *    formatted unconditionally as "mm:ss/km"; putting a 500m split in them
 *    would print a rower's 2:05/500m as "2:05/km", which is the exact class of
 *    lie this module was written to stop. The sport-correct pace lives in
 *    `text`, where it is already carrying its own unit.
 *  - No heart rate for swimming beyond the band itself — see the HRmax offsets
 *    in `MODALITY_SPEC`, which are applied here so an easy swim is not
 *    prescribed at a heart rate the athlete cannot reach in water.
 *  - No pace at all when the athlete has logged nothing in the modality. The
 *    session is then prescribed by RPE and says why, rather than inheriting a
 *    number from a sport they do not do.
 */
export interface ModalityPrescriptionOptions {
  minutes: number;
  suppressHeartRate?: boolean;
  extra?: string;
}

export function prescribeModalityEndurance(
  profile: AthleteProfile,
  fitness: ModalityFitness,
  kind: EnduranceKind,
  findingId: FindingId,
  options: ModalityPrescriptionOptions
): Prescription {
  const { minutes, suppressHeartRate = false } = options;
  const modality = fitness.modality;
  const spec = MODALITY_SPEC[modality];
  const band = modalityPaceBand(fitness, kind);

  // HRmax is modality-specific. Applying the running maximum to a swim set
  // prescribes a rate the athlete cannot reach face-down in water, which turns
  // every "easy" swim into a maximal one.
  const hrMax = Math.max(profile.hrRest + 30, profile.hrMax + spec.hrMaxOffset);
  const hrRest = profile.hrRest;
  const reserve = SESSION_HR_RESERVE_BANDS[kind] ?? SESSION_HR_RESERVE_BANDS.easy_run;
  const clamp = (v: number) => Math.min(hrMax, Math.max(hrRest, Math.round(v)));
  const hr = suppressHeartRate
    ? null
    : {
        lo: clamp(hrRest + reserve[0] * (hrMax - hrRest)),
        hi: clamp(hrRest + reserve[1] * (hrMax - hrRest)),
        source:
          spec.hrMaxOffset === 0
            ? "HR reserve"
            : `HR reserve, with your maximum taken ${Math.abs(spec.hrMaxOffset)} lower than running — ` +
              `${spec.label.toLowerCase()} peaks below a running maximum in almost everyone`,
      };

  const hrText = hr
    ? `HR ${hr.lo}-${hr.hi} (${hr.source})`
    : "Prescribed by effort (heart-rate zones are not meaningful on your medication)";

  const paceText = band ? formatModalityBand(band, modality) : null;
  const noPaceNote = band
    ? null
    : `No ${spec.label.toLowerCase()} pace target yet — nothing in this modality is logged for the engine to ` +
      `anchor one to, so this is prescribed by effort. A single hard effort turns every band below into your own numbers.`;

  const notes: string[] = [];
  if (noPaceNote) notes.push(noPaceNote);
  if (band && fitness.benchmarkSource === "projected") {
    notes.push(
      `Paces come from your logged ${spec.label.toLowerCase()} projected to a benchmark effort, not from a ` +
        `benchmark you have actually done — treat them as a starting point rather than a verdict.`
    );
  }

  const tail = options.extra ? ` ${options.extra}` : "";
  const mid = band ? (band.lo + band.hi) / 2 : 0;
  const distanceKm = mid > 0 ? metresAtPace(mid, minutes, modality) / 1000 : undefined;

  // Interval and rep work is expressed in each sport's own repeat distances —
  // 1000m rowing repeats, 200m swimming repeats — not in running's 800s.
  if ((kind === "interval_run" || kind === "rep_run") && spec.qualityCapable && band) {
    const repMeters = kind === "interval_run" ? spec.intervalRepMeters : spec.shortRepMeters;
    const repTimeS = (repMeters / spec.paceUnitMeters) * mid;
    const reps = Math.max(
      3,
      Math.min(10, Math.round((minutes * 60 * (kind === "interval_run" ? 0.55 : 0.3)) / Math.max(1, repTimeS)))
    );
    const recovery = kind === "interval_run" ? 120 : 90;
    return {
      text:
        `${spec.verb} ${reps} x ${repMeters}m in ${mmss(repTimeS)} each (${paceText}), ${recovery}s easy between. ` +
        `${hrText}. About ${((reps * repMeters) / 1000).toFixed(1)}km of work inside a ${Math.round(minutes)}min ` +
        `session.${tail}`,
      notes,
      findingId,
      distanceKm: (reps * repMeters) / 1000,
      minutes,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  if (kind === "threshold_run" && spec.qualityCapable && band) {
    const blocks = minutes < 45 ? 2 : 3;
    const perBlockMin = (minutes * 0.55) / blocks;
    return {
      text:
        `${spec.verb} ${blocks} x ${perBlockMin.toFixed(0)}min at ${paceText}, 3min easy between. ${hrText}. ` +
        `${Math.round(minutes)}min total including warm-up and cooldown.${tail}`,
      notes,
      findingId,
      distanceKm:
        mid > 0 ? (metresAtPace(mid, perBlockMin * blocks, modality) / 1000) : undefined,
      minutes,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  // Continuous — easy, long, recovery, and anything quality-shaped that this
  // modality cannot carry (a walking "interval" becomes a steady walk, named
  // as one, rather than a session nobody can perform).
  const distanceText = distanceKm != null ? `${distanceKm.toFixed(1)}km in ` : "";
  const paceClause = paceText ? ` at ${paceText}` : " at a conversational effort";
  const upperBound =
    hr && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")
      ? ` Do not exceed ${hr.hi} — on easy days the upper bound matters more than the lower one.`
      : "";
  return {
    text: `${spec.verb} ${distanceText}${Math.round(minutes)}min${paceClause}. ${hrText}.${upperBound}${tail}`,
    notes,
    findingId,
    distanceKm,
    minutes,
    hrLo: hr?.lo,
    hrHi: hr?.hi,
    hrSource: hr?.source,
  };
}

// ---------------------------------------------------------------------------
// Strength prescriptions
// ---------------------------------------------------------------------------

export interface LiftPrescriptionOptions {
  lift: string;
  /** Set when the athlete has no barbell. Named as a substitution rather than silently swapped, because it is not an equivalent. */
  substitution?: string;
  sets: number;
  reps: readonly [number, number];
  intensity: readonly [number, number];
  rir: readonly [number, number];
  /**
   * A variation leading the session in place of the competition lift, for an
   * athlete who is not peaking a total. Prescribed by effort rather than by
   * percentage: the 1RM on file belongs to the competition lift, and printing
   * 70-80% of a bench 1RM next to an incline dumbbell press would prescribe a
   * weight nobody can press.
   */
  variant?: string;
  /** Accessory lines appended after the main lift. */
  accessories?: string[];
}

/**
 * The best logged 1RM estimate for a named exercise, or null.
 *
 * Names are matched lower-cased and whitespace-collapsed against
 * `profile.exerciseOneRms`, which is keyed the same way. Several pool lines
 * offer a choice — "Pull-up or lat pulldown", "Cable fly or pec deck" — so
 * each alternative is tried in turn and the athlete's own logged one wins.
 *
 * Returns null rather than a guess. Nothing in here interpolates from a
 * related exercise: an incline press is not a bench press scaled by a
 * constant, and a number the athlete cannot trace to their own log is worse
 * than no number at all.
 */
function loggedOneRmFor(profile: AthleteProfile, name: string): number | null {
  const history = profile.exerciseOneRms;
  if (!history) return null;
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const direct = history[key];
  if (direct != null && direct > 0) return direct;
  for (const alternative of key.split(/\s+or\s+/)) {
    const value = history[alternative.trim()];
    if (value != null && value > 0) return value;
  }
  return null;
}

/** Inverse Epley — the load a set of `reps` represents against a known 1RM. */
function loadForReps(oneRm: number, reps: number): number {
  return oneRm / (1 + reps / EPLEY_DIVISOR);
}

/**
 * A kg band for a rep range, from the athlete's own estimate for that exercise.
 *
 * Accessories are taken near failure but not to it, so the Epley load for a
 * maximal set of that many reps is shaded by `ACCESSORY_RIR_LOAD_HAIRCUT`.
 * Prescribing the maximal load for the top of a 3x12 would be prescribing a
 * set they cannot repeat twice.
 */
function loadBandText(oneRm: number, repLo: number, repHi: number): string {
  const heavy = roundToPlate(loadForReps(oneRm, repLo) * ACCESSORY_RIR_LOAD_HAIRCUT);
  const light = roundToPlate(loadForReps(oneRm, repHi) * ACCESSORY_RIR_LOAD_HAIRCUT);
  const lo = Math.min(heavy, light);
  const hi = Math.max(heavy, light);
  if (lo <= 0) return "";
  return lo === hi ? `${lo.toFixed(0)}kg` : `${lo.toFixed(0)}-${hi.toFixed(0)}kg`;
}

/** Splits "Leg press 3x10-15" into its name and its rep range. Duration work ("3x45s") has no rep range and returns null. */
function parseAccessoryLine(line: string): { name: string; repLo: number; repHi: number } | null {
  const match = /^(.*?)\s(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?(?![\d\s]*s\b)/i.exec(line.trim());
  if (!match) return null;
  const name = match[1].trim();
  const repLo = Number(match[3]);
  const repHi = match[4] != null ? Number(match[4]) : repLo;
  if (!name || !Number.isFinite(repLo) || repLo <= 0) return null;
  return { name, repLo, repHi };
}

/**
 * An accessory line with the athlete's own working weight appended, where
 * their log supports one.
 *
 * Every accessory used to be a bare set-and-rep scheme. "Leg press 3x10-15" is
 * a suggestion; "Leg press 3x10-15 @ 145-165kg" is a prescription, and the app
 * already held every number needed to write the second one. Lines with no
 * logged history are returned untouched — an invented weight is the one
 * outcome worse than an absent one.
 */
export function withLoggedLoad(profile: AthleteProfile, line: string): string {
  const parsed = parseAccessoryLine(line);
  if (!parsed) return line;
  const oneRm = loggedOneRmFor(profile, parsed.name);
  if (oneRm == null) return line;
  const band = loadBandText(oneRm, parsed.repLo, parsed.repHi);
  return band ? `${line} @ ${band}` : line;
}

/**
 * A lift prescription in kg AND %1RM. The kg number is what the athlete
 * loads; the percentage is what tells them whether the kg number still makes
 * sense as their 1RM moves. A stalled lift gets its variation named — the
 * variation block is scheduled before returning to the competition lift.
 */
export function prescribeLift(
  profile: AthleteProfile,
  findingId: FindingId,
  options: LiftPrescriptionOptions
): Prescription {
  const { lift, sets, reps, intensity, rir } = options;
  const oneRm = profile.oneRms[lift] ?? 0;
  const stalled = profile.stalledLifts.includes(lift);
  const variation = stalled ? STALL_VARIATIONS[lift] : null;

  // The rotated variation is prescribed against ITS OWN logged 1RM where the
  // athlete has one. The reason this used to be qualitative is sound — the
  // competition lift's 1RM says nothing about an incline press, and 80% of a
  // bench 1RM beside an incline dumbbell press is a weight nobody can press.
  // But that argument only holds where the variation is UNKNOWN. An athlete
  // who has logged the exercise thirty times was being told "a load you can
  // hold for the reps" about a lift the app could name to the kilogram, which
  // is the app declining to say what it knows.
  //
  // A STALL variation is deliberately left on the old path. It is the
  // competition movement with one thing changed — a pause, a deficit — and
  // anchoring it to the competition 1RM is the point of programming it. It
  // also outranks the rotation for the exercise NAME below, and the load has
  // to be quoted for the exercise actually printed: quoting the rotation's
  // variant beside a name the stall variation won produced "Deficit Deadlift
  // @ 65-75% of your logged Romanian deadlift", two different lifts in one
  // line, which is the same defect the name precedence exists to prevent.
  //
  // A rotation slot that has come back round to the competition lift is not a
  // variation at all — "Back squat" IS the squat — so it takes the ordinary
  // %1RM path rather than being prescribed by effort against a 1RM sitting
  // right there on the profile.
  const namesTheCompetitionLift =
    options.variant != null &&
    options.variant.trim().toLowerCase() === COMPETITION_LIFT_DISPLAY_NAME[lift];
  const rotationVariant = variation || namesTheCompetitionLift ? null : options.variant;
  const variantOneRm = rotationVariant ? loggedOneRmFor(profile, rotationVariant) : null;
  const percentOf = (kg: number, source: string) =>
    `${roundToPlate(kg * intensity[0]).toFixed(0)}-${roundToPlate(kg * intensity[1]).toFixed(0)}kg ` +
    `(${Math.round(intensity[0] * 100)}-${Math.round(intensity[1] * 100)}%${source})`;

  const loadText = options.substitution
    ? "bodyweight or whatever load you have, taken to the RIR below"
    : rotationVariant
      ? variantOneRm != null
        ? percentOf(variantOneRm, ` of your logged ${rotationVariant.toLowerCase()}`)
        : "a load you can hold for the reps"
      : oneRm > 0
      ? percentOf(oneRm, " 1RM")
      : `${Math.round(intensity[0] * 100)}-${Math.round(intensity[1] * 100)}% 1RM (no logged 1RM yet — work to the RIR)`;

  // Precedence, most specific first. A stall variation beats the hypertrophy
  // rotation: the rotation is variety, the stall variation is a diagnostic
  // response to this athlete's lift not moving, and the more specific reason
  // should win. Getting this backwards produced a session led by "Back squat"
  // with a note underneath saying "Pause Squat replaces the competition squat"
  // — two different exercises named in the same breath.
  const name =
    options.substitution ?? variation ?? options.variant ?? lift.charAt(0).toUpperCase() + lift.slice(1);

  // Exercises and rationale are kept apart. Both used to be joined with the
  // same separator, so "Pause Squat replaces the competition squat this block
  // — your squat has not moved in 12 weeks" appeared in the exercise list as
  // though it were an exercise, and counted as one of the session's six.
  const exercises = [`${name} ${sets}x${reps[0]}-${reps[1]} @ ${loadText}, RIR ${rir[0]}-${rir[1]}`];
  const notes: string[] = [];
  if (options.substitution) {
    notes.push(
      `Substituted for the ${lift} because you have no gym access. This trains the same pattern and it is not the ` +
        `same lift — the load is lower and the strength carry-over is smaller, so progress here will be slower ` +
        `than a barbell block would give you.`
    );
  }
  if (variation) {
    notes.push(
      `${variation} replaces the competition ${lift} this block — your ${lift} has not moved in 12 weeks, and ` +
        `a variation block breaks that before you come back to the lift itself.`
    );
  } else if (rotationVariant && rotationVariant.toLowerCase() !== lift) {
    // `rotationVariant`, not `options.variant`. On the weeks the rotation
    // comes back round to the competition lift the raw option is still set —
    // to "Back squat" — and the note fired anyway, telling an athlete about to
    // back squat that they were "leading with a back squat rather than the
    // competition squat". The two names are the same lift; only a genuine
    // variation earns the explanation.
    notes.push(
      `Leading with a ${rotationVariant.toLowerCase()} rather than the competition ${lift}. It trains the same ` +
        `pattern with less joint cost, and your ${lift} improves anyway — you are not peaking a total, so there ` +
        `is nothing here that needs the bar every week.`
    );
  }
  if (options.accessories?.length) {
    exercises.push(...options.accessories.map((line) => withLoggedLoad(profile, line)));
  }

  return { text: exercises.join(" · "), notes, findingId, minutes: 0 };
}

// ---------------------------------------------------------------------------
// Cadence — reported, never prescribed
// ---------------------------------------------------------------------------

/**
 * The evidence for imposing a cadence target is weak, individual optima vary
 * widely, and a step change in cadence is a plausible injury pathway. This
 * returns an observation with no instruction attached, and nothing in the
 * engine consumes it as a target.
 */
export function cadenceNote(recentCadenceSpm: number[] | null): string | null {
  if (!recentCadenceSpm || recentCadenceSpm.length < 3) return null;
  const mean = recentCadenceSpm.reduce((s, c) => s + c, 0) / recentCadenceSpm.length;
  const first = recentCadenceSpm.slice(0, Math.ceil(recentCadenceSpm.length / 2));
  const second = recentCadenceSpm.slice(Math.ceil(recentCadenceSpm.length / 2));
  const drift =
    second.reduce((s, c) => s + c, 0) / second.length - first.reduce((s, c) => s + c, 0) / first.length;
  const direction = Math.abs(drift) < 1 ? "steady" : drift > 0 ? "drifting up" : "drifting down";
  return (
    `Cadence is averaging ${Math.round(mean)} spm and ${direction} over your recent runs. ` +
    `Reported for interest only — this plan does not prescribe a cadence target, because individual optima vary ` +
    `widely and changing it deliberately is a more plausible route to injury than to speed.`
  );
}
