import { z } from "zod";
import type { ActivityFormData, SessionType, SportType } from "@/types";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";

/**
 * Local form state is kept as strings so typing is never blocked;
 * conversion + validation happens only on submit.
 */
export interface SetRowState {
  id: string;
  weight: string;
  reps: string;
  rpe: string;
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
  walking: { distance: "km", elevation: true, rpe: true },
  swimming: { distance: "m", stroke: true, sessionType: true, rpe: true },
  rowing: { distance: "m", split: true, avgHr: true, sessionType: true, rpe: true },
  ski_erg: { distance: "m", split: true, avgHr: true, sessionType: true, rpe: true },
  bike_erg: { distance: "m", power: true, avgHr: true, sessionType: true, rpe: true },
  indoor_cycling: { power: true, avgHr: true, sessionType: true, rpe: true },
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

export function createSetRow(previous?: SetRowState): SetRowState {
  return {
    id: nextSetId(),
    // Smart default: carry the previous set's loading scheme forward.
    weight: previous?.weight ?? "",
    reps: previous?.reps ?? "",
    rpe: "",
  };
}

export function createExerciseRow(previous?: ExerciseRowState): ExerciseRowState {
  return {
    id: nextRowId(),
    name: "",
    muscleGroup: "",
    sets: [createSetRow(previous?.sets[previous.sets.length - 1])],
    notes: "",
    weightEntryMode: previous?.weightEntryMode ?? "total",
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
                }))
            : [
                {
                  id: nextSetId(),
                  weight: str(row.weight, ""),
                  reps: str(row.reps, ""),
                  rpe: str(row.rpe, ""),
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
    state.notes !== "";
  const exercisesTouched = state.exercises.some(
    (row) =>
      row.name !== "" ||
      row.notes !== "" ||
      row.sets.some((s) => s.weight !== "" || s.reps !== "" || s.rpe !== "")
  );
  return touched || exercisesTouched;
}

const SESSION_TYPE_VALUES: SessionType[] = [
  "easy",
  "recovery",
  "tempo",
  "threshold",
  "interval",
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

const gymSetSchema = z.object({
  weight_kg: z.number().min(0),
  reps: z.number().int().positive(),
  rpe: z.number().min(1).max(10).optional(),
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
  stroke_type: z.string().optional(),
  temperature_celsius: z.number().min(-40).max(55).optional(),
  session_type: z.enum(SESSION_TYPE_VALUES).optional(),
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

  const duration = totalDurationSeconds(state);
  if (duration <= 0) {
    errors.duration = "Add a duration";
  } else if (duration > 24 * 3600) {
    errors.duration = "Duration looks too long";
  }

  let distanceMeters: number | undefined;
  if (fields.distance) {
    const raw = requireNumber("distance", state.distance, {
      required: true,
      min: 0.001,
      label: "Distance",
    });
    if (raw !== undefined) {
      distanceMeters = fields.distance === "km" ? Math.round(raw * 1000) : Math.round(raw);
    }
  }

  const elevation = fields.elevation
    ? requireNumber("elevation", state.elevation, { min: 0, label: "Elevation" })
    : undefined;

  const avgHr = fields.avgHr
    ? requireNumber("avgHr", state.avgHr, { min: 30, max: 250, label: "Heart rate" })
    : undefined;

  const avgPower = fields.power
    ? requireNumber("avgPower", state.avgPower, { min: 1, max: 2500, label: "Power" })
    : undefined;

  let avgSplit: number | undefined;
  if (fields.split) {
    const split = splitSecondsFromState(state);
    if (split !== null) {
      if (split < 50 || split > 900) {
        errors.split = "Split should be between 0:50 and 15:00";
      } else {
        avgSplit = split;
      }
    }
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
        row.sets.some((s) => s.weight !== "" || s.reps !== "")
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

      const meaningfulSets = row.sets.filter(
        (s) => s.weight !== "" || s.reps !== ""
      );
      if (meaningfulSets.length === 0) {
        errors[rowKey("sets")] = "Add at least one set";
      }

      const parsedSets = meaningfulSets.map((s) => {
        const setKey = (field: string) => `ex.${row.id}.set.${s.id}.${field}`;
        const weight = requireNumber(setKey("weight"), s.weight, {
          min: 0,
          max: 600,
          label: "Weight",
        });
        const reps = requireNumber(setKey("reps"), s.reps, {
          required: true,
          min: 1,
          max: 200,
          label: "Reps",
        });
        const setRpe = requireNumber(setKey("rpe"), s.rpe, {
          min: 1,
          max: 10,
          label: "RPE",
        });
        return {
          weight_kg: s.weight.trim() === "" ? 0 : weight ?? 0,
          reps: Math.round(reps ?? 0),
          rpe: setRpe ?? null,
        };
      });

      exercises!.push({
        exercise_name: row.name.trim(),
        muscle_group: row.muscleGroup,
        sets: parsedSets,
        order_index: index,
        weight_entry_mode: row.weightEntryMode,
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
    stroke_type: fields.stroke ? state.strokeType : undefined,
    temperature_celsius: temperature,
    session_type: fields.sessionType ? state.sessionType : "easy",
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
