import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchCompareHistory } from "@/lib/social/queries";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username")?.replace(/^@/, "");
  const userId = searchParams.get("userId");
  const days = Number(searchParams.get("days") ?? 30);
  const metric = (searchParams.get("metric") ?? "split") as
    | "split"
    | "endurance"
    | "strength";

  let otherUserId = userId;

  if (username) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("username", username)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    otherUserId = profile.user_id;
  }

  if (!otherUserId) {
    return NextResponse.json({ error: "username or userId required" }, { status: 400 });
  }

  if (otherUserId === user.id) {
    return NextResponse.json({ error: "Cannot compare with yourself" }, { status: 400 });
  }

  const series = await fetchCompareHistory(
    supabase,
    user.id,
    otherUserId,
    days,
    metric
  );

  return NextResponse.json({ series });
}
