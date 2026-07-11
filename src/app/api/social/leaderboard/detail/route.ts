import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLeaderboardDetail } from "@/lib/social/queries";
import { isPremiumUser } from "@/lib/retention/trial";

/** Gated at the API, not compute-and-hide: free requesters never receive another user's derived scores. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();

  const premium = profile
    ? isPremiumUser(profile.subscription_tier, profile.subscription_status)
    : false;

  if (!premium) {
    return NextResponse.json({ error: "Premium required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const detail = await fetchLeaderboardDetail(supabase, targetUserId);
  return NextResponse.json(detail);
}
