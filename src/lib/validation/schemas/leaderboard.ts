import { z } from "@/lib/validation/boundary";
import { AGE_BRACKETS, WEIGHT_CLASSES } from "@/lib/social/constants";

/**
 * Leaderboard query parameters.
 *
 * These were read straight off the URL and cast:
 *
 *   const period = (searchParams.get("period") ?? "all_time") as LeaderboardPeriod;
 *   const scope  = (searchParams.get("scope")  ?? "bracket")  as LeaderboardScope;
 *   const metric = (searchParams.get("metric") ?? "split")    as IndexMetric;
 *
 * An `as` on a value that came off the network is a statement to the compiler
 * that is not true. `?metric=nonsense` produced a string typed as IndexMetric,
 * which then went into a switch with no default and silently returned the
 * split index; `?scope=nonsense` skipped every branch of the scope filter and
 * returned an unfiltered board. Neither errored, so neither was noticed.
 *
 * Parsing here means an unknown value is a 400 with a field message instead of
 * a plausible-looking wrong answer.
 */

export const leaderboardPeriodSchema = z.enum(["weekly", "monthly", "all_time"], {
  message: "Pick a time period from the list.",
});

export const leaderboardScopeSchema = z.enum(
  ["bracket", "global", "country", "age", "weight", "sport"],
  { message: "Pick a leaderboard from the list." }
);

export const indexMetricSchema = z.enum(["split", "endurance", "strength"], {
  message: "Pick an index from the list.",
});

/** ISO 3166-1 alpha-2. Two letters, so it cannot become a LIKE pattern. */
export const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "That is not a country code.");

/**
 * Bracket keys come from the shared constants rather than being restated, so a
 * band added to the dropdown is accepted here without a second edit — and one
 * removed stops being accepted, which is the direction that matters.
 */
export const ageBracketSchema = z.enum(
  AGE_BRACKETS.map((b) => b.value) as [string, ...string[]],
  { message: "Pick an age bracket from the list." }
);

export const weightClassSchema = z.enum(
  WEIGHT_CLASSES.map((w) => w.value) as [string, ...string[]],
  { message: "Pick a weight class from the list." }
);

export const leaderboardQuerySchema = z
  .object({
    period: leaderboardPeriodSchema.default("all_time"),
    scope: leaderboardScopeSchema.default("bracket"),
    metric: indexMetricSchema.default("split"),
    country: countryCodeSchema.optional(),
    ageBracket: ageBracketSchema.optional(),
    weightClass: weightClassSchema.optional(),
  })
  // Not strict: the leaderboard URL carries UI state (a selected tab, a scroll
  // anchor) that never reaches a query. Rejecting unknown parameters here
  // would break links without protecting anything, because every value the
  // handler reads is named above.
  .loose();

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
