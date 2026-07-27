import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const action = body.action as "accept" | "decline" | "cancel" | undefined;

  if (!action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }

  const { data: duel } = await supabase
    .from("duels")
    .select("*")
    .eq("id", id)
    .single();

  if (!duel || duel.status !== "pending") {
    return NextResponse.json({ error: "Duel invite not found" }, { status: 404 });
  }

  if ((action === "accept" || action === "decline") && duel.opponent_id !== user.id) {
    return NextResponse.json({ error: "Only the invited friend can respond" }, { status: 403 });
  }
  if (action === "cancel" && duel.challenger_id !== user.id) {
    return NextResponse.json({ error: "Only the challenger can cancel" }, { status: 403 });
  }

  const nextStatus = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";

  const { error } = await supabase
    .from("duels")
    .update({ status: nextStatus, responded_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: nextStatus });
}
