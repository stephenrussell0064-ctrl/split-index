import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Block and unblock another athlete — App Store Guideline 1.2's third
 * requirement ("the ability to block abusive users").
 *
 * The block is stored one way round and read both ways (see
 * lib/social/moderation.ts), so one row is enough to hide each athlete from the
 * other. Nothing here notifies the blocked party, and nothing anywhere lets them
 * query whether they have been blocked — a block that announces itself is worse
 * than no block for the person who needed it.
 */

const BlockBody = z.object({
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = BlockBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A user to block is required" }, { status: 400 });
  }
  if (parsed.data.userId === user.id) {
    return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  }

  const { error } = await supabase
    .from("blocked_users")
    // Idempotent: blocking twice is not an error, it is the same outcome. The
    // unique constraint on (blocker_id, blocked_id) makes this a no-op second
    // time rather than a 500 the UI would have to explain.
    .upsert(
      { blocker_id: user.id, blocked_id: parsed.data.userId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
    );

  if (error) {
    console.error("[social/block] failed for", user.id, error);
    return NextResponse.json({ error: "Could not block this athlete" }, { status: 500 });
  }

  /*
    Blocking severs the friendship in both directions.

    Leaving it in place would keep the blocked athlete on the friends list, in
    friend-scoped feeds and in friend-only leaderboards — surfaces the block is
    supposed to clear. Deleting the row is also the only way the block survives
    a later unblock without silently restoring a connection neither party asked
    to keep.
  */
  await supabase
    .from("friends")
    .delete()
    .or(
      `and(user_id.eq.${user.id},friend_id.eq.${parsed.data.userId}),` +
        `and(user_id.eq.${parsed.data.userId},friend_id.eq.${user.id})`
    );

  return NextResponse.json({ blocked: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const parsed = BlockBody.safeParse({ userId });
  if (!parsed.success) {
    return NextResponse.json({ error: "A user to unblock is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", parsed.data.userId);

  if (error) {
    console.error("[social/block] unblock failed for", user.id, error);
    return NextResponse.json({ error: "Could not unblock this athlete" }, { status: 500 });
  }

  // Unblocking does NOT restore the friendship the block removed. Re-adding
  // someone is a decision, not a side effect.
  return NextResponse.json({ blocked: false });
}

/** Who this athlete has blocked, for rendering "Blocked" state on a profile. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Outgoing only. The incoming half is deliberately not returned — see the
  // note on fetchBlockedUserIdsAdmin.
  const { data } = await supabase
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", user.id);

  return NextResponse.json({ blockedUserIds: (data ?? []).map((r) => r.blocked_id) });
}
