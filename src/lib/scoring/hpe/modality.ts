/**
 * Hybrid Plan Engine — cardio modality.
 *
 * Everything else in `hpe/` that touches endurance is denominated in RUNNING
 * seconds per kilometre. `ingest.ts` says so explicitly and is right to: a
 * `RunLog` carries no sport, the maximal-effort outlier rule, the personal
 * Riegel fit, `predicted5kS`, the easy/quality cutoffs and volume adequacy are
 * all fitted on foot-based running, and a 20 km ride entering that pool as a
 * 2:00/km "run" wrecks the median and the projection at once.
 *
 * That is exactly why an athlete who never runs could not be prescribed
 * anything honest. The old options were to hand them a running plan with the
 * word "row" swapped in — a plan that tells a rower to hold 4:30/km — or to
 * hand them nothing.
 *
 * This module is the third option: a PARALLEL, per-modality pace model that
 * never touches the running one. It reuses two things Split Index already has
 * and neither of which is running-specific:
 *
 *  1. `BENCHMARK_DISTANCE_METERS` — each sport's own canonical benchmark
 *     (row 2k, swim 400m, cycle 20k), already calibrated against real
 *     population data in `cardio-benchmarks.ts`.
 *  2. `BENCHMARK_RIEGEL_K` — each sport's OWN endurance-decay exponent, added
 *     precisely because running's 1.08 is a running number twice over.
 *
 * From those two, one projection gives every modality a threshold anchor in
 * its own units: the pace it could hold for an hour. Every session band is
 * then a fraction of that anchor, which is physiology rather than arithmetic
 * borrowed from another sport — an hour at threshold is an hour at threshold
 * whether the athlete is on an erg, in a pool or on a bike.
 *
 * Nothing here is imported by the running path. `paceBandFor` in
 * `prescription.ts` is untouched, and a running athlete's plan is byte-for-byte
 * what it was before this file existed.
 */

import {
  BENCHMARK_DISTANCE_METERS,
  type BenchmarkSport,
} from "../cardio-benchmarks";
import { benchmarkRiegelK, riegelEquivalentSeconds } from "../cardio-predictions";
import type { ActivityRow } from "./ingest";
import type { EnduranceKind } from "./prescription";

// ---------------------------------------------------------------------------
// The modalities the intake offers
// ---------------------------------------------------------------------------

/**
 * Deliberately the same five words the athlete is shown, and deliberately a
 * SUBSET of `BenchmarkSport` — every one of these maps onto a benchmark
 * distance and a Riegel exponent that already exist and are already
 * calibrated. `ski` is a benchmark sport with no modality of its own because
 * nobody asked for one; adding it later is a one-line entry here.
 */
export type CardioModality = "run" | "walk" | "row" | "swim" | "cycle";

export const CARDIO_MODALITIES: readonly CardioModality[] = ["run", "walk", "row", "swim", "cycle"];

export function isCardioModality(value: unknown): value is CardioModality {
  return typeof value === "string" && (CARDIO_MODALITIES as readonly string[]).includes(value);
}

export interface ModalitySpec {
  /** What the athlete calls it. */
  label: string;
  /** The verb the prescription uses — "Row", "Swim", "Ride". */
  verb: string;
  /** `activities.sport` values that count as this modality. */
  sports: readonly string[];
  /** The unit pace is quoted in: 500m for rowing, 100m for swimming, 1km for running. */
  paceUnitMeters: number;
  /** Suffix on a pace string: "/500m", "/100m", "/km". */
  paceUnitLabel: string;
  /**
   * Cycling is quoted in km/h rather than as a time per unit distance, because
   * that is the number on the athlete's head unit. Power would be better still
   * and Split Index does not record it — see the note on `formatModalityPace`.
   */
  paceStyle: "time_per_unit" | "speed";
  /**
   * How much lower this modality's maximum heart rate typically sits than the
   * athlete's RUNNING maximum, in bpm.
   *
   * [DATA] Well replicated: less muscle mass and no weight-bearing component
   * means a lower peak. Swimming is the largest offset (horizontal posture and
   * facial immersion both depress it), cycling next, rowing smallest. Applying
   * a running HRmax unchanged to a swim set prescribes a heart rate the
   * athlete cannot reach in the water and quietly turns every easy swim into a
   * maximal one.
   */
  hrMaxOffset: number;
  /**
   * Whether this modality can carry a QUALITY session at all.
   *
   * Walking cannot, and saying so is more honest than inventing walking
   * intervals. Walking is scored on pace rather than on a projected benchmark
   * everywhere else in Split Index for the same reason.
   */
  qualityCapable: boolean;
  /** Interval rep distance in metres — roughly a 3-5 minute effort in each sport. */
  intervalRepMeters: number;
  /** Neuromuscular rep distance in metres — roughly 40-60 seconds. */
  shortRepMeters: number;
}

