import { z } from "zod";
import type { ActivityFormData, SessionType, SportType } from "@/types";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import { getExerciseTracking } from "@/lib/constants/sports";
import { liftWeightLimits } from "@/lib/scoring/input-guards";

/**
 * Local form state is kept as strings so typing is never blocked;
 * conversion + validation happens only on submit.
 */
export interface SetRowState {
  id: string;
  weight: string;
  reps: string;
  rpe: string;
  /** Reps in reserve — optional (Part B3). */
  repsInReserve: string;
  /**
   * Hold time, for exercises whose `tracking` is "time" (planks). Blank and
   * unused for everything else — see getExerciseTracking in constants/sports.
   *
   * Optional rather than required so the set literals built outside this
   * module (lib/activities/db-form.ts, and the plan/recommendation prefills
   * in app/(app)/activities/log-page-loader.tsx) stay valid without change —
   * they only ever produce rep-tracked exercises. Treat undefined as "".
   */
  durationSeconds?: string;
  /** Distance covered, for `tracking: "distance"` exercises (carries, sled work). Optional for the same reason as durationSeconds. */
  distanceMeters?: string;
}

export interface ExerciseRowState {
  id: string;
  name: string;
  muscleGroup: string;
  /** Each set can carry its own weight/reps/RPE — sets are rarely uniform (ramping, pyramids, drop sets). */
  sets: SetRowState[];
  notes: string;
  /** How the athlete entered load for this exercise. */
  weightEntryMode: WeightEntryMode;
  /** Attachment id (e.g. "rope", "straight-bar") for exercises with attachment options — see strength/attachments.ts. Null when this exercise has none, or none is selected yet. */
  attachment: string | null;
}

/**
 * One rep's correction inside a block — the "edited per rep" escape hatch.
 *
 * Every field is sparse: blank means "exactly what the block said". That is
 * what makes the common case cheap — a uniform block carries no overrides at
 * all, and an athlete who missed the target on rep 3 of 6 types one number
 * instead of re-entering six.
 *
 * Positional: entry `i` of `repOverrides` describes rep `i` of the block.
 */
export interface IntervalRepOverrideState {
  id: string;
  /** Blank = the block's `distanceMeters`. */
  distanceMeters: string;
  /** Blank = the block's `workSeconds`. */
  workSeconds: string;
  /** Blank = the block's `restSeconds`. Ignored on the session's final rep. */
  restSeconds: string;
}

/**
 * A repeated piece of an interval session: "4 × 400m @ 75s, 90s rest".
 *
 * A session is a list of these, so mixed sessions (4×400 then 2×800) are a
 * first-class shape rather than something the athlete has to average by hand.
 * The five flat `interval*` fields below remain the ONLY thing that reaches
 * the database — see flattenIntervalBlocks for how a list of blocks collapses
 * back onto them without changing a single stored column.
 */
export interface IntervalBlockState {
  id: string;
  reps: string;
  /** Metres per rep. */
  distanceMeters: string;
  /** Target work time per rep, in seconds. */
  workSeconds: string;
  /** Rest taken after each rep of this block, in seconds. */
  restSeconds: string;
  /** Optional work-only average HR for this block. */
  workHr: string;
  /** Sparse, positional per-rep corrections. Empty = a uniform block. */
  repOverrides: IntervalRepOverrideState[];
}

export interface WorkoutFormState {
  title: string;
  startedAt: string; // datetime-local value: yyyy-MM-ddTHH:mm
  hours: string;
  minutes: string;
  seconds: string;
  distance: string; // km or m depending on sport
  elevation: string;
  avgHr: string;
  avgPower: string;
  splitMinutes: string;
  splitSeconds: string;
  strokeType: string;
  temperature: string;
  sessionType: SessionType;
  rpe: string;
  notes: string;
  bodyweight: string;
  exercises: ExerciseRowState[];
  /** Rowing/ski erg: which of distance/time the athlete enters directly — the other is derived from split. */
  rowInputMode: "distance" | "time";
  /** Structured interval reps (session type "interval") — optional; scores off work-piece pace instead of the whole-session average when filled in. */
  intervalReps: string;
  intervalWorkDistance: string; // meters, per rep
  intervalWorkSeconds: string; // work time per rep
  intervalRestSeconds: string; // rest between reps
  intervalWorkHr: string; // optional, work-only avg HR
  /**
   * Multi-block interval structure, with optional per-rep corrections.
   *
   * Additive and empty by default. When empty, the five flat `interval*`
   * fields above are used exactly as they always were — an activity logged or
   * drafted before blocks existed submits down a byte-identical path. When
   * non-empty, the blocks are flattened onto those same five fields at submit
   * (flattenIntervalBlocks), so nothing downstream — schema, API, scorer,
   * merge, recompute — has to know blocks exist.
   */
  intervalBlocks: IntervalBlockState[];
  /** Fartlek "on" (hard-effort) distance/time (session type "fartlek") — optional. */
  fartlekOnDistance: string; // meters
  fartlekOnSeconds: string;
  fartlekOnHr: string; // optional, on-effort avg HR
}

/** Payload sent to POST/PATCH /api/activities. Extensions beyond ActivityFormData. */
export type ActivityPayload = ActivityFormData & {
  bodyweight_kg?: number;
  exercise_notes?: Record<string, string>;
};

export interface SportFieldConfig {
  distance?: "km" | "m";
  elevation?: boolean;
  avgHr?: boolean;
  split?: boolean;
  /** Split is mandatory and distance/time are interchangeable (one entered, one derived from split) — rowing, ski erg. */
  derivableDistance?: boolean;
  power?: boolean;
  stroke?: boolean;
  temperature?: boolean;
  sessionType?: boolean;
  rpe?: boolean;
}

