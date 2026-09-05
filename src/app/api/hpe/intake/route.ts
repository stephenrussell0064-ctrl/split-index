import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  INTAKE_SECTIONS,
  SECTION_FIELDS,
  parseIntakeRow,
  type IntakeSection,
} from "@/lib/scoring/hpe/intake-record";
import { loadPrefilledIntake } from "@/lib/scoring/hpe/load-intake";

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

  // Allowlisted per section: a PATCH claiming to be the preferences section
  // must not be able to rewrite the safety answers.
  const allowed = new Set(SECTION_FIELDS[section]);
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body?.values ?? {})) {
    if (allowed.has(key)) values[key] = value;
  }

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
      ...values,
      sections_completed: [...completed],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: refreshed } = await supabase.from("hpe_intake").select("*").eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ ok: true, intake: parseIntakeRow(refreshed as Record<string, unknown> | null) });
}