/**
 * [DATA] Benchmark distances and Riegel exponents come from
 * `cardio-benchmarks.ts` and `cardio-predictions.ts` rather than being
 * restated here, so there is exactly one place where "a rowing benchmark is a
 * 2k" is written down.
 *
 * Interval distances are [EST] and chosen to land near the duration each
 * sport's coaching literature actually uses: 1000m rowing repeats, 200m
 * swimming repeats, and a cycling repeat long enough to be a VO2max effort
 * rather than a sprint.
 */
export const MODALITY_SPEC: Readonly<Record<CardioModality, ModalitySpec>> = {
  run: {
    label: "Running",
    verb: "Run",
    sports: ["running"],
    paceUnitMeters: 1000,
    paceUnitLabel: "/km",
    paceStyle: "time_per_unit",
    hrMaxOffset: 0,
    qualityCapable: true,
    intervalRepMeters: 800,
    shortRepMeters: 200,
  },
  walk: {
    label: "Walking",
    verb: "Walk",
    sports: ["walking"],
    paceUnitMeters: 1000,
    paceUnitLabel: "/km",
    paceStyle: "time_per_unit",
    hrMaxOffset: 0,
    // A walking interval session is not a thing, and pretending otherwise
    // would be the exact failure this module exists to avoid.
    qualityCapable: false,
    intervalRepMeters: 0,
    shortRepMeters: 0,
  },
  row: {
    label: "Rowing",
    verb: "Row",
    sports: ["rowing"],
    paceUnitMeters: 500,
    paceUnitLabel: "/500m",
    paceStyle: "time_per_unit",
    hrMaxOffset: -3,
    qualityCapable: true,
    intervalRepMeters: 1000,
    shortRepMeters: 250,
  },
  swim: {
    label: "Swimming",
    verb: "Swim",
    sports: ["swimming"],
    paceUnitMeters: 100,
    paceUnitLabel: "/100m",
    paceStyle: "time_per_unit",
    hrMaxOffset: -11,
    qualityCapable: true,
    intervalRepMeters: 200,
    shortRepMeters: 50,
  },
  cycle: {
    label: "Cycling",
    verb: "Ride",
    sports: ["indoor_cycling", "outdoor_cycling", "bike_erg"],
    paceUnitMeters: 1000,
    paceUnitLabel: " km/h",
    paceStyle: "speed",
    hrMaxOffset: -5,
    qualityCapable: true,
    intervalRepMeters: 3000,
    shortRepMeters: 500,
  },
};

/** The `BenchmarkSport` each modality scores on. Identical strings today; stated so a divergence is a compile error rather than a silent mismatch. */
const BENCHMARK_SPORT: Readonly<Record<CardioModality, BenchmarkSport>> = {
  run: "run",
  walk: "walk",
  row: "row",
  swim: "swim",
  cycle: "cycle",
};

/** Reverse map, built once: `activities.sport` -> modality. */
const SPORT_TO_MODALITY: Readonly<Record<string, CardioModality>> = Object.fromEntries(
  CARDIO_MODALITIES.flatMap((m) => MODALITY_SPEC[m].sports.map((s) => [s, m] as const))
);

export function modalityForSport(sport: string): CardioModality | null {
  return SPORT_TO_MODALITY[sport] ?? null;
}

// ---------------------------------------------------------------------------
// The threshold anchor
// ---------------------------------------------------------------------------

/** The duration the threshold anchor is defined at. [DATA] An hour is the standard functional-threshold reference in every one of these sports. */
export const THRESHOLD_ANCHOR_SECONDS = 3600;

/**
 * Session bands as a fraction of the modality's own threshold pace.
 *
 * These are NOT the running bands from `SESSION_PACE_BANDS`, and they are not
 * meant to be. Those are multipliers of 5k pace, which is a maximal effort
 * lasting 15-30 minutes; these are multipliers of an hour-long effort, which
 * is a different reference point in every sport. Expressing them against
 * threshold is what makes one table legitimate across four modalities: the
 * physiological meaning of "12% slower than the pace you could hold for an
 * hour" is the same on an erg as it is in a pool.
 *
 * Numbers below 1 are FASTER (pace is seconds per unit distance), matching the
 * convention everywhere else in this engine.
 *
 * [EST], with the easy and threshold rows corroborated: the easy band lands a
 * 7:04 2k rower at 2:14-2:26/500m, which is the UT2 range Concept2's own
 * guidance gives that athlete, and the threshold row reproduces their ~2:00
 * hour pace by construction.
 */
