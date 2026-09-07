import { text, z } from "@/lib/validation/boundary";
import { sportSchema } from "@/lib/validation/schemas/activity";

/**
 * N1 — the remaining body-taking routes.
 *
 * Same story as the first two batches: none of these was unguarded, and each
 * guard had a gap that a schema closes by construction rather than by
 * remembering. The gaps worth naming here:
 *
 *   `const body: ActivityBody = await request.json()` — a type ASSERTION, which
 *   is a promise to the compiler and nothing at all to the runtime. The PATCH
 *   handler then read seventeen fields off it and passed them to the scoring
 *   engine.
 *
 *   `const { sport, formData } = await request.json()` — no check of any kind,
 *   and `sport` goes straight into an upsert keyed on `(user_id, sport)`.
 *
 *   `body.action as "accept" | "decline" | "cancel"` — the same assertion in
 *   miniature. Any string reached the switch below it.
 *
 * A note on the size cap, which is the part no hand-rolled check had: `parseBody`
 * refuses a body over the configured limit BEFORE reading it, and again after,
 * because Content-Length is a claim rather than a fact. `activities/draft` stores
 * whatever `formData` it is given, so it was the one route where an unbounded
 * body went straight to the database.
 */

/** Scoring another athlete's session, 1 to 10. */
export const reactionSchema = z
  .object({
    score: z
      .number({ message: "Score must be a number." })
      .int("Score must be a whole number.")
      .min(1, "Score must be at least 1.")
      .max(10, "Score must be at most 10."),
  })
  .strict();

/**
 * An autosaved draft.
 *
 * `formData` is deliberately a passthrough record: it is the half-finished
 * contents of whichever form the athlete is in, the shape differs per sport,
 * and it is read back only by that same form. What it is NOT is unbounded any
 * more — `parseBody` caps the body, which is the guarantee this route never had.
 */
export const draftSchema = z
  .object({
    sport: sportSchema,
    formData: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Merging sessions the athlete already owns. */
export const mergeSchema = z
  .object({
    // Uuids rather than "any string", because these go into a WHERE clause.
    // Ownership is still checked in the handler — this only settles the shape.
    activityIds: z
      .array(z.string().uuid("That is not a valid session id."))
      .min(2, "Select at least two sessions to merge."),
    /**
     * Compute and return the plan without writing anything — this is what
     * drives the confirmation dialog.
     *
     * Nearly missed, and `.strict()` would have turned that into a 400 on every
     * preview: the dialog sends this field, and a schema that does not know
     * about it rejects the request rather than ignoring the key. Being strict
     * about unknown keys means knowing all the known ones.
     */
    dryRun: z.boolean().optional(),
  })
  .strict();

/**
 * Article 9 consent.
 *
 * The version echo is the point and the handler's comparison against
 * `ARTICLE9_CONSENT_VERSION` stays exactly where it is — a schema cannot know
 * which version this build ships. All this adds is that the field must be a
 * string, so a `null` or an object cannot reach an equality check that would
 * quietly answer false.
 */
export const article9ConsentSchema = z
  .object({
    acknowledgedVersion: z.string({ message: "Consent version must be text." }),
  })
  .strict();

/** Responding to a challenge. */
export const duelActionSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"], {
      message: "That is not something you can do to a duel.",
    }),
  })
  .strict();

/** Sending a friend request by username. */
export const friendRequestSchema = z
  .object({
    // The handler strips a leading "@" before looking the athlete up; the
    // schema allows one so that pasting "@rachel" is not a validation error.
    username: z
      .string({ message: "Enter a username." })
      .trim()
      .min(1, "Enter a username.")
      .max(21, "That username is too long."),
  })
  .strict();

/** Accepting or declining one. */
export const friendActionSchema = z
  .object({
    id: z.string().uuid("That is not a valid request id."),
    action: z.enum(["accept", "decline"], {
      message: "That is not something you can do to a friend request.",
    }),
  })
  .strict();

