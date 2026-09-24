import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { invalidRequest, parseBody, parseQuery, boundedParam } from "@/lib/validation/boundary";
import { z } from "zod";
import {
  createDrinkSchema,
  DRINK_MAX_AGE_DAYS,
  DRINK_MAX_FUTURE_MINUTES,
} from "@/lib/validation/schemas/drink";
import { findPreset, gramsOfEthanol, gramsToUnits } from "@/lib/recovery/alcohol";

/**
 * Logging a drink.
 *
 * GRAMS ARE COMPUTED HERE, NEVER SENT. The client posts what the athlete
 * chose — a preset id and a count, or a volume and an ABV — and this route
 * turns that into grams of ethanol using the same constants the recovery model
 * reads. Accepting grams from the body would hand the input that the entire
 * recovery score is built on to whoever is holding the session token, which is
 * the one number in this feature worth forging.
 *
 * The write is deliberately not idempotent. Four identical pints on the same
 * evening are four real rows, and an idempotency key derived from the content
 * would silently swallow the second, third and fourth.
 */

const MS_PER_DAY = 86_400_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseBody(request, createDrinkSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;

  const drankAt = new Date(body.drankAt);
  const now = Date.now();
  if (drankAt.getTime() > now + DRINK_MAX_FUTURE_MINUTES * 60_000) {
    return invalidRequest([
      { path: "drankAt", message: "That time is in the future." },
    ]);
  }
  if (drankAt.getTime() < now - DRINK_MAX_AGE_DAYS * MS_PER_DAY) {
    return invalidRequest([
      { path: "drankAt", message: `Drinks can only be logged up to ${DRINK_MAX_AGE_DAYS} days back.` },
    ]);
  }

  const resolved = resolveDrink(body);
  if (!resolved) {
    return invalidRequest([{ path: "presetId", message: "That is not a drink we know." }]);
  }

  /*
   * A zero-ABV drink is a valid thing to hold and not a thing this feature can
   * model — there is no dose, so there is no recovery effect to compute. The
   * table's CHECK (grams_ethanol > 0) would reject it anyway; catching it here
   * turns a generic "something went wrong" into a sentence that explains
   * itself. Rounded first, so a 0.004g entry cannot slip past a `> 0` test and
   * then fail the CHECK on the stored 0.00.
   */
  if (Number(resolved.gramsEthanol.toFixed(2)) <= 0) {
    return invalidRequest([
      { path: "abvPercent", message: "That drink has no alcohol in it, so there's nothing to track." },
    ]);
  }

  const { data: row, error } = await supabase
    .from("drink_logs")
    .insert({
      user_id: user.id,
      drank_at: drankAt.toISOString(),
      grams_ethanol: Number(resolved.gramsEthanol.toFixed(2)),
      preset_id: resolved.presetId,
      label: resolved.label,
      volume_ml: resolved.volumeMl,
      abv_percent: resolved.abvPercent,
      quantity: body.quantity,
      note: body.note ?? null,
    })
    .select("id, drank_at, grams_ethanol, preset_id, label, volume_ml, abv_percent, quantity, note")
    .single();

  if (error) return databaseError(error, { operation: "POST /api/recovery/drinks" });

  return NextResponse.json({
    drink: row,
    units: Math.round(gramsToUnits(resolved.gramsEthanol) * 10) / 10,
  });
}

function resolveDrink(body: z.infer<typeof createDrinkSchema>): {
  presetId: string;
  label: string;
  volumeMl: number;
  abvPercent: number;
  gramsEthanol: number;
} | null {
  /*
   * Narrowed on the presence of `volumeMl` rather than on `presetId ===
   * "custom"`. The preset branch's id is a zod enum built from a runtime array,
   * so its static type is plain `string` and comparing it to a literal narrows
   * nothing — the compiler would let a preset entry fall into the custom
   * branch and read a `label` that isn't there.
   */
  if ("volumeMl" in body) {
    return {
      presetId: "custom",
      label: body.label,
      volumeMl: body.volumeMl,
      abvPercent: body.abvPercent,
      gramsEthanol: gramsOfEthanol(body.volumeMl, body.abvPercent, body.quantity),
    };
  }

  const preset = findPreset(body.presetId);
  if (!preset) return null;
  return {
    presetId: preset.id,
    label: preset.label,
    volumeMl: preset.volumeMl,
    abvPercent: preset.abvPercent,
    gramsEthanol: gramsOfEthanol(preset.volumeMl, preset.abvPercent, body.quantity),
  };
}

const listQuerySchema = z.object({
  days: boundedParam([1, DRINK_MAX_AGE_DAYS], "days").optional(),
});

/** The drink history list. Owner-scoped by RLS and by the explicit filter. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseQuery(request, listQuerySchema);
  if (parsed.response) return parsed.response;
  const days = parsed.data.days ?? 30;

  const { data, error } = await supabase
    .from("drink_logs")
    .select("id, drank_at, grams_ethanol, preset_id, label, volume_ml, abv_percent, quantity, note")
    .eq("user_id", user.id)
    .gte("drank_at", new Date(Date.now() - days * MS_PER_DAY).toISOString())
    .order("drank_at", { ascending: false })
    .limit(500);

  if (error) return databaseError(error, { operation: "GET /api/recovery/drinks" });

  return NextResponse.json({ drinks: data ?? [] });
}

/**
 * Erase the whole alcohol log in one action.
 *
 * This is a privacy control, not a convenience, and it is the reason this
 * feature does not need an Article 9 consent gate in front of it. The
 * classification argument for treating drink logs as ordinary personal data
 * (see the note in lib/consent/article9.ts) rests on the athlete keeping real
 * control of it: optional to record, never shown to anybody else, never used
 * to characterise their health, and removable in full at any moment without
 * having to delete forty rows one at a time or ask anyone.
 *
 * A hard delete, deliberately. A flag that hides the rows is exactly the thing
 * somebody asking for this does not want, and the recovery model would keep
 * reading them.
 *
 * Every other part of the app is untouched: activities, scores, HRV readings
 * and the subscription are all somewhere else, and erasing this cannot cost
 * the athlete anything except the alcohol history they asked to be rid of.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("drink_logs")
    .delete()
    .eq("user_id", user.id)
    .select("id");

  if (error) return databaseError(error, { operation: "DELETE /api/recovery/drinks" });

  return NextResponse.json({ deleted: data?.length ?? 0 });
}
