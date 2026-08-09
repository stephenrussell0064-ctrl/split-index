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
  return NextResponse.json(page);
}
