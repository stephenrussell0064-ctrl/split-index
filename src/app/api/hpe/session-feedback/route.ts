import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Tell the plan how a prescribed session actually went.
 *
 * THE HALF THAT WAS MISSING. `hpe_session_feedback` has existed since migration
 * 040 and had TWO READERS and NO WRITERS — the monitoring endpoint and the
 * admin fleet view both queried it, and nothing anywhere in the app ever
 * inserted a row. Everything downstream was built and inert:
 *
 *   * `autoregulate` (F16) computes a volume multiplier from the last week's
 *     feedback. With no feedback it returns 1, always, so the plan never
 *     stepped back after a week the athlete could not complete.
 *   * `applyLowCapacityDay` (F17) swaps a hard session on a bad day. Reachable
 *     only from its own tests.
 *   * Fleet monitoring reported 0 sessions completed and 100% abandonment for
 *     every athlete — not as a finding, but by construction, because the number
 *     it counts had no way of ever being anything else.
 *
 * So the engine's whole adaptive half was dark, and the plan repeated the same
 * week at an athlete who was drowning in it.
 *
 * ONE ROW PER SESSION, upserted. Changing your mind about how a session went is
 * a correction, not a second session, and `hpe_session_feedback` has a UNIQUE
 * constraint on session_id that says so.
 */

const FeedbackBody = z.object({
  sessionId: z.string().uuid(),
  completed: z.boolean(),
  /** Session RPE, the athlete's own 1-10. Null when they did not say. */
  sessionRpe: z.number().min(1).max(10).nullish(),
  /** Did they hit the prescribed load or pace? Distinct from `completed`: a session done at 80% is completed and did not meet prescription, and the engine needs both to tell "struggling" from "skipping". */
  metPrescription: z.boolean().default(false),
  /** F17 — the athlete marked the day low-capacity. Recorded so the swap rate is visible rather than invisible. */
  lowCapacityFlagged: z.boolean().default(false),
  notes: z.string().trim().max(500).nullish(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = FeedbackBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Could not read that feedback" }, { status: 400 });
  }

  const { sessionId, completed, sessionRpe, metPrescription, lowCapacityFlagged, notes } =
    parsed.data;

  /*
    The session has to belong to a plan of THIS athlete's.

    `hpe_sessions` is reached through `hpe_plans.user_id`, so the id alone
    proves nothing — without this check anyone could post feedback against
    anyone's session id and move a stranger's plan.
  */
  const { data: session } = await supabase
    .from("hpe_sessions")
    .select("id, plan_id, hpe_plans!inner(user_id)")
    .eq("id", sessionId)
    .maybeSingle();

  const owner = (session as { hpe_plans?: { user_id?: string } } | null)?.hpe_plans?.user_id;
  if (!session || owner !== user.id) {
    // The same answer a session that does not exist gets: posting to someone
    // else's plan must not reveal that their session id is real.
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { error } = await supabase.from("hpe_session_feedback").upsert(
    {
      user_id: user.id,
      session_id: sessionId,
      completed,
      session_rpe: sessionRpe ?? null,
      met_prescription: metPrescription,
      low_capacity_flagged: lowCapacityFlagged,
      notes: notes || null,
      logged_at: new Date().toISOString(),
    },
    { onConflict: "session_id" }
  );

  if (error) {
    console.error("[hpe/session-feedback] upsert failed for", user.id, error);
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
