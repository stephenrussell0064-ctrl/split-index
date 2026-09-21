import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { REFUSAL_MESSAGES, validateBlock } from "@/lib/moderation";

/**
 * Block and unblock another athlete — guideline 1.2's third requirement.
 *
 * The block itself is one row; the effect comes from migration 062, where
 * `is_blocked_pair` is consulted by the comment table's own select policy. That
 * placement is deliberate: a moderation control enforced in route handlers
 * works until somebody adds a fourth read path and forgets, and the failure is
 * silent and exactly the kind Apple rejects for.
 *
 * Unblocking is offered because a block people cannot undo is one they hesitate
 * to use, and hesitating to block is the outcome this is trying to avoid.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const blockedId = String(body.userId ?? "");
  if (!blockedId) return NextResponse.json({ error: "No user given" }, { status: 400 });

  const decision = validateBlock(user.id, blockedId);
  if (!decision.ok) {
    return NextResponse.json({ error: REFUSAL_MESSAGES[decision.reason] }, { status: 400 });
  }

  const { error } = await supabase
    .from("blocked_users")
    // Blocking twice is not an error. A second tap, or a retry on a flaky
    // connection, should leave the person blocked and say so.
    .upsert(
      { blocker_id: user.id, blocked_id: blockedId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
    );

  if (error) {
    return NextResponse.json({ error: "Could not block that account." }, { status: 500 });
  }

  return NextResponse.json({ blocked: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blockedId = new URL(request.url).searchParams.get("userId");
  if (!blockedId) return NextResponse.json({ error: "No user given" }, { status: 400 });

  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", blockedId);

  if (error) {
    return NextResponse.json({ error: "Could not unblock that account." }, { status: 500 });
  }

  return NextResponse.json({ blocked: false });
}

/** Who the viewer has blocked, for the settings screen. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: blocks } = await supabase
    .from("blocked_users")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });

  const ids = (blocks ?? []).map((b) => b.blocked_id as string);
  const { data: profiles } =
    ids.length > 0
      ? await supabase.from("public_profiles").select("user_id, username, display_name").in("user_id", ids)
      : { data: [] as { user_id: string; username: string | null; display_name: string | null }[] };

  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return NextResponse.json({
    blocked: (blocks ?? []).map((b) => ({
      userId: b.blocked_id,
      blockedAt: b.created_at,
      // A blocked account whose profile has since gone is still blocked; the
      // list must not drop the row just because there is no name for it.
      name: byId.get(b.blocked_id as string)?.display_name ?? byId.get(b.blocked_id as string)?.username ?? "Removed account",
    })),
  });
}
