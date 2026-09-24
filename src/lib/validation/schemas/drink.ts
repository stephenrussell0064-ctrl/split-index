import { bounded, isoDateTime, text, z } from "@/lib/validation/boundary";
import {
  BOUND_ABV_PERCENT,
  BOUND_DRINK_QUANTITY,
  BOUND_DRINK_VOLUME_ML,
  MAX_NOTES_LEN,
} from "@/lib/security/config";
import { DRINK_PRESETS } from "@/lib/recovery/alcohol";

/**
 * A logged drink, at the API boundary.
 *
 * TWO SHAPES, ONE TABLE. A preset entry sends an id and a quantity; a custom
 * entry sends a volume and an ABV. Both are resolved server-side into the same
 * grams of ethanol, and the client never sends grams — if it did, the number
 * the whole recovery model is built on would be attacker-controlled, and a
 * single crafted request could park an athlete's recovery score at zero or
 * hide a genuine binge behind a fabricated 0.1g.
 *
 * `drankAt` is validated as a timestamp but its RANGE is checked in the
 * handler rather than here, because the bound is relative to now and a schema
 * that closes over `Date.now()` at module load is wrong for every request
 * after the first.
 */

const presetIds = DRINK_PRESETS.map((p) => p.id) as [string, ...string[]];

const presetDrink = z.object({
  presetId: z.enum(presetIds, { message: "That is not a drink we know." }),
  quantity: bounded(BOUND_DRINK_QUANTITY, "quantity").default(1),
  drankAt: isoDateTime,
  note: text(MAX_NOTES_LEN, "Note").optional(),
});

const customDrink = z.object({
  presetId: z.literal("custom"),
  label: text(60, "Drink name").min(1, "Give the drink a name."),
  volumeMl: bounded(BOUND_DRINK_VOLUME_ML, "volume"),
  abvPercent: bounded(BOUND_ABV_PERCENT, "ABV"),
  quantity: bounded(BOUND_DRINK_QUANTITY, "quantity").default(1),
  drankAt: isoDateTime,
  note: text(MAX_NOTES_LEN, "Note").optional(),
});

export const createDrinkSchema = z.union([presetDrink, customDrink]);

export type CreateDrinkInput = z.infer<typeof createDrinkSchema>;

/**
 * How far back and forward a drink may be dated.
 *
 * Forward at all, because "I'm out now" entries land a few minutes ahead when
 * a phone clock drifts, and rejecting those would be a mystifying failure. Not
 * far forward, because a drink dated next Tuesday would sit in the recovery
 * model as a permanent unexplained penalty.
 */
export const DRINK_MAX_FUTURE_MINUTES = 30;
export const DRINK_MAX_AGE_DAYS = 365;
