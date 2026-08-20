import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchFriendFeed } from "@/lib/social/feed";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const page = await fetchFriendFeed(supabase, user.id, { offset });

  // A feed that could not be read is not an empty feed. Returning 200 here
  // makes FeedPanel render the "no activities yet" empty state over a broken
  // query, which tells the athlete their friends have posted nothing when the
  // truth is the database never answered. `error` is the shape FeedPanel
  // already reads on a non-ok response.
  if (page.error) {
    console.error("[social/feed] feed query failed for user", user.id, page.error);
    return NextResponse.json({ error: page.error }, { status: 503 });
  }

  return NextResponse.json(page);
}
