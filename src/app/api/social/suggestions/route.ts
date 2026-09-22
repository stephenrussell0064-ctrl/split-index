import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFriendSuggestions, MAX_SUGGESTIONS } from "@/lib/social/suggestions";

/**
 * People this athlete might know, from the graph they are already in.
 *
 * No query parameters on purpose. The answer depends only on who is asking,
 * so there is nothing for a caller to vary and nothing to validate — and a
 * suggestions endpoint that took a user id would be an endpoint for reading
 * somebody else's social graph.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { suggestions, error } = await fetchFriendSuggestions(supabase, user.id, MAX_SUGGESTIONS);

  // 503 rather than an empty list. An unreadable graph and a graph with nobody
  // in it look identical on screen, and only one of them means "you have
  // nobody to add" — and if the BLOCK list is what failed, carrying on would
  // suggest exactly the person being avoided.
  if (error) {
    console.error("[social/suggestions] failed for user", user.id, error);
    return NextResponse.json({ error }, { status: 503 });
  }

  if (suggestions.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  // Names and avatars come from public_profiles, which is the view that decides
  // what one athlete may see of another. Resolving them here rather than in the
  // suggestion query keeps that decision in one place.
  const { data: profiles } = await supabase
    .from("public_profiles")
    .select("user_id, username, display_name, avatar_url")
    .in(
      "user_id",
      suggestions.map((s) => s.userId)
    );

  const byId = new Map(
    ((profiles ?? []) as Array<{ user_id: string; username: string | null; display_name: string | null; avatar_url: string | null }>).map(
      (p) => [p.user_id, p]
    )
  );

  return NextResponse.json({
    suggestions: suggestions
      // A suggestion with no readable profile cannot be rendered or acted on,
      // and showing a blank card would be worse than showing one fewer.
      .filter((s) => byId.has(s.userId))
      .map((s) => ({
        ...s,
        username: byId.get(s.userId)?.username ?? null,
        displayName: byId.get(s.userId)?.display_name ?? null,
        avatarUrl: byId.get(s.userId)?.avatar_url ?? null,
      })),
  });
}