/*
 * Was MIN_TARGET / MAX_TARGET in the goals route. Moved so the validator and
 * the handler's message cannot drift apart.
 */
export const MIN_TARGET_INDEX = 350;
export const MAX_TARGET_INDEX = 999;
/** Was MAX_TITLE_LENGTH in the goals route. */
export const MAX_GOAL_TITLE_LENGTH = 120;

/**
 * Setting a target Split Index.
 *
 * `deadline`, not `targetDate` — the field the client actually sends, checked
 * against the handler rather than guessed at. `validateDeadline` stays where it
 * is and keeps accepting `""` and `null` as "no deadline", so the schema types
 * it loosely and lets that function decide; duplicating the rule here would be
 * a second definition to drift.
 */
export const createGoalSchema = z
  .object({
    targetSplitIndex: z
      .number({ message: "Enter a target." })
      .min(MIN_TARGET_INDEX, `Target must be between ${MIN_TARGET_INDEX} and ${MAX_TARGET_INDEX}`)
      .max(MAX_TARGET_INDEX, `Target must be between ${MIN_TARGET_INDEX} and ${MAX_TARGET_INDEX}`),
    title: text(MAX_GOAL_TITLE_LENGTH, "Title").optional(),
    deadline: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

/** Editing one. Every field but the id is optional, as the handler already treats them. */
export const updateGoalSchema = z
  .object({
    id: z.string().uuid("That is not a valid goal id."),
    title: text(MAX_GOAL_TITLE_LENGTH, "Title").optional(),
    targetSplitIndex: z
      .number()
      .min(MIN_TARGET_INDEX)
      .max(MAX_TARGET_INDEX)
      .optional(),
    deadline: z.union([z.string(), z.null()]).optional(),
    completed: z.boolean().optional(),
  })
  .strict();

/**
 * Changing the Hybrid Plan rollout.
 *
 * The eight-character minimum on `reason` is kept verbatim from the route, and
 * so is the reasoning: the audit row is the only thing that will explain this
 * change to whoever reads it in three months, including the person making it.
 */
export const rolloutSchema = z
  .object({
    reason: z
      .string({ message: "A reason is required." })
      .trim()
      .min(8, "A reason of at least 8 characters is required."),
    enabled: z.boolean().optional(),
    percentage: z
      .number({ message: "Percentage must be a number." })
      .int("Percentage must be a whole number.")
      .min(0, "Percentage must be at least 0.")
      .max(100, "Percentage must be at most 100.")
      .optional(),
  })
  .strict();

/**
 * A race the athlete is training for.
 *
 * The numeric fields stay loose ON PURPOSE, and this is the one place in the
 * batch where a tighter schema would have been a regression. The handler reads
 * them as `Number(body.distanceMeters)` and treats `""` as "not given" — so a
 * form that posts an empty string for an optional elevation is working today,
 * and `z.number().optional()` would start answering it with a 400. The schema
 * accepts what the client sends and the handler keeps doing the conversion.
 *
 * What this does add: a size cap, unknown keys refused, bounded text on the
 * three free-text fields, and a real check on the two enumerated ones.
 */
const looseNumber = z.union([z.number(), z.string(), z.null()]).optional();

export const createRaceSchema = z
  .object({
    eventName: text(120, "Event name").min(1, "Event name is required."),
    raceDate: z.string({ message: "A race date is required." }),
    locationName: text(120, "Location").optional(),
    distanceMeters: looseNumber,
    elevationGainMeters: looseNumber,
    elevationSource: z
      .enum(["gpx", "manual", "known"])
      .nullable()
      .optional(),
    notes: text(2_000, "Notes").nullable().optional(),
  })
  .strict();

/** A saved session template. */
export const sessionTemplateSchema = z
  .object({
    name: text(80, "Template name").min(1, "Template name is required."),
    sport: sportSchema,
    // Same reasoning as the draft: the shape is the form's, not this module's.
    template_data: z.record(z.string(), z.unknown()),
  })
  .strict();