export const MODALITY_BANDS_VS_THRESHOLD: Readonly<Record<EnduranceKind, readonly [number, number]>> = {
  recovery_run: [1.22, 1.32],
  easy_run: [1.12, 1.22],
  long_run: [1.1, 1.2],
  threshold_run: [0.99, 1.03],
  interval_run: [0.92, 0.96],
  rep_run: [0.87, 0.91],
};

/**
 * The pace this athlete could hold for an hour in this modality, in seconds
 * per the modality's own pace unit.
 *
 * Riegel's relation `t = T·(d/D)^k` solved for the distance covered in an
 * hour: `d = D·(3600/T)^(1/k)`. Each sport's own k is used — running's 1.08 is
 * not applied to a swim, which is the whole reason `BENCHMARK_RIEGEL_K`
 * exists.
 */
export function thresholdPaceFromBenchmark(modality: CardioModality, benchmarkS: number): number {
  const spec = MODALITY_SPEC[modality];
  const sport = BENCHMARK_SPORT[modality];
  const benchmarkMeters = BENCHMARK_DISTANCE_METERS[sport];
  const k = benchmarkRiegelK(sport);
  if (!(benchmarkS > 0) || !(benchmarkMeters > 0)) return 0;
  const hourMeters = benchmarkMeters * Math.pow(THRESHOLD_ANCHOR_SECONDS / benchmarkS, 1 / k);
  if (!Number.isFinite(hourMeters) || hourMeters <= 0) return 0;
  return (THRESHOLD_ANCHOR_SECONDS / hourMeters) * spec.paceUnitMeters;
}

// ---------------------------------------------------------------------------
// Ingest — one modality's logs, in that modality's own units
// ---------------------------------------------------------------------------

/** How the benchmark behind a modality's paces was arrived at. Stated in the prescription, never assumed. */
export type ModalityBenchmarkSource = "maximal_effort" | "projected" | "typical_pace" | "none";

export interface ModalityFitness {
  modality: CardioModality;
  /** Projected time at this sport's own benchmark distance (row 2k, swim 400m, cycle 20k), in seconds. Zero when unknown. */
  benchmarkS: number;
  benchmarkSource: ModalityBenchmarkSource;
  /** The hour-pace anchor every band below is a fraction of, in seconds per the modality's pace unit. Zero when unknown. */
  thresholdPaceS: number;
  /** Weekly minutes logged in this modality over the ingest window. */
  minPerWeek: number;
  sessionCount: number;
  /** Longest single logged session, in minutes. Seeds where a long session may start. */
  longestSessionMin: number;
}

/** Nothing logged. Paces are unavailable and the prescription says so rather than inventing one. */
export function emptyModalityFitness(modality: CardioModality): ModalityFitness {
  return {
    modality,
    benchmarkS: 0,
    benchmarkSource: "none",
    thresholdPaceS: 0,
    minPerWeek: 0,
    sessionCount: 0,
    longestSessionMin: 0,
  };
}

/**
 * Builds one modality's fitness picture from the athlete's own logged
 * activities in that sport, and only that sport.
 *
 * The benchmark is the athlete's BEST projected effort rather than their
 * median, because a benchmark is a maximal reference — taking the median would
 * anchor threshold pace to how hard they habitually train, which launders a
 * habit into a prescription. That is the same reasoning `hrBandFor` gives for
 * refusing to fit an easy ceiling to observed behaviour.
 *
 * Walking never projects. It is scored on pace everywhere else in Split Index
 * and it has no maximal-effort meaning, so its "benchmark" is the athlete's
 * own typical walking pace, labelled as exactly that.
 */
