import {
  bounded,
  isoDateTime,
  numberFields,
  text,
  textFields,
  z,
} from "@/lib/validation/boundary";
import {
  BOUND_DISTANCE_M,
  BOUND_DURATION_S,
  BOUND_REPS,
  MAX_EXERCISES_PER_SESSION,
  MAX_SETS_PER_SESSION,
} from "@/lib/security/config";

/**
 * The activity write path — the largest input surface in the app and the one
 * that reaches the scoring engine.
 *
 * Mirrors ActivityFormData in src/types/index.ts. Where the two could drift,
 * activity-schema.test.ts holds them together: a field added to the type and
 * not to the schema would be silently dropped on save, which is a worse bug
 * than a rejection because the athlete is told it worked.
 *
 * `.strict()` is deliberate and load-bearing. The handler spreads parts of
 * this straight into a Supabase insert, so an unknown key is not harmless —
 * it is an attempt to write a column nobody validated. Rejecting is also how a
 * renamed field gets noticed on the first request rather than in a support
 * thread three weeks later.
 */

const SPORTS = [
  "running",
  "walking",
  "swimming",
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "outdoor_cycling",
  "ski_erg",
  "gym",
] as const;

const SESSION_TYPES = [
  "easy",
  "recovery",
  "tempo",
  "threshold",
  "interval",
  "fartlek",
  "race",
  "long",
  "other",
] as const;

const WEIGHT_ENTRY_MODES = ["total", "per_hand", "added"] as const;

export const sportSchema = z.enum(SPORTS, { message: "Pick a sport from the list." });
export const sessionTypeSchema = z.enum(SESSION_TYPES, {
  message: "Pick a session type from the list.",
});

/**
 * One logged set.
 *
 * weight_kg allows 0 and reps starts at 1 because a timed hold is persisted as
 * `reps: 1, weight_kg: 0` with the real measurement in duration_seconds — see
 * the note on GymExerciseSet. Tightening either would make planks unloggable.
 */
export const gymSetSchema = z
  .object({
    weight_kg: numberFields.liftLoadKg,
    reps: numberFields.reps,
    rpe: numberFields.rpe.nullish(),
    reps_in_reserve: bounded([0, 10], "reps in reserve").nullish(),
    duration_seconds: bounded(BOUND_DURATION_S, "hold time").nullish(),
    distance_meters: bounded(BOUND_DISTANCE_M, "carry distance").nullish(),
  })
  .strict();

export const gymExerciseSchema = z
  .object({
    exercise_name: text(80, "Exercise name").min(1, "An exercise needs a name."),
    muscle_group: text(40, "Muscle group"),
    sets: z
      .array(gymSetSchema)
      .min(1, "An exercise needs at least one set.")
      .max(MAX_SETS_PER_SESSION, `That is more than ${MAX_SETS_PER_SESSION} sets.`),
    order_index: bounded([0, MAX_EXERCISES_PER_SESSION], "exercise order").int(),
    weight_entry_mode: z.enum(WEIGHT_ENTRY_MODES).optional(),
    attachment: text(40, "Attachment").nullish(),
  })
  .strict();

/**
 * The field set, before the cross-field rules. Kept separate so PATCH can take
 * a partial of it — a refined schema is a wrapper, not an object, and cannot
 * be made partial.
 */