export const SPORT_FIELDS: Record<SportType, SportFieldConfig> = {
  running: {
    distance: "km",
    elevation: true,
    avgHr: true,
    temperature: true,
    sessionType: true,
    rpe: true,
  },
  // User-reported: "swimming cannot take heart rate." It couldn't — this
  // config is the only thing that decides whether the field renders at all, so
  // an omission here is indistinguishable from the feature not existing. The
  // payload, the column (`avg_heart_rate`) and the scorer were always ready
  // for it; there was simply no input on screen.
  //
  // Auditing the rest of the table for the same omission: walking was the only
  // other endurance sport missing it. Everything else (running, rowing, ski
  // erg, bike erg, indoor and outdoor cycling) already had it. Gym is
  // deliberately empty — its effort is per-set RPE inside each exercise row.
  walking: { distance: "km", elevation: true, avgHr: true, rpe: true },
  swimming: { distance: "m", avgHr: true, stroke: true, sessionType: true, rpe: true },
  rowing: { distance: "m", split: true, derivableDistance: true, avgHr: true, sessionType: true, rpe: true },
  ski_erg: { distance: "m", split: true, derivableDistance: true, avgHr: true, sessionType: true, rpe: true },
  bike_erg: { distance: "m", power: true, avgHr: true, sessionType: true, rpe: true },
  indoor_cycling: { power: true, avgHr: true, sessionType: true, rpe: true },
  // Unlike indoor_cycling (stationary trainer — no distance, no elevation),
  // outdoor riding has real distance (in km, like running/walking, not
  // erg-style meters) and real elevation gain; power stays optional since
  // not every outdoor rider has a power meter.
  outdoor_cycling: {
    distance: "km",
    elevation: true,
    power: true,
    avgHr: true,
    sessionType: true,
    rpe: true,
  },
  gym: {},
};

let rowCounter = 0;
export function nextRowId(): string {
  rowCounter += 1;
  return `row-${Date.now()}-${rowCounter}`;
}

let setCounter = 0;
export function nextSetId(): string {
  setCounter += 1;
  return `set-${Date.now()}-${setCounter}`;
}

let blockCounter = 0;
function nextBlockId(prefix: string): string {
  blockCounter += 1;
  return `${prefix}-${Date.now()}-${blockCounter}`;
}

export function createIntervalRepOverride(): IntervalRepOverrideState {
  return { id: nextBlockId("rep"), distanceMeters: "", workSeconds: "", restSeconds: "" };
}

export function createIntervalBlock(
  seed?: Partial<Omit<IntervalBlockState, "id" | "repOverrides">>
): IntervalBlockState {
  return {
    id: nextBlockId("blk"),
    reps: seed?.reps ?? "",
    distanceMeters: seed?.distanceMeters ?? "",
    workSeconds: seed?.workSeconds ?? "",
    restSeconds: seed?.restSeconds ?? "",
    workHr: seed?.workHr ?? "",
    repOverrides: [],
  };
}

/** Does this block hold anything the athlete typed? */
export function intervalBlockHasEntry(block: IntervalBlockState): boolean {
  return (
    block.reps.trim() !== "" ||
    block.distanceMeters.trim() !== "" ||
    block.workSeconds.trim() !== "" ||
    block.restSeconds.trim() !== "" ||
    block.workHr.trim() !== "" ||
    block.repOverrides.some(
      (r) =>
        r.distanceMeters.trim() !== "" ||
        r.workSeconds.trim() !== "" ||
        r.restSeconds.trim() !== ""
    )
  );
}

/**
 * The blocks to EDIT for a given state, without ever mutating it.
 *
 * An activity (or draft) saved before blocks existed carries its single
 * uniform piece in the five flat `interval*` fields. Rather than migrating
 * anything — in the database, in stored drafts, or during render — the editor
 * simply reads that legacy piece as one block. The moment the athlete touches
 * it, `intervalBlocks` is written and takes over; until then the state is
 * untouched and submits down the old path unchanged.
 */
export function readIntervalBlocks(state: WorkoutFormState): IntervalBlockState[] {
  if (state.intervalBlocks.length > 0) return state.intervalBlocks;
  const legacyFilled =
    state.intervalReps.trim() !== "" ||
    state.intervalWorkDistance.trim() !== "" ||
    state.intervalWorkSeconds.trim() !== "";
  if (legacyFilled) {
    return [
      createIntervalBlock({
        reps: state.intervalReps,
        distanceMeters: state.intervalWorkDistance,
        workSeconds: state.intervalWorkSeconds,
        restSeconds: state.intervalRestSeconds,
        workHr: state.intervalWorkHr,
      }),
    ];
  }
  return [createIntervalBlock()];
}

/** One rep, after its block's values and its own override have been merged. */
export interface ResolvedIntervalRep {
  distanceMeters: number;
  workSeconds: number;
  restSeconds: number;
}

/**
 * Expand a block into its individual reps. Returns null when the block can't
 * describe a rep at all (no count, or a rep left without a distance or a
 * time) — the caller reports that as a field error rather than silently
 * scoring a session off half a block.
 */
export function resolveIntervalBlock(block: IntervalBlockState): ResolvedIntervalRep[] | null {
  const reps = parseNum(block.reps);
  if (reps === null || !Number.isFinite(reps) || reps < 1 || reps > 100) return null;
  const count = Math.round(reps);
  const baseDistance = parseNum(block.distanceMeters);
  const baseWork = parseSeconds(block.workSeconds);
  const baseRest = parseSeconds(block.restSeconds) ?? 0;

  const out: ResolvedIntervalRep[] = [];
  for (let i = 0; i < count; i += 1) {
    const override = block.repOverrides[i];
    const distance = (override ? parseNum(override.distanceMeters) : null) ?? baseDistance;
    const work = (override ? parseSeconds(override.workSeconds) : null) ?? baseWork;
    const rest = (override ? parseSeconds(override.restSeconds) : null) ?? baseRest;
    if (distance === null || distance <= 0 || work === null || work <= 0) return null;
    out.push({ distanceMeters: distance, workSeconds: work, restSeconds: Math.max(0, rest) });
  }
  return out;
}

/**
 * Collapse any number of blocks (and their per-rep corrections) onto the ONE
 * uniform work piece the persisted schema and the scorer already understand.
 *
 * This is exact, not an approximation. cardio/interval-scoring.ts derives
 * everything it needs from three aggregates:
 *
 *   work pace   = workSecondsPerRep / workDistanceMeters
 *   total work  = reps × workSecondsPerRep
 *   total rest  = (reps − 1) × restSeconds
 *   total dist  = reps × workDistanceMeters
 *
 * Feeding it reps = N (every rep across every block), and the ARITHMETIC MEAN
 * per rep for distance, work time and rest reproduces all four aggregates
 * identically — N × (Σd/N) = Σd, and so on — so a two-block session scores off
 * its true combined work pace and true rest ratio. No scoring file changes.
 *
 * Rest is counted for every rep except the session's final one, matching the
 * (reps − 1) the scorer assumes: the recovery after the last rep of a block is
 * the recovery before the first rep of the next, and after the very last rep
 * there is no rest left to take.
 */
export interface FlattenedIntervalWork {
  reps: number;
  workDistanceMeters: number;
  workSeconds: number;
  restSeconds: number;
  workHr: number | null;
}