export function ingestModality(
  rows: ActivityRow[],
  modality: CardioModality,
  weeks = 12,
  now = Date.now()
): ModalityFitness {
  const spec = MODALITY_SPEC[modality];
  const sports = new Set(spec.sports);
  const cutoff = now - weeks * 7 * 86_400_000;
  const usable = rows.filter(
    (r) =>
      sports.has(r.sport) &&
      !r.is_partial_track &&
      r.duration_seconds > 0 &&
      new Date(r.started_at).getTime() >= cutoff
  );
  if (usable.length === 0) return emptyModalityFitness(modality);

  const times = usable.map((r) => new Date(r.started_at).getTime());
  const spanWeeks = Math.min(weeks, Math.max(1, (Math.max(...times) - Math.min(...times)) / (7 * 86_400_000)));

  const base = {
    modality,
    minPerWeek: usable.reduce((s, r) => s + r.duration_seconds, 0) / 60 / spanWeeks,
    sessionCount: usable.length,
    longestSessionMin: Math.max(...usable.map((r) => r.duration_seconds)) / 60,
  };

  const withDistance = usable.filter((r) => (r.distance_meters ?? 0) > 0);
  if (withDistance.length === 0) {
    // Duration is known, pace is not. Volume still counts; paces do not exist,
    // and the prescription falls back to RPE rather than to a guess.
    return { ...emptyModalityFitness(modality), ...base };
  }

  if (modality === "walk") {
    // Median pace, in seconds per pace unit. The median rather than the best:
    // walking has no maximal reference, so the honest anchor is what this
    // athlete's walking actually looks like.
    const paces = withDistance
      .map((r) => (r.duration_seconds / (r.distance_meters as number)) * spec.paceUnitMeters)
      .sort((a, b) => a - b);
    const median = paces[Math.floor(paces.length / 2)];
    return {
      ...base,
      benchmarkS: 0,
      benchmarkSource: "typical_pace",
      thresholdPaceS: median,
    };
  }

  const sport = BENCHMARK_SPORT[modality];
  const benchmarkMeters = BENCHMARK_DISTANCE_METERS[sport];
  const k = benchmarkRiegelK(sport);

  let best = Number.POSITIVE_INFINITY;
  let fromMaximalEffort = false;
  for (const r of withDistance) {
    const projected = riegelEquivalentSeconds(
      r.duration_seconds,
      r.distance_meters as number,
      benchmarkMeters,
      k
    );
    if (!Number.isFinite(projected) || projected <= 0) continue;
    if (projected < best) {
      best = projected;
      fromMaximalEffort = r.session_type === "race";
    }
  }
  if (!Number.isFinite(best)) return { ...emptyModalityFitness(modality), ...base };

  return {
    ...base,
    benchmarkS: best,
    benchmarkSource: fromMaximalEffort ? "maximal_effort" : "projected",
    thresholdPaceS: thresholdPaceFromBenchmark(modality, best),
  };
}

/** Every selected modality's fitness in one pass over the activity rows. */
export function ingestModalityFitness(
  rows: ActivityRow[],
  modalities: readonly CardioModality[],
  weeks = 12,
  now = Date.now()
): Partial<Record<CardioModality, ModalityFitness>> {
  const out: Partial<Record<CardioModality, ModalityFitness>> = {};
  for (const m of modalities) out[m] = ingestModality(rows, m, weeks, now);
  return out;
}

// ---------------------------------------------------------------------------
// Bands and formatting, in the modality's own units
// ---------------------------------------------------------------------------

export interface ModalityBand {
  lo: number;
  hi: number;
}

/**
 * The pace band for one session kind in one modality, in seconds per that
 * modality's pace unit. Null when the athlete has logged nothing to anchor on
 * — in which case the session is prescribed by effort, and says so.
 */
