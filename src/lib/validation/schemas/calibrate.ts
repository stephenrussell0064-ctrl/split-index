import { z } from "@/lib/validation/boundary";
import { ENDURANCE_SPORTS } from "@/lib/constants/sports";

/**
 * N1 — onboarding calibration, and the one behaviour change in the pass that
 * Stephen decided rather than me.
 *
 * WHAT IT USED TO DO
 * ------------------
 * `validLift` and `validCardioStat` were predicates fed to `.filter()`. An
 * entry that failed was DROPPED, and the request proceeded with whatever
 * survived. So an athlete who typed their deadlift as 600kg — a plausible
 * typo for 60 or 160 — finished onboarding with a score calibrated off two
 * lifts, was told it worked, and never learned the third had been discarded.
 * The only failure they could see was entering nothing valid at all.
 *
 * It now refuses, naming the lift. That is a behaviour change on the onboarding
 * path, which is why it was a decision and not a tidy-up.
 *
 * WHY REFUSING IS SAFE FOR THE SHIPPED FORM
 * -----------------------------------------
 * `score-reveal.tsx` builds the payload from `filledLifts` and
 * `completeCardioEntries`, which already require `weightKg > 0 && reps > 0` and
 * a non-zero distance and duration. It never sends an untouched lift, so
 * nothing that works today starts failing. What changes is only the case where
 * a field is FILLED and out of range — exactly the case that was being thrown
 * away in silence.
 *
 * THE BOUNDS ARE THE SHIPPED ONES, TO THE COMPARISON OPERATOR
 * ----------------------------------------------------------
 * `validLift` used `weightKg > MIN_LIFT_KG` with MIN_LIFT_KG = 0 — strictly
 * greater, so `.gt(0)` and not `.min(0)`. Reps were `>= 1 && <= 50` with no
 * integer check, and there is deliberately no `.int()` here either: a
 * fractional rep is nonsense and rejecting it would be a second behaviour
 * change nobody asked for. It is noted in the audit rather than smuggled in.
 */

const MIN_LIFT_KG = 0;
const MAX_LIFT_KG = 500;
const MIN_REPS = 1;
const MAX_REPS = 50;
const MIN_DISTANCE_METERS = 50;
const MAX_DISTANCE_METERS = 250_000;
const MIN_DURATION_SECONDS = 30;
const MAX_DURATION_SECONDS = 6 * 60 * 60;

/** One of squat, bench or deadlift, when the athlete entered it. */
const liftSchema = z
  .object({
    weightKg: z
      .number({ message: "Enter a weight." })
      .gt(MIN_LIFT_KG, "Enter a weight above zero.")
      .max(MAX_LIFT_KG, `That is above ${MAX_LIFT_KG}kg — check the number.`),
    reps: z
      .number({ message: "Enter the reps." })
      .min(MIN_REPS, "Enter at least one rep.")
      .max(MAX_REPS, `That is above ${MAX_REPS} reps — check the number.`),
  })
  .strict();

/** One cardio result. */
const cardioStatSchema = z
  .object({
    sport: z.enum(ENDURANCE_SPORTS as unknown as [string, ...string[]], {
      message: "That is not an endurance sport we score.",
    }),
    distanceMeters: z
      .number({ message: "Enter a distance." })
      .min(MIN_DISTANCE_METERS, "That distance is too short to score.")
      .max(MAX_DISTANCE_METERS, "That distance is longer than we can score."),
    durationSeconds: z
      .number({ message: "Enter a time." })
      .min(MIN_DURATION_SECONDS, "That time is too short to score.")
      .max(MAX_DURATION_SECONDS, "That time is longer than we can score."),
  })
  .strict();

export const calibrateSchema = z
  .object({
    /*
      Each lift optional, because leaving one out is how an athlete says they
      did not enter it. Present-but-invalid is the case that now fails, and the
      key name reaches the error, so "squat.weightKg" tells them which one.
    */
    sbd: z
      .object({
        squat: liftSchema.optional(),
        bench: liftSchema.optional(),
        deadlift: liftSchema.optional(),
      })
      .strict()
      .optional(),
    cardio: z.array(cardioStatSchema).optional(),
  })
  .strict();

export type CalibrateInput = z.infer<typeof calibrateSchema>;
