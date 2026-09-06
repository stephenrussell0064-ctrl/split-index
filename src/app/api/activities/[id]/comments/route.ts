import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";

const MAX_COMMENT_LENGTH = 1000;

/**
 * Comments on a friend's activity (Slice 1) — "similar to stravas concept."
 * RLS (migration 031) is the real visibility gate; this route's checks are
 * defense in depth.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: comments, error } = await supabase
    .from("activity_comments")
    .select("id, user_id, body, created_at")
    .eq("activity_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return databaseError(error, { operation: "GET /api/activities/[id]/comments" });
  }

  const authorIds = [...new Set((comments ?? []).map((c) => c.user_id as string))];
  const { data: authors } =
    authorIds.length > 0
      ? await supabase.from("public_profiles").select("user_id, username, display_name, avatar_url").in("user_id", authorIds)
      : { data: [] as { user_id: string; username: string | null; display_name: string | null; avatar_url: string | null }[] };
  const authorById = new Map((authors ?? []).map((a) => [a.user_id as string, a]));

  return NextResponse.json({
    comments: (comments ?? []).map((c) => {
      const author = authorById.get(c.user_id as string);
      return {
        id: c.id,
        userId: c.user_id,
        body: c.body,
        createdAt: c.created_at,
        author: {
          username: author?.username ?? null,
          displayName: author?.display_name ?? null,
          avatarUrl: author?.avatar_url ?? null,
        },
      };
    }),
  });
}

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
  const text = String(body.body ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Comment can't be empty" }, { status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  const { data: comment, error } = await supabase
    .from("activity_comments")
    .insert({ activity_id: id, user_id: user.id, body: text })
    .select()
    .single();

  if (error) {
    // RLS refuses the insert for an activity the requester cannot see. The 403
    // is right; the Postgres permission string that came with it is not — it
    // names the policy and the table.
    return NextResponse.json(
      { error: "You can't comment on that activity." },
      { status: 403 }
    );
  }

  return NextResponse.json({ comment });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) {
    return NextResponse.json({ error: "commentId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("activity_comments")
    .delete()
    .eq("id", commentId)
    .eq("activity_id", id)
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/activities/[id]/comments" });
  }

  return NextResponse.json({ ok: true });
}