export function modalityPaceBand(fitness: ModalityFitness, kind: EnduranceKind): ModalityBand | null {
  if (!(fitness.thresholdPaceS > 0)) return null;
  const band = MODALITY_BANDS_VS_THRESHOLD[kind] ?? MODALITY_BANDS_VS_THRESHOLD.easy_run;
  return { lo: fitness.thresholdPaceS * band[0], hi: fitness.thresholdPaceS * band[1] };
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One pace, in the units the athlete's own sport uses.
 *
 * Cycling is the odd one out and is quoted as a speed, because that is what a
 * head unit displays and what a cyclist thinks in. Power would be a better
 * prescription still — it is the unit modern cycling coaching is written in —
 * and Split Index does not record power, so quoting a watt target would be
 * inventing a number. Speed is honest about what is actually known.
 */
export function formatModalityPace(seconds: number, modality: CardioModality): string {
  const spec = MODALITY_SPEC[modality];
  if (spec.paceStyle === "speed") {
    const kph = seconds > 0 ? (spec.paceUnitMeters / 1000 / seconds) * 3600 : 0;
    return `${kph.toFixed(1)}${spec.paceUnitLabel}`;
  }
  return `${mmss(seconds)}${spec.paceUnitLabel}`;
}

/** A band, in the modality's own units. Speed bands are printed fast-end-first so they read in ascending order. */
export function formatModalityBand(band: ModalityBand, modality: CardioModality): string {
  const spec = MODALITY_SPEC[modality];
  if (spec.paceStyle === "speed") {
    return `${formatModalityPace(band.hi, modality).replace(spec.paceUnitLabel, "")}-${formatModalityPace(band.lo, modality)}`;
  }
  return `${formatModalityPace(band.lo, modality).replace(spec.paceUnitLabel, "")}-${formatModalityPace(band.hi, modality)}`;
}

/** Distance covered at a given pace for a given number of minutes, in metres. */
export function metresAtPace(paceS: number, minutes: number, modality: CardioModality): number {
  const spec = MODALITY_SPEC[modality];
  if (!(paceS > 0)) return 0;
  return (minutes * 60 * spec.paceUnitMeters) / paceS;
}

// ---------------------------------------------------------------------------
// What a non-runner is shown instead of a predicted 5k
// ---------------------------------------------------------------------------

/**
 * The headline endurance number for an athlete whose modalities do not include
 * running.
 *
 * `predicted5kS` is running's diagnostic and it stays running's. Showing it to
 * someone who has never run — and who has just told the intake they never
 * intend to — is not a prediction, it is a number about a sport they do not
 * do, and the diagnostic report has a documented rule against exactly that
 * ("a placeholder must never be shown as a prediction").
 *
 * What replaces it is the same idea in the athlete's own sport: the time this
 * engine projects at that sport's canonical benchmark distance, from their own
 * logs, using their own sport's decay exponent. When they have logged nothing
 * in it, the honest answer is a null with the effort that would fill it named
 * — which is precisely how the running metric already behaves.
 */
export interface EnduranceBenchmark {
  modality: CardioModality;
  /** "2k row", "400m swim", "20k ride". */
  label: string;
  /** Projected time in seconds. Null when there is nothing to project from. */
  seconds: number | null;
  source: ModalityBenchmarkSource;
  /** What the athlete would have to do to fill a null. */
  unmeasured: string;
  /** The hour-pace anchor, formatted in the modality's own units. Null when unknown. */
  thresholdPace: string | null;
}

const BENCHMARK_LABEL: Readonly<Record<CardioModality, string>> = {
  run: "5k",
  walk: "typical walking pace",
  row: "2k row",
  swim: "400m swim",
  cycle: "20k ride",
};

export function enduranceBenchmark(fitness: ModalityFitness): EnduranceBenchmark {
  const { modality } = fitness;
  return {
    modality,
    label: BENCHMARK_LABEL[modality],
    seconds: fitness.benchmarkS > 0 ? fitness.benchmarkS : null,
    source: fitness.benchmarkSource,
    unmeasured:
      modality === "walk"
        ? "log a few walks and your own steady pace anchors the plan"
        : `log a hard ${MODALITY_SPEC[modality].label.toLowerCase()} effort and this becomes a real projection`,
    thresholdPace:
      fitness.thresholdPaceS > 0 ? formatModalityPace(fitness.thresholdPaceS, modality) : null,
  };
}

// ---------------------------------------------------------------------------
// Choosing which modality a session belongs to
// ---------------------------------------------------------------------------

/**
 * The athlete's resolved cardio choice, as the session builder needs it.
 *
 * `primary` is where the quality work goes and where the long session goes.
 * `rotation` is the pool easy volume is spread across — identical to
 * `modalities` when cross-training is on, and the primary alone when it is
 * off and only one modality was chosen.
 */
export interface CardioPlan {
  modalities: CardioModality[];
  primary: CardioModality;
  rotation: CardioModality[];
  /** The modality quality sessions are prescribed in. Never a modality that cannot carry one. */
  qualityModality: CardioModality;
  crossTrain: boolean;
  /** Athlete-readable consequences of the choice, surfaced on the week rather than silently applied. */
  notes: string[];
}

/**
 * Resolves the athlete's answers into the plan above.
 *
 * Two rules, both of them the athlete's stated preference rather than the
 * engine's convenience:
 *
 *  - The chosen set is a WHITELIST. Nothing outside it is ever prescribed. An
 *    athlete who picked rowing alone and declined cross-training gets rowing,
 *    including the long session and the quality session.
 *  - Cross-training only ever widens the pool ACROSS WHAT THEY PICKED. It is
 *    not a licence for the engine to add a sport they did not ask for. "Ask if
 *    they wish to cross train, otherwise only provide a plan with their given
 *    cardio choice(s)" cuts both ways, and the second half is the one that is
 *    easy to get wrong.
 */
export function resolveCardioPlan(
  modalities: readonly CardioModality[],
  crossTrain: boolean,
  /** The modality the athlete's endurance goal is in, where they named one. */
  goalModality: CardioModality | null = null
): CardioPlan {
  const notes: string[] = [];
  const chosen = CARDIO_MODALITIES.filter((m) => modalities.includes(m));
  // No answer means running, which is what this engine did before the question
  // existed. A default has to be SOMETHING, and silently changing the default
  // for every existing athlete would be a worse surprise than the question.
  const resolved: CardioModality[] = chosen.length > 0 ? chosen : ["run"];

  const primary =
    goalModality != null && resolved.includes(goalModality) ? goalModality : resolved[0];

  // Quality has to land somewhere it can exist. A walking-only athlete has no
  // quality modality at all, and the week says so instead of inventing walking
  // intervals.
  const qualityModality =
    MODALITY_SPEC[primary].qualityCapable
      ? primary
      : (resolved.find((m) => MODALITY_SPEC[m].qualityCapable) ?? primary);

  if (!MODALITY_SPEC[qualityModality].qualityCapable) {
    notes.push(
      "Every hard session in this plan would have to be a walk, and walking cannot carry one. The endurance side " +
        "is steady volume only — adding one modality that can take an interval, even a bike, is what would change that."
    );
  } else if (qualityModality !== primary) {
    notes.push(
      `Your hard endurance sessions are prescribed as ${MODALITY_SPEC[qualityModality].label.toLowerCase()} — ` +
        `${MODALITY_SPEC[primary].label.toLowerCase()} cannot carry one.`
    );
  }

  const rotation = crossTrain || resolved.length > 1 ? resolved : [primary];
  if (!crossTrain && resolved.length === 1) {
    notes.push(
      `Every endurance session here is ${MODALITY_SPEC[primary].label.toLowerCase()}, because that is what you ` +
        `chose and you said no to cross-training. Nothing in this plan will ask you to run.`
    );
  } else if (resolved.length > 1) {
    notes.push(
      `Endurance volume is spread across ${resolved.map((m) => MODALITY_SPEC[m].label.toLowerCase()).join(", ")}, ` +
        `with the hard sessions kept in ${MODALITY_SPEC[qualityModality].label.toLowerCase()} so they progress ` +
        `against one benchmark rather than three.`
    );
  }

  return { modalities: resolved, primary, rotation, qualityModality, crossTrain, notes };
}

/**
 * What the athlete calls a session in this modality.
 *
 * The engine's `kind` stays running-flavoured because the stress table, the
 * spacing rules and the ACWR pass are all keyed on it. This is the string the
 * athlete actually reads, and it is the whole difference between "Easy run"
 * appearing above a rowing prescription and "Easy row" appearing above it.
 */
const KIND_NOUN: Readonly<Record<EnduranceKind, string>> = {
  recovery_run: "Recovery",
  easy_run: "Easy",
  long_run: "Long",
  threshold_run: "Threshold",
  interval_run: "Intervals",
  rep_run: "Reps",
};

const MODALITY_NOUN: Readonly<Record<CardioModality, string>> = {
  run: "run",
  walk: "walk",
  row: "row",
  swim: "swim",
  cycle: "ride",
};

export function modalitySessionLabel(modality: CardioModality, kind: EnduranceKind): string {
  const noun = MODALITY_NOUN[modality];
  // A modality that cannot carry quality never gets an "Intervals" label, even
  // if a quality slot was allocated to it — the session it actually receives is
  // steady, and the label has to describe the session rather than the slot.
  if (!MODALITY_SPEC[modality].qualityCapable && (kind === "interval_run" || kind === "rep_run" || kind === "threshold_run")) {
    return `Steady ${noun}`;
  }
  if (kind === "interval_run") return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} intervals`;
  if (kind === "rep_run") return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} reps`;
  return `${KIND_NOUN[kind]} ${noun}`;
}

/** The modality an endurance event is contested in, so quality lands in the sport that is being trained for. */
export function modalityForEvent(eventKey: string | null): CardioModality | null {
  if (!eventKey) return null;
  if (eventKey === "2k_row") return "row";
  if (["5k", "10k", "half", "marathon"].includes(eventKey)) return "run";
  return null;
}