export function flattenIntervalBlocks(
  blocks: IntervalBlockState[]
): FlattenedIntervalWork | null {
  const resolved: Array<{ reps: ResolvedIntervalRep[]; workHr: number | null }> = [];
  for (const block of blocks) {
    if (!intervalBlockHasEntry(block)) continue;
    const reps = resolveIntervalBlock(block);
    if (!reps) return null;
    resolved.push({ reps, workHr: parseNum(block.workHr) });
  }
  const allReps = resolved.flatMap((r) => r.reps);
  if (allReps.length === 0) return null;

  const totalDistance = allReps.reduce((s, r) => s + r.distanceMeters, 0);
  const totalWork = allReps.reduce((s, r) => s + r.workSeconds, 0);
  // Every rest interval actually taken: after each rep but the last of the
  // whole session.
  const totalRest = allReps
    .slice(0, -1)
    .reduce((s, r) => s + r.restSeconds, 0);
  const n = allReps.length;

  // Work-time-weighted, so a long block's HR isn't given equal say to a short
  // one. Only blocks that reported an HR contribute.
  let hrWeight = 0;
  let hrSum = 0;
  for (const block of resolved) {
    if (block.workHr === null || block.workHr <= 0) continue;
    const weight = block.reps.reduce((s, r) => s + r.workSeconds, 0);
    hrWeight += weight;
    hrSum += block.workHr * weight;
  }

  // One decimal place: interval_work_distance_meters / interval_work_seconds /
  // interval_rest_seconds are NUMERIC(_,1) columns (migration 015), so any
  // more precision would be rounded by Postgres anyway — do it here so what is
  // scored is exactly what is stored.
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    reps: n,
    workDistanceMeters: round1(totalDistance / n),
    workSeconds: round1(totalWork / n),
    restSeconds: n > 1 ? round1(totalRest / (n - 1)) : 0,
    workHr: hrWeight > 0 ? Math.round(hrSum / hrWeight) : null,
  };
}

/** Total time the blocks account for — work plus the rest between reps. */
export function intervalBlocksTotalSeconds(blocks: IntervalBlockState[]): number | null {
  const flat = flattenIntervalBlocks(blocks);
  if (!flat) return null;
  return Math.round(flat.reps * flat.workSeconds + Math.max(0, flat.reps - 1) * flat.restSeconds);
}

/** Total distance covered in the work reps (excludes any warm-up or recovery jog). */
export function intervalBlocksWorkDistanceMeters(blocks: IntervalBlockState[]): number | null {
  const flat = flattenIntervalBlocks(blocks);
  if (!flat) return null;
  return Math.round(flat.reps * flat.workDistanceMeters);
}

/**
 * A brand-new set row always starts blank.
 *
 * User feedback: "when starting a new workout the weight fields are
 * pre-filled from the previously logged exercise, and clearing them by hand
 * is slow — a new workout should start with all fields blank."
 *
 * This function used to carry `previous.weight` / `previous.reps` /
 * `previous.repsInReserve` forward (present since the initial build,
 * 4295d30 — a deliberate convenience, not an accident). Two callers made
 * that leak across boundaries the athlete never asked for:
 * `addSet` inherited the previous SET, and `createExerciseRow` fed it the
 * previous EXERCISE's last set, so adding "Bench Press" after "Squat"
 * silently proposed the squat's load. Inheriting a number you must notice
 * and clear is worse than typing it: an unnoticed stale weight is logged as
 * real training data and scored.
 *
 * The convenience it replaced is still available, and better: the Lab shows
 * "Last time: 100kg × 8" and your PR for the exercise inline
 * (ExerciseHistoryHint in gym-form.tsx), which is real history for THIS
 * exercise rather than whatever happened to be typed a moment ago.
 *
 * Both functions therefore take no "previous row" argument at all any more:
 * there is nothing left they could legitimately copy from it, and keeping an
 * ignored parameter would invite a future caller to assume it still does
 * something.
 */
export function createSetRow(): SetRowState {
  return {
    id: nextSetId(),
    weight: "",
    reps: "",
    rpe: "",
    repsInReserve: "",
    durationSeconds: "",
    distanceMeters: "",
  };
}

export function createExerciseRow(): ExerciseRowState {
  return {
    id: nextRowId(),
    name: "",
    muscleGroup: "",
    // No `previous` handed down: a new exercise starts blank, see createSetRow.
    sets: [createSetRow()],
    notes: "",
    // Not inherited either — the load convention belongs to the exercise, and
    // picking a name sets it from defaultWeightEntryMode() straight away.
    weightEntryMode: "total",
    attachment: null,
  };
}

/**
 * The set with the highest estimated 1RM — used for the exercise-level
 * 1RM/score preview. `epley1RM` returns null for a blank/zero weight (its
 * "not enough data" case), which is also the valid, common case for a
 * bodyweight-only set (pull-ups, dips, push-ups with no added load) — so
 * that can't double as a sentinel meaning "worse than everything." Falling
 * back to reps as the comparison metric keeps those sets selectable (more
 * reps at bodyweight beats fewer), and the -Infinity floor (not -1) means a
 * single set is always returned rather than only sets that beat a positive
 * threshold.
 */
export function bestSetRow(sets: SetRowState[]): SetRowState | null {
  let best: SetRowState | null = null;
  let bestEstimate = -Infinity;
  for (const s of sets) {
    const estimate = epley1RM(parseNum(s.weight), parseNum(s.reps)) ?? parseNum(s.reps) ?? -1;
    if (estimate > bestEstimate) {
      best = s;
      bestEstimate = estimate;
    }
  }
  return best;
}

export function totalVolumeFromSets(sets: SetRowState[]): number {
  return sets.reduce((sum, s) => {
    const weight = parseNum(s.weight) ?? 0;
    const reps = parseNum(s.reps) ?? 0;
    return sum + weight * reps;
  }, 0);
}

export function nowLocalDateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function createDefaultState(
  sport: SportType,
  profileWeightKg?: number | null
): WorkoutFormState {
  return {
    title: "",
    startedAt: nowLocalDateTime(),
    hours: "",
    minutes: "",
    seconds: "",
    distance: "",
    elevation: "",
    avgHr: "",
    avgPower: "",
    splitMinutes: "",
    splitSeconds: "",
    strokeType: "freestyle",
    temperature: "",
    sessionType: "easy",
    rpe: "",
    notes: "",
    bodyweight: profileWeightKg ? String(profileWeightKg) : "",
    exercises: sport === "gym" ? [createExerciseRow()] : [],
    rowInputMode: "distance",
    intervalReps: "",
    intervalWorkDistance: "",
    intervalWorkSeconds: "",
    intervalRestSeconds: "",
    intervalWorkHr: "",
    intervalBlocks: [],
    fartlekOnDistance: "",
    fartlekOnSeconds: "",
    fartlekOnHr: "",
  };
}

