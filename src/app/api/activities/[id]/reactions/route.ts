import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 1-10 activity score (Slice 1) — user feedback: "other users are able to
 * interact with their activities on public accounts such as by scoring
 * their run out of 10." One score per (activity, viewer) — upsert, not
 * additive. RLS (migration 031) is the real gate on which activities this
 * can target; this route's own checks are defense in depth, matching the
 * pattern used everywhere else in the app.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    return NextResponse.json({ error: "Score must be a whole number from 1 to 10" }, { status: 400 });
  }

  const { data: reaction, error } = await supabase
    .from("activity_reactions")
    .upsert(
      { activity_id: id, user_id: user.id, score, updated_at: new Date().toISOString() },
      { onConflict: "activity_id,user_id" }
    )
    .select()
    .single();

  if (error) {
    // RLS blocks this insert for an activity the requester can't see —
    // surfaces as a Postgres permission error, not a generic 500.
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({ reaction });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("activity_reactions")
    .delete()
    .eq("activity_id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
