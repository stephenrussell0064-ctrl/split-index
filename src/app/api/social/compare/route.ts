import { parseQuery } from "@/lib/validation/boundary";
import { compareQuerySchema } from "@/lib/validation/schemas/query";
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

  /*
    N1. `Number(searchParams.get("days") ?? 30)` had no `||` fallback, so
    `?days=abc` produced NaN and NaN reached a date computation — the one
    genuine bug among the query parameters rather than a missing guard.
  */
  const q = parseQuery(request, compareQuerySchema);
  if (q.response) return q.response;
  const username = q.data.username?.replace(/^@/, "");
  const userId = q.data.userId ?? null;
  const days = q.data.days;
  // Another assertion, now an enum that falls back to "split" as before.
  const metric = q.data.metric;

  let otherUserId = userId;

  if (username) {
    const { data: profile } = await supabase
      .from("public_profiles")
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