/** Merge a saved draft (JSONB round-trip) over fresh defaults, defensively. */
export function restoreDraftState(
  sport: SportType,
  draft: unknown,
  profileWeightKg?: number | null
): WorkoutFormState {
  const base = createDefaultState(sport, profileWeightKg);
  if (!draft || typeof draft !== "object") return base;
  const d = draft as Partial<WorkoutFormState>;

  const str = (v: unknown, fallback: string) =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;

  // Old drafts (saved before per-set customization existed) have flat
  // weight/sets/reps/rpe on the row itself instead of a `sets` array —
  // detect and expand those into one set entry rather than dropping them.
  type RawExerciseRow = {
    id?: unknown;
    name?: unknown;
    muscleGroup?: unknown;
    notes?: unknown;
    weightEntryMode?: unknown;
    attachment?: unknown;
    weight?: unknown;
    reps?: unknown;
    rpe?: unknown;
    sets?: unknown;
  };

  const exercises = Array.isArray(d.exercises)
    ? (d.exercises as unknown[])
        .filter((row): row is RawExerciseRow => !!row && typeof row === "object")
        .map((row) => {
          const rowSets: SetRowState[] = Array.isArray(row.sets)
            ? row.sets
                .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
                .map((s) => ({
                  id: str(s.id, nextSetId()),
                  weight: str(s.weight, ""),
                  reps: str(s.reps, ""),
                  rpe: str(s.rpe, ""),
                  repsInReserve: str(s.repsInReserve, ""),
                  // Absent from drafts saved before timed/carry exercises
                  // existed — default blank rather than dropping the set.
                  durationSeconds: str(s.durationSeconds, ""),
                  distanceMeters: str(s.distanceMeters, ""),
                }))
            : [
                {
                  id: nextSetId(),
                  weight: str(row.weight, ""),
                  reps: str(row.reps, ""),
                  rpe: str(row.rpe, ""),
                  repsInReserve: "",
                  durationSeconds: "",
                  distanceMeters: "",
                },
              ];

          const name = str(row.name, "");
          return {
            id: str(row.id, nextRowId()),
            name,
            muscleGroup: str(row.muscleGroup, ""),
            sets: rowSets.length > 0 ? rowSets : [createSetRow()],
            notes: str(row.notes, ""),
            weightEntryMode:
              row.weightEntryMode === "per_hand" ||
              row.weightEntryMode === "added" ||
              row.weightEntryMode === "total"
                ? row.weightEntryMode
                : name.trim()
                  ? defaultWeightEntryMode(name)
                  : "total",
            attachment: typeof row.attachment === "string" ? row.attachment : null,
          };
        })
    : base.exercises;

  const sessionType = SESSION_TYPE_VALUES.includes(d.sessionType as SessionType)
    ? (d.sessionType as SessionType)
    : base.sessionType;

  return {
    title: str(d.title, base.title),
    startedAt: str(d.startedAt, base.startedAt),
    hours: str(d.hours, base.hours),
    minutes: str(d.minutes, base.minutes),
    seconds: str(d.seconds, base.seconds),
    distance: str(d.distance, base.distance),
    elevation: str(d.elevation, base.elevation),
    avgHr: str(d.avgHr, base.avgHr),
    avgPower: str(d.avgPower, base.avgPower),
    splitMinutes: str(d.splitMinutes, base.splitMinutes),
    splitSeconds: str(d.splitSeconds, base.splitSeconds),
    strokeType: str(d.strokeType, base.strokeType),
    temperature: str(d.temperature, base.temperature),
    sessionType,
    rpe: str(d.rpe, base.rpe),
    notes: str(d.notes, base.notes),
    bodyweight: str(d.bodyweight, base.bodyweight),
    exercises: exercises.length > 0 ? exercises : base.exercises,
    rowInputMode: d.rowInputMode === "time" ? "time" : base.rowInputMode,
    intervalReps: str(d.intervalReps, base.intervalReps),
    intervalWorkDistance: str(d.intervalWorkDistance, base.intervalWorkDistance),
    intervalWorkSeconds: str(d.intervalWorkSeconds, base.intervalWorkSeconds),
    intervalRestSeconds: str(d.intervalRestSeconds, base.intervalRestSeconds),
    intervalWorkHr: str(d.intervalWorkHr, base.intervalWorkHr),
    // Absent from every draft saved before blocks existed — an empty list is
    // exactly right there, since readIntervalBlocks reads the flat fields
    // above as one block instead.
    intervalBlocks: Array.isArray(d.intervalBlocks)
      ? (d.intervalBlocks as unknown[])
          .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
          .map((b) => ({
            id: str(b.id, nextBlockId("blk")),
            reps: str(b.reps, ""),
            distanceMeters: str(b.distanceMeters, ""),
            workSeconds: str(b.workSeconds, ""),
            restSeconds: str(b.restSeconds, ""),
            workHr: str(b.workHr, ""),
            repOverrides: Array.isArray(b.repOverrides)
              ? (b.repOverrides as unknown[])
                  .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
                  .map((r) => ({
                    id: str(r.id, nextBlockId("rep")),
                    distanceMeters: str(r.distanceMeters, ""),
                    workSeconds: str(r.workSeconds, ""),
                    restSeconds: str(r.restSeconds, ""),
                  }))
              : [],
          }))
      : base.intervalBlocks,
    fartlekOnDistance: str(d.fartlekOnDistance, base.fartlekOnDistance),
    fartlekOnSeconds: str(d.fartlekOnSeconds, base.fartlekOnSeconds),
    fartlekOnHr: str(d.fartlekOnHr, base.fartlekOnHr),
  };
}

/** True if the user has actually entered anything worth persisting. */
export function isStateDirty(state: WorkoutFormState): boolean {
  const touched =
    state.title !== "" ||
    state.hours !== "" ||
    state.minutes !== "" ||
    state.seconds !== "" ||
    state.distance !== "" ||
    state.elevation !== "" ||
    state.avgHr !== "" ||
    state.avgPower !== "" ||
    state.splitMinutes !== "" ||
    state.splitSeconds !== "" ||
    state.temperature !== "" ||
    state.rpe !== "" ||
    state.notes !== "" ||
    state.intervalReps !== "" ||
    state.intervalBlocks.some(intervalBlockHasEntry) ||
    state.fartlekOnDistance !== "";
  const exercisesTouched = state.exercises.some(
    (row) =>
      row.name !== "" ||
      row.notes !== "" ||
      row.sets.some(
        (s) =>
          s.weight !== "" ||
          s.reps !== "" ||
          s.rpe !== "" ||
          !!s.durationSeconds ||
          !!s.distanceMeters
      )
  );
  return touched || exercisesTouched;
}

