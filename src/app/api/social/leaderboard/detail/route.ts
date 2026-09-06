import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLeaderboardDetail } from "@/lib/social/queries";
import { PREMIUM_REQUIRED, getEntitlements } from "@/lib/premium/entitlements";

/** Gated at the API, not compute-and-hide: free requesters never receive another user's derived scores. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entitlements = await getEntitlements(supabase, user.id);

  if (!entitlements.premium) {
    return NextResponse.json(PREMIUM_REQUIRED, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const detail = await fetchLeaderboardDetail(supabase, targetUserId);
  return NextResponse.json(detail);
}
