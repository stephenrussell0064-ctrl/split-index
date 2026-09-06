import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import {
  INTAKE_SECTIONS,
  parseIntakeRow,
  type IntakeSection,
} from "@/lib/scoring/hpe/intake-record";
import { loadPrefilledIntake } from "@/lib/scoring/hpe/load-intake";
import {
  hasArticle9Consent,
  isTier2Section,
  stripTier2Fields,
} from "@/lib/consent/article9";
import { invalidRequest } from "@/lib/validation/boundary";
import { validateIntakeValues } from "@/lib/validation/schemas/intake";

/**
 * WP2 — the intake endpoint.
 *
 * GET returns the athlete's stored answers alongside everything Split Index
 * already knows, so the form can pre-fill rather than ask. Design rule 1:
 * "Nothing is asked twice. Anything Split Index already holds is pre-filled
 * and shown for confirmation, never re-entered. Roughly 60% of these fields
 * fall into that category, which is the reason this product is buildable at
 * all."
 *
 * PATCH saves one section at a time. Section-at-a-time rather than
 * all-or-nothing because the flow is progressively disclosed and skippable —
 * an athlete who does safety and goal and then closes the tab must keep those
 * answers, not lose them for not having reached preferences.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: intakeRow }, prefilled] = await Promise.all([
    supabase.from("hpe_intake").select("*").eq("user_id", user.id).maybeSingle(),
    loadPrefilledIntake(supabase, user.id),
  ]);

  return NextResponse.json({
    intake: parseIntakeRow(intakeRow as Record<string, unknown> | null),
    prefilled,
    sections: INTAKE_SECTIONS,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { section?: string; values?: Record<string, unknown> } | null;
  const section = body?.section as IntakeSection | undefined;
  if (!section || !INTAKE_SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Unknown intake section." }, { status: 400 });
  }

  /*
   * Article 9 gate. The health and fuelling sections are special category data
   * and cannot be written without explicit consent on record — see
   * src/lib/consent/article9.ts.
   *
   * Checked here rather than only in the UI because the UI is not a control.
   * getArticle9Consent fails closed, so an unreachable consent table refuses
   * the write rather than allowing it.
   */
  const consented = await hasArticle9Consent(supabase, user.id);

  if (isTier2Section(section) && !consented) {
    return NextResponse.json(
      {
        error:
          "These questions need your explicit consent before we can store the answers.",
        consentRequired: true,
      },
      { status: 403 }
    );
  }

  /*
   * Allowlisted per section AND type-checked per field. The allowlist stops a
   * PATCH claiming to be the preferences section from rewriting the safety
   * answers; the field schemas stop `parq_positive: "no"` — a truthy string —
   * being stored as an answer about chest pain.
   *
   * A field that fails is a 400, not a silent drop. Dropping it would tell the
   * athlete their answer saved when it did not, which on the health screen is
   * the worst outcome available.
   */
  const validated = validateIntakeValues(section, body?.values ?? {});
  if (validated.errors.length > 0) return invalidRequest(validated.errors);
  const values = validated.values;

  /*
   * Belt and braces, and not redundant. The per-section allowlist above stops
   * a health field arriving inside the `training` section TODAY, because the
   * two lists happen not to overlap. That is a property of the current field
   * layout, not a guarantee — move one question between sections and the
   * allowlist would happily let it through on a section that is not gated.
   * This strips Tier 2 keys by name regardless of which door they came in.
   */
  const safeValues = consented ? values : stripTier2Fields(values);

  const { data: existing } = await supabase
    .from("hpe_intake")
    .select("sections_completed")
    .eq("user_id", user.id)
    .maybeSingle();

  const completed = new Set<string>((existing?.sections_completed as string[] | null) ?? []);
  completed.add(section);

  const { error } = await supabase.from("hpe_intake").upsert(
    {
      user_id: user.id,
      ...safeValues,
      sections_completed: [...completed],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  // Never the raw message: this write is to the special-category health table,
  // and a Postgres error naming a column here names a health question.
  if (error) return databaseError(error, { operation: "PATCH /api/hpe/intake" });

  const { data: refreshed } = await supabase.from("hpe_intake").select("*").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ ok: true, intake: parseIntakeRow(refreshed as Record<string, unknown> | null) });
}
