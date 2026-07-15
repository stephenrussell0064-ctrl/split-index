import type { Activity, GymExercise } from "@/types";
import {
  createDefaultState,
  createExerciseRow,
  nextRowId,
  nextSetId,
  type WorkoutFormState,
} from "@/components/activities/form-state";
import { setsForExercise } from "@/lib/activities/gym-sets";
import type { SportType } from "@/types";
import {
  defaultWeightEntryMode,
  type WeightEntryMode,
} from "@/lib/scoring/weight-entry";

function localDateTimeFromIso(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function durationParts(seconds: number): {
  hours: string;
  minutes: string;
  seconds: string;
} {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return {
    hours: h > 0 ? String(h) : "",
    minutes: m > 0 || h > 0 ? String(m) : "",
    seconds: s > 0 || m > 0 || h > 0 ? String(s) : "",
  };
}

function splitParts(totalSeconds: number | null): {
  splitMinutes: string;
  splitSeconds: string;
} {
  if (!totalSeconds) return { splitMinutes: "", splitSeconds: "" };
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return { splitMinutes: String(m), splitSeconds: String(s) };
}

/** Hydrate form state from a persisted activity (+ optional gym rows). */
export function activityToFormState(
  activity: Activity,
  exercises: GymExercise[] = [],
  profileWeightKg?: number | null
): WorkoutFormState {
  const sport = activity.sport as SportType;
  const base = createDefaultState(sport, profileWeightKg);
  const dur = durationParts(activity.duration_seconds);
  const split = splitParts(activity.avg_split_seconds);

  const metadata = activity.metadata ?? {};
  const exerciseNotes =
    typeof metadata === "object" &&
    metadata !== null &&
    "exercise_notes" in metadata &&
    typeof (metadata as Record<string, unknown>).exercise_notes === "object"
      ? ((metadata as Record<string, Record<string, string>>).exercise_notes ?? {})
      : {};

  let distance = "";
  if (activity.distance_meters) {
    if (sport === "swimming" || sport === "rowing" || sport === "ski_erg" || sport === "bike_erg") {
      distance = String(Math.round(activity.distance_meters));
    } else {
      distance = String(Math.round((activity.distance_meters / 1000) * 100) / 100);
    }
  }

  const bodyweightFromMeta =
    typeof metadata === "object" &&
    metadata !== null &&
    "bodyweight_kg" in metadata
      ? String((metadata as Record<string, number>).bodyweight_kg ?? "")
      : base.bodyweight;

  const exerciseWeightModes: Record<string, WeightEntryMode> =
    typeof metadata === "object" &&
    metadata !== null &&
    "exercise_weight_modes" in metadata &&
    typeof (metadata as Record<string, unknown>).exercise_weight_modes === "object"
      ? ((metadata as { exercise_weight_modes: Record<string, WeightEntryMode> })
          .exercise_weight_modes ?? {})
      : {};

  return {
    ...base,
    title: activity.title ?? "",
    startedAt: localDateTimeFromIso(activity.started_at),
    ...dur,
    distance,
    elevation: activity.elevation_meters ? String(activity.elevation_meters) : "",
    avgHr: activity.avg_heart_rate ? String(activity.avg_heart_rate) : "",
    avgPower: activity.avg_power_watts ? String(activity.avg_power_watts) : "",
    ...split,
    strokeType: activity.stroke_type ?? base.strokeType,
    temperature: activity.temperature_celsius
      ? String(activity.temperature_celsius)
      : "",
    sessionType: activity.session_type ?? base.sessionType,
    rpe: activity.rpe ? String(activity.rpe) : "",
    notes: activity.notes ?? "",
    bodyweight: bodyweightFromMeta,
    exercises:
      sport === "gym" && exercises.length > 0
        ? exercises
            .sort((a, b) => a.order_index - b.order_index)
            .map((ex) => ({
              id: ex.id || nextRowId(),
              name: ex.exercise_name,
              muscleGroup: ex.muscle_group,
              sets: setsForExercise(ex).map((s) => ({
                id: nextSetId(),
                weight: String(s.weight_kg),
                reps: String(s.reps),
                rpe: s.rpe ? String(s.rpe) : "",
                repsInReserve:
                  s.reps_in_reserve != null ? String(s.reps_in_reserve) : "",
              })),
              notes: exerciseNotes[String(ex.order_index)] ?? "",
              weightEntryMode:
                exerciseWeightModes[ex.exercise_name] ??
                defaultWeightEntryMode(ex.exercise_name),
            }))
        : sport === "gym"
          ? [createExerciseRow()]
          : [],
  };
}