const SESSION_TYPE_VALUES: SessionType[] = [
  "easy",
  "recovery",
  "tempo",
  "threshold",
  "interval",
  "fartlek",
  "race",
  "long",
  "other",
];

// ─── Number parsing ──────────────────────────────────────────────────────────

export function parseNum(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Seconds from either a plain count ("75") or clock notation ("1:15",
 * "2:40"). Athletes say "800s at 2:40", not "at 160 seconds" — refusing the
 * form they actually think in is a small tax charged on every rep they log.
 */
export function parseSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!trimmed.includes(":")) return parseNum(trimmed);
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const n = Number(part.trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    total = total * 60 + n;
  }
  return total;
}

export function totalDurationSeconds(state: WorkoutFormState): number {
  const h = parseNum(state.hours) ?? 0;
  const m = parseNum(state.minutes) ?? 0;
  const s = parseNum(state.seconds) ?? 0;
  return Math.round(h * 3600 + m * 60 + s);
}

export function splitSecondsFromState(state: WorkoutFormState): number | null {
  const m = parseNum(state.splitMinutes);
  const s = parseNum(state.splitSeconds);
  if (m === null && s === null) return null;
  return Math.round((m ?? 0) * 60 + (s ?? 0));
}

// ─── Derived metrics ─────────────────────────────────────────────────────────