export const activityFieldsSchema = z
  .object({
    sport: sportSchema,
    title: textFields.title.optional(),
    started_at: isoDateTime,
    duration_seconds: numberFields.durationS,

    distance_meters: numberFields.distanceM.optional(),
    elevation_meters: numberFields.elevationM.optional(),
    avg_heart_rate: numberFields.heartRate.optional(),
    max_heart_rate: numberFields.heartRate.optional(),
    avg_power_watts: numberFields.powerWatts.optional(),
    avg_cadence: numberFields.cadence.optional(),

    // Pace and split are seconds per km / per 500m. Bounded by the same
    // ceiling as a whole activity, since a slower pace than that would mean a
    // single kilometre took longer than a day.
    avg_pace_seconds_per_km: bounded(BOUND_DURATION_S, "pace").optional(),
    avg_split_seconds: bounded(BOUND_DURATION_S, "split").optional(),

    stroke_type: text(30, "Stroke").optional(),
    temperature_celsius: numberFields.temperatureC.optional(),

    // Consumed server-side to look up conditions; never persisted as columns.
    start_latitude: bounded([-90, 90], "latitude").optional(),
    start_longitude: bounded([-180, 180], "longitude").optional(),

    session_type: sessionTypeSchema.optional(),

    interval_reps: bounded(BOUND_REPS, "interval reps").int().optional(),
    interval_work_distance_meters: numberFields.distanceM.optional(),
    interval_work_seconds: bounded(BOUND_DURATION_S, "interval work time").optional(),
    interval_rest_seconds: bounded(BOUND_DURATION_S, "interval rest time").optional(),
    interval_work_avg_hr: numberFields.heartRate.optional(),

    fartlek_on_distance_meters: numberFields.distanceM.optional(),
    fartlek_on_seconds: bounded(BOUND_DURATION_S, "fartlek time").optional(),
    fartlek_on_avg_hr: numberFields.heartRate.optional(),

    rpe: numberFields.rpe.optional(),
    notes: textFields.notes.optional(),

    exercises: z
      .array(gymExerciseSchema)
      .max(
        MAX_EXERCISES_PER_SESSION,
        `That is more than ${MAX_EXERCISES_PER_SESSION} exercises in one session.`
      )
      .optional(),

    source: z.enum(["manual", "gps"]).optional(),
    is_partial_track: z.boolean().optional(),

    /*
     * The GPS polyline. Not in ActivityFormData — the handler reaches it
     * through a cast — which is how `.strict()` found it: three route-privacy
     * tests went red the moment unknown keys stopped being accepted. Worth
     * recording, because a schema written from the type alone would have
     * silently broken GPS runs in production instead.
     *
     * `.catch(undefined)` rather than a plain array, so this one field keeps
     * the drop-don't-reject behaviour the route already documents: "a bad
     * route should cost the athlete their map, not their run." A malformed
     * polyline becomes undefined here and the session still saves; the shape
     * is still checked, so it cannot arrive as a 4MB string either.
     *
     * The cap is deliberately far above ROUTE_CONFIG.MAX_POINTS (400): points
     * arrive pre-simplification and sanitizeRoute does the trimming and the
     * privacy-zone removal afterwards.
     */
    route: z
      .array(z.tuple([z.number().finite(), z.number().finite()]))
      .max(20_000, "That route has too many points.")
      .optional()
      .catch(undefined),

    /*
     * The athlete's bodyweight at the time of the session. This is the field
     * WP3 is really about: it sits in a denominator in relative_strength, so a
     * 0 divides and a 1 produces a strength score two orders of magnitude
     * wrong — stored, and then read back as history by every later estimate.
     * BOUND_BODYWEIGHT_KG is 25..300.
     */
    bodyweight_kg: numberFields.bodyweightKg.optional(),

    exercise_notes: z.record(z.string(), textFields.notes).optional(),
  })
  .strict();

export const createActivitySchema = activityFieldsSchema
  /*
   * A gym session with no exercises is not a gym session, and the scoring
   * engine has nothing to score. Caught here rather than downstream so the
   * athlete gets told, instead of getting an activity with a null index.
   */
  .refine((v) => v.sport !== "gym" || (v.exercises?.length ?? 0) > 0, {
    message: "A gym session needs at least one exercise.",
    path: ["exercises"],
  })
  /*
   * Total sets across the whole session, not per exercise. The per-exercise
   * cap above would still allow 60 exercises x 200 sets.
   */
  .refine(
    (v) =>
      (v.exercises ?? []).reduce((n, e) => n + e.sets.length, 0) <= MAX_SETS_PER_SESSION,
    {
      message: `That is more than ${MAX_SETS_PER_SESSION} sets in one session.`,
      path: ["exercises"],
    }
  );

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

/**
 * PATCH sends the same fields, all optional.
 *
 * The cross-field rules are deliberately not reapplied here: a partial update
 * that touches only `notes` has no exercises in the payload and would fail the
 * "a gym session needs an exercise" refinement despite changing nothing about
 * the exercises. The handler re-scores from the stored row, which is where
 * that invariant actually holds.
 */
export const updateActivitySchema = activityFieldsSchema.partial();
