import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { databaseError } from "@/lib/api/errors";

/**
 * The writer `hpe_session_feedback` never had.
 *
 * F16 and F17 both depend on the athlete being able to say what happened:
 * whether a session was done, how hard it felt, whether the prescription was
 * met, and whether the day was a low-capacity one. The table and the
 * autoregulation arithmetic existed; nothing in the app could put a row in.
 *
 * Body: { sessionId, completed, sessionRpe?, metPrescription?, lowCapacity?, notes? }
 * One row per session — a second submission replaces the first.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  const rpe = body.sessionRpe == null ? null : Number(body.sessionRpe);
  if (rpe != null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
    return NextResponse.json({ error: "sessionRpe must be between 1 and 10" }, { status: 400 });
  }

  // The session must belong to one of this athlete's plans; RLS enforces it,
  // and checking first turns a silent policy failure into a readable answer.
  const { data: session } = await supabase
    .from("hpe_sessions")
    .select("id, hpe_plans!inner(user_id)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { error } = await supabase.from("hpe_session_feedback").upsert(
    {
      user_id: user.id,
      session_id: sessionId,
      logged_at: new Date().toISOString(),
      completed: Boolean(body.completed),
      session_rpe: rpe,
      met_prescription: Boolean(body.metPrescription ?? body.completed),
      low_capacity_flagged: Boolean(body.lowCapacity),
      notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
    },
    { onConflict: "session_id" }
  );
  // The raw message is logged and never returned: a PostgREST error carries
  // the constraint, the column and sometimes the value, and this table's rows
  // are tied to health screening. `databaseError` maps a known constraint to a
  // real sentence and everything else to a correlation id — see lib/api/errors.
  if (error) return databaseError(error, { operation: "POST /api/hpe/feedback" });

  return NextResponse.json({ ok: true });
}