export function formatClock(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** min:sec per km from km + total seconds */
export function derivePacePerKm(km: number | null, seconds: number): string | null {
  if (!km || km <= 0 || seconds <= 0) return null;
  return `${formatClock(seconds / km)} /km`;
}

/** min:sec per 100m for swimming */
export function derivePacePer100m(meters: number | null, seconds: number): string | null {
  if (!meters || meters <= 0 || seconds <= 0) return null;
  return `${formatClock((seconds / meters) * 100)} /100m`;
}

/** min:sec per 500m for rowing / ski erg */
export function deriveSplitPer500m(meters: number | null, seconds: number): string | null {
  if (!meters || meters <= 0 || seconds <= 0) return null;
  return `${formatClock((seconds / meters) * 500)} /500m`;
}

export function deriveSpeedKmh(meters: number | null, seconds: number): string | null {
  if (!meters || meters <= 0 || seconds <= 0) return null;
  return `${((meters / 1000) / (seconds / 3600)).toFixed(1)} km/h`;
}

/** Duration from distance + split/500m — rowing/ski erg "log by distance" mode. */
export function deriveDurationFromDistanceAndSplit(
  distanceMeters: number | null,
  splitSeconds: number | null
): number | null {
  if (!distanceMeters || distanceMeters <= 0 || !splitSeconds || splitSeconds <= 0) return null;
  return (splitSeconds / 500) * distanceMeters;
}

/** Distance from duration + split/500m — rowing/ski erg "log by time" mode. */
export function deriveDistanceFromDurationAndSplit(
  durationSeconds: number | null,
  splitSeconds: number | null
): number | null {
  if (!durationSeconds || durationSeconds <= 0 || !splitSeconds || splitSeconds <= 0) return null;
  return (durationSeconds / splitSeconds) * 500;
}

/** Epley formula: weight × (1 + reps / 30) */
export function epley1RM(weightKg: number | null, reps: number | null): number | null {
  if (!weightKg || weightKg <= 0 || !reps || reps <= 0) return null;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/**
 * Per-exercise score (0–999) from estimated 1RM relative to bodyweight.
 * Accessory lifts are normalised (×2) so a 0.5×BW curl scores like a 1×BW press.
 * Log curve: 1×BW compound ≈ 500, 2×BW ≈ 760, 3×BW ≈ 915.
 */
export function exerciseScore(
  oneRmKg: number | null,
  bodyweightKg: number | null,
  kind: "compound" | "accessory" = "compound"
): number | null {
  if (!oneRmKg || oneRmKg <= 0 || !bodyweightKg || bodyweightKg <= 0) return null;
  const ratio = (oneRmKg / bodyweightKg) * (kind === "accessory" ? 2 : 1);
  if (ratio <= 0.05) return 50;
  const score = Math.round(380 * Math.log(ratio) + 500);
  return Math.min(999, Math.max(50, score));
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type FormErrors = Record<string, string>;

export interface ErrorSummaryItem {
  key: string;
  /** Where the problem is, in the words the form uses on screen. */
  label: string;
  message: string;
}

const TOP_LEVEL_ERROR_LABELS: Record<string, string> = {
  startedAt: "Date & start time",
  duration: "Duration",
  distance: "Distance",
  split: "Avg split / 500m",
  elevation: "Elevation gain",
  avgHr: "Avg heart rate",
  avgPower: "Avg power",
  temperature: "Temperature",
  rpe: "RPE",
  bodyweight: "Bodyweight",
  exercises: "Exercises",
  intervalReps: "Interval reps",
  intervalWorkDistance: "Interval work distance",
  intervalWorkSeconds: "Interval work time",
  intervalRestSeconds: "Interval rest",
  intervalWorkHr: "Interval work heart rate",
  fartlekOnDistance: "Fartlek “on” distance",
  fartlekOnSeconds: "Fartlek “on” time",
  fartlekOnHr: "Fartlek “on” heart rate",
  form: "Something needs a second look",
};

const SET_FIELD_LABELS: Record<string, string> = {
  weight: "weight",
  reps: "reps",
  duration: "hold time",
  distance: "distance",
  rpe: "RPE",
  rir: "RIR",
};

const BLOCK_FIELD_LABELS: Record<string, string> = {
  reps: "reps",
  distanceMeters: "distance",
  workSeconds: "work time",
  workHr: "work heart rate",
};

/**
 * Turn the raw error map into something an athlete can act on.
 *
 * User-reported: a validation error blocks saving a gym session, and the only
 * thing on screen is "A few fields need attention before we can score this."
 * Which fields, and where? On a workout with eight exercises and thirty sets
 * the offending one can be several screens away from the submit button that
 * refused, and a red border you cannot see is the same as no message at all.
 *
 * This names each problem in the words the form itself uses ("Exercise 3, set
 * 2 — reps"), so the summary beside the submit button is a list of places to
 * go rather than an apology.
 */
export function summarizeErrors(
  errors: FormErrors,
  state: WorkoutFormState
): ErrorSummaryItem[] {
  const exerciseIndex = new Map(state.exercises.map((row, i) => [row.id, i + 1]));
  const setIndex = new Map<string, number>();
  for (const row of state.exercises) {
    row.sets.forEach((s, i) => setIndex.set(`${row.id}:${s.id}`, i + 1));
  }
  const blockIndex = new Map(state.intervalBlocks.map((b, i) => [b.id, i + 1]));

  const items: ErrorSummaryItem[] = [];
  for (const [key, message] of Object.entries(errors)) {
    if (!message) continue;

    if (key.startsWith("ex.")) {
      const parts = key.split(".");
      const rowId = parts[1];
      const n = exerciseIndex.get(rowId);
      const where = n ? `Exercise ${n}` : "An exercise";
      if (parts[2] === "set") {
        const setId = parts[3];
        const m = setIndex.get(`${rowId}:${setId}`);
        const field = SET_FIELD_LABELS[parts[4]] ?? parts[4];
        items.push({ key, label: `${where}, set ${m ?? "?"} — ${field}`, message });
      } else {
        const field =
          parts[2] === "name" ? "name" : parts[2] === "muscle" ? "muscle group" : "sets";
        items.push({ key, label: `${where} — ${field}`, message });
      }
      continue;
    }

    if (key.startsWith("ivl.")) {
      const parts = key.split(".");
      const n = blockIndex.get(parts[1]);
      const field = BLOCK_FIELD_LABELS[parts[2]] ?? parts[2];
      items.push({ key, label: `Block ${n ?? "?"} — ${field}`, message });
      continue;
    }

    items.push({ key, label: TOP_LEVEL_ERROR_LABELS[key] ?? key, message });
  }
  return items;
}

/**
 * Has the athlete put anything in this set worth submitting?
 *
 * Deliberately covers duration/distance as well as weight/reps: a plank has
 * neither weight nor reps, so a "did you type anything" test built only on
 * those two silently discarded every timed/carry set and then complained
 * that the exercise had no sets.
 */
function setHasEntry(s: SetRowState): boolean {
  return (
    s.weight !== "" || s.reps !== "" || !!s.durationSeconds || !!s.distanceMeters
  );
}

const gymSetSchema = z.object({
  weight_kg: z.number().min(0),
  // Always >= 1, including for timed/carry sets — see the comment where this
  // is built: gym_exercises.reps is NOT NULL CHECK (reps > 0).
  reps: z.number().int().positive(),
  rpe: z.number().min(1).max(10).optional(),
  duration_seconds: z.number().int().positive().nullable().optional(),
  distance_meters: z.number().int().positive().nullable().optional(),
});

const gymExerciseSchema = z.object({
  exercise_name: z.string().min(1),
  muscle_group: z.string().min(1),
  sets: z.array(gymSetSchema).min(1),
  order_index: z.number().int().min(0),
});

const payloadSchema = z.object({
  sport: z.enum([
    "running",
    "walking",
    "swimming",
    "rowing",
    "bike_erg",
    "indoor_cycling",
    "outdoor_cycling",
    "ski_erg",
    "gym",
  ]),
  title: z.string().optional(),
  started_at: z.string().min(1),
  duration_seconds: z.number().int().positive(),
  distance_meters: z.number().positive().optional(),
  elevation_meters: z.number().min(0).optional(),
  avg_heart_rate: z.number().int().min(30).max(250).optional(),
  avg_power_watts: z.number().positive().optional(),
  avg_split_seconds: z.number().positive().optional(),
  avg_pace_seconds_per_km: z.number().positive().optional(),
  stroke_type: z.string().optional(),
  temperature_celsius: z.number().min(-40).max(55).optional(),
  session_type: z.enum(SESSION_TYPE_VALUES).optional(),
  interval_reps: z.number().int().positive().optional(),
  interval_work_distance_meters: z.number().positive().optional(),
  interval_work_seconds: z.number().positive().optional(),
  interval_rest_seconds: z.number().min(0).optional(),
  interval_work_avg_hr: z.number().int().min(30).max(250).optional(),
  fartlek_on_distance_meters: z.number().positive().optional(),
  fartlek_on_seconds: z.number().positive().optional(),
  fartlek_on_avg_hr: z.number().int().min(30).max(250).optional(),
  rpe: z.number().min(1).max(10).optional(),
  notes: z.string().optional(),
  exercises: z.array(gymExerciseSchema).optional(),
  bodyweight_kg: z.number().positive().optional(),
});

interface ValidationResult {
  errors: FormErrors;
  payload: ActivityPayload | null;
}

export function validateAndBuildPayload(
  sport: SportType,
  state: WorkoutFormState
): ValidationResult {
  const errors: FormErrors = {};
  const fields = SPORT_FIELDS[sport];

  const requireNumber = (
    key: string,
    raw: string,
    opts: { required?: boolean; min?: number; max?: number; label: string }
  ): number | undefined => {
    const value = parseNum(raw);
    if (value === null) {
      if (raw.trim() !== "") errors[key] = `${opts.label} must be a number`;
      else if (opts.required) errors[key] = `${opts.label} is required`;
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      errors[key] = `${opts.label} must be at least ${opts.min}`;
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      errors[key] = `${opts.label} must be at most ${opts.max}`;
      return undefined;
    }
    return value;
  };

  if (!state.startedAt || Number.isNaN(new Date(state.startedAt).getTime())) {
    errors.startedAt = "Pick a valid date & time";
  }

  // Rowing/ski erg: split is mandatory and, depending on rowInputMode, either
  // distance or duration is entered directly while the other is derived from
  // split — resolve split first since both branches below depend on it.
  let avgSplit: number | undefined;
  if (fields.split) {
    const split = splitSecondsFromState(state);
    if (split === null) {
      if (fields.derivableDistance) errors.split = "Split is required";
    } else if (split < 50 || split > 900) {
      errors.split = "Split should be between 0:50 and 15:00";
    } else {
      avgSplit = split;
    }
  }

  const derivesTime = fields.derivableDistance && state.rowInputMode === "distance";
  const derivesDistance = fields.derivableDistance && state.rowInputMode === "time";

  let distanceMeters: number | undefined;
  if (fields.distance && !derivesDistance) {
    const raw = requireNumber("distance", state.distance, {
      required: true,
      min: 0.001,
      label: "Distance",
    });
    if (raw !== undefined) {
      distanceMeters = fields.distance === "km" ? Math.round(raw * 1000) : Math.round(raw);
    }
  }

  let duration: number;
  if (derivesTime) {
    // Distance/split validation above already set their own errors if
    // missing — a resulting 0 here means the payload build fails downstream,
    // not a distinct "duration" error.
    duration = avgSplit != null && distanceMeters != null ? (avgSplit / 500) * distanceMeters : 0;
  } else {
    duration = totalDurationSeconds(state);
    if (duration <= 0) {
      errors.duration = "Add a duration";
    } else if (duration > 24 * 3600) {
      errors.duration = "Duration looks too long";
    }
  }

  if (derivesDistance && avgSplit != null && duration > 0) {
    distanceMeters = Math.round((duration / avgSplit) * 500);
  }

  // Pace (seconds/km) for the km-distance sports (running, walking, outdoor
  // cycling) — mirrors avgSplit's role for rowing/ski erg above, but this was
  // previously never computed here at all: the live on-screen pace preview
  // (derivePacePerKm) was display-only and never made it into the submitted
  // payload, so avg_pace_seconds_per_km stayed null in the DB for every
  // manually-logged run, and the activity detail page's "Pace" tile (and any
  // future split display) had nothing to show for these sessions even though
  // GPS-tracked runs populate it fine.
  const avgPace =
    fields.distance === "km" && distanceMeters != null && distanceMeters > 0 && duration > 0
      ? duration / (distanceMeters / 1000)
      : undefined;

  const elevation = fields.elevation
    ? requireNumber("elevation", state.elevation, { min: 0, label: "Elevation" })
    : undefined;

  const avgHr = fields.avgHr
    ? requireNumber("avgHr", state.avgHr, { min: 30, max: 250, label: "Heart rate" })
    : undefined;

  const avgPower = fields.power
    ? requireNumber("avgPower", state.avgPower, { min: 1, max: 2500, label: "Power" })
    : undefined;

  // Structured interval/fartlek data is entirely optional — only validated
  // (and only sent) when the athlete has actually started filling in the
  // sub-form for the matching session type; otherwise the session scores
  // off the whole-session average exactly as before.
  let intervalReps: number | undefined;
  let intervalWorkDistance: number | undefined;
  let intervalWorkSeconds: number | undefined;
  let intervalRestSeconds: number | undefined;
  let intervalWorkHr: number | undefined;
  const filledBlocks =
    fields.sessionType && state.sessionType === "interval"
      ? state.intervalBlocks.filter(intervalBlockHasEntry)
      : [];
  if (filledBlocks.length > 0) {
    // Blocks win when they exist. They collapse to the same five fields the
    // uniform sub-form has always produced (see flattenIntervalBlocks) — the
    // payload, the columns and the scorer are untouched by this feature.
    for (const block of filledBlocks) {
      const key = (field: string) => `ivl.${block.id}.${field}`;
      const reps = requireNumber(key("reps"), block.reps, {
        required: true,
        min: 1,
        max: 100,
        label: "Reps",
      });
      // A rep whose own override supplies the missing number is fine, so the
      // block-level fields are only required when some rep would be left
      // without one — which is precisely what resolveIntervalBlock tests.
      const resolvedReps = reps !== undefined ? resolveIntervalBlock(block) : null;
      if (reps !== undefined && !resolvedReps) {
        if (parseNum(block.distanceMeters) === null) {
          errors[key("distanceMeters")] = "Distance is required";
        }
        if (parseSeconds(block.workSeconds) === null) {
          errors[key("workSeconds")] = "Work time is required";
        }
        if (
          parseNum(block.distanceMeters) !== null &&
          parseSeconds(block.workSeconds) !== null
        ) {
          errors[key("reps")] = "Every rep needs a distance and a time";
        }
      }
      if (block.workHr.trim() !== "") {
        requireNumber(key("workHr"), block.workHr, {
          min: 30,
          max: 250,
          label: "Work heart rate",
        });
      }
    }

    const flattened = flattenIntervalBlocks(filledBlocks);
    if (flattened) {
      intervalReps = flattened.reps;
      intervalWorkDistance = flattened.workDistanceMeters;
      intervalWorkSeconds = flattened.workSeconds;
      intervalRestSeconds = flattened.restSeconds;
      intervalWorkHr = flattened.workHr ?? undefined;
    }
  } else if (
    fields.sessionType &&
    state.sessionType === "interval" &&
    state.intervalReps.trim() !== ""
  ) {
    intervalReps = requireNumber("intervalReps", state.intervalReps, {
      required: true,
      min: 1,
      max: 100,
      label: "Reps",
    });
    intervalWorkDistance = requireNumber("intervalWorkDistance", state.intervalWorkDistance, {
      required: true,
      min: 1,
      label: "Work distance",
    });
    intervalWorkSeconds = requireNumber("intervalWorkSeconds", state.intervalWorkSeconds, {
      required: true,
      min: 1,
      label: "Work time",
    });
    intervalRestSeconds = requireNumber("intervalRestSeconds", state.intervalRestSeconds, {
      required: true,
      min: 0,
      label: "Rest time",
    });
    intervalWorkHr =
      state.intervalWorkHr.trim() !== ""
        ? requireNumber("intervalWorkHr", state.intervalWorkHr, {
            min: 30,
            max: 250,
            label: "Work heart rate",
          })
        : undefined;
  }

  let fartlekOnDistance: number | undefined;
  let fartlekOnSeconds: number | undefined;
  let fartlekOnHr: number | undefined;
  if (fields.sessionType && state.sessionType === "fartlek" && state.fartlekOnDistance.trim() !== "") {
    fartlekOnDistance = requireNumber("fartlekOnDistance", state.fartlekOnDistance, {
      required: true,
      min: 1,
      label: "On distance",
    });
    fartlekOnSeconds = requireNumber("fartlekOnSeconds", state.fartlekOnSeconds, {
      required: true,
      min: 1,
      label: "On time",
    });
    fartlekOnHr =
      state.fartlekOnHr.trim() !== ""
        ? requireNumber("fartlekOnHr", state.fartlekOnHr, {
            min: 30,
            max: 250,
            label: "On heart rate",
          })
        : undefined;
  }

  const temperature = fields.temperature
    ? requireNumber("temperature", state.temperature, {
        min: -40,
        max: 55,
        label: "Temperature",
      })
    : undefined;

  const rpe = fields.rpe
    ? requireNumber("rpe", state.rpe, { min: 1, max: 10, label: "RPE" })
    : undefined;

  let exercises: ActivityPayload["exercises"];
  let bodyweight: number | undefined;
  let exerciseNotes: Record<string, string> | undefined;

  if (sport === "gym") {
    bodyweight = requireNumber("bodyweight", state.bodyweight, {
      min: 25,
      max: 300,
      label: "Bodyweight",
    });

    const meaningfulRows = state.exercises.filter(
      (row) =>
        row.name.trim() !== "" ||
        row.sets.some((s) => setHasEntry(s))
    );

    if (meaningfulRows.length === 0) {
      errors.exercises = "Add at least one exercise";
    }

    exercises = [];
    const notesMap: Record<string, string> = {};
    meaningfulRows.forEach((row, index) => {
      const rowKey = (field: string) => `ex.${row.id}.${field}`;
      if (row.name.trim() === "") errors[rowKey("name")] = "Name this exercise";
      if (row.muscleGroup === "") errors[rowKey("muscle")] = "Pick a muscle group";

      // What this exercise is actually counted in — reps for almost
      // everything, but a plank is a HOLD (seconds) and a carry/sled is a
      // DISTANCE (metres). Both used to be unloggable: neither has reps, so
      // the unconditional "Reps is required" below rejected them, and because
      // a single row's error aborts the whole payload, one plank blocked the
      // entire session from saving.
      const tracking = getExerciseTracking(row.name);

      const meaningfulSets = row.sets.filter((s) => setHasEntry(s));
      if (meaningfulSets.length === 0) {
        errors[rowKey("sets")] =
          tracking === "time"
            ? "Add at least one hold"
            : tracking === "distance"
              ? "Add at least one carry"
              : "Add at least one set";
      }

      const parsedSets = meaningfulSets.map((s) => {
        const setKey = (field: string) => `ex.${row.id}.set.${s.id}.${field}`;
        // Read the ceiling from the server's own guard rather than repeating a
        // number here. A 550kg leg press used to pass this form, reach the API
        // and come back as a whole-session 400 with no indication of which lift
        // caused it — failing here instead names the exercise and the field.
        // The limit is per-exercise: machine-anchored leg movements carry a
        // higher ceiling than free weights, so a hardcoded constant would now
        // reject loads the server is happy to accept.
        const weight = requireNumber(setKey("weight"), s.weight, {
          min: 0,
          max: liftWeightLimits(row.name).maxWeightKg,
          label: "Weight",
        });
        // Only ONE of reps / duration / distance is required, and which one
        // depends on the movement.
        const reps =
          tracking === "reps"
            ? requireNumber(setKey("reps"), s.reps, {
                required: true,
                min: 1,
                max: 200,
                label: "Reps",
              })
            : undefined;
        const durationSeconds =
          tracking === "time"
            ? requireNumber(setKey("duration"), s.durationSeconds ?? "", {
                required: true,
                min: 1,
                max: 3600,
                label: "Hold time",
              })
            : undefined;
        const setDistanceMeters =
          tracking === "distance"
            ? requireNumber(setKey("distance"), s.distanceMeters ?? "", {
                required: true,
                min: 1,
                max: 1000,
                label: "Distance",
              })
            : undefined;
        const setRpe = requireNumber(setKey("rpe"), s.rpe, {
          min: 1,
          max: 10,
          label: "RPE",
        });
        const rirRaw = s.repsInReserve.trim();
        const rir = rirRaw
          ? requireNumber(setKey("rir"), rirRaw, {
              min: 0,
              max: 10,
              label: "RIR",
            })
          : undefined;
        return {
          weight_kg: s.weight.trim() === "" ? 0 : weight ?? 0,
          // `reps` is NOT NULL CHECK (reps > 0) on gym_exercises, and the API
          // inserts the summarised row without checking for an error — so a
          // reps-less plank sent as reps: 0 would fail the insert silently and
          // save a workout with no exercises behind the success screen. A
          // timed/carry set therefore counts as one performed effort (1); the
          // real measurement rides along in duration_seconds/distance_meters,
          // which the API passes through verbatim into the set_details JSONB.
          reps: tracking === "reps" ? Math.round(reps ?? 0) : 1,
          rpe: setRpe ?? null,
          reps_in_reserve: rir ?? null,
          duration_seconds:
            durationSeconds !== undefined ? Math.round(durationSeconds) : null,
          distance_meters:
            setDistanceMeters !== undefined ? Math.round(setDistanceMeters) : null,
        };
      });

      exercises!.push({
        exercise_name: row.name.trim(),
        muscle_group: row.muscleGroup,
        sets: parsedSets,
        order_index: index,
        weight_entry_mode: row.weightEntryMode,
        attachment: row.attachment,
      });
      if (row.notes.trim()) {
        notesMap[String(index)] = row.notes.trim();
      }
    });

    if (Object.keys(notesMap).length > 0) {
      exerciseNotes = notesMap;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, payload: null };
  }

  const payload: ActivityPayload = {
    sport,
    title: state.title.trim() || undefined,
    started_at: new Date(state.startedAt).toISOString(),
    duration_seconds: duration,
    distance_meters: distanceMeters,
    elevation_meters: elevation,
    avg_heart_rate: avgHr !== undefined ? Math.round(avgHr) : undefined,
    avg_power_watts: avgPower !== undefined ? Math.round(avgPower) : undefined,
    avg_split_seconds: avgSplit,
    avg_pace_seconds_per_km: avgPace,
    stroke_type: fields.stroke ? state.strokeType : undefined,
    temperature_celsius: temperature,
    session_type: fields.sessionType ? state.sessionType : "easy",
    interval_reps: intervalReps !== undefined ? Math.round(intervalReps) : undefined,
    interval_work_distance_meters: intervalWorkDistance,
    interval_work_seconds: intervalWorkSeconds,
    interval_rest_seconds: intervalRestSeconds,
    interval_work_avg_hr: intervalWorkHr !== undefined ? Math.round(intervalWorkHr) : undefined,
    fartlek_on_distance_meters: fartlekOnDistance,
    fartlek_on_seconds: fartlekOnSeconds,
    fartlek_on_avg_hr: fartlekOnHr !== undefined ? Math.round(fartlekOnHr) : undefined,
    rpe,
    notes: state.notes.trim() || undefined,
    exercises,
    bodyweight_kg: bodyweight,
    exercise_notes: exerciseNotes,
  };

  // Structural safety net — strips nothing, just guarantees shape.
  const check = payloadSchema.safeParse({
    ...payload,
    exercises: payload.exercises?.map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => ({ ...s, rpe: s.rpe ?? undefined })),
    })),
  });
  if (!check.success) {
    return { errors: { form: "Something looks off — double-check the highlighted fields" }, payload: null };
  }

  return { errors: {}, payload };
}
