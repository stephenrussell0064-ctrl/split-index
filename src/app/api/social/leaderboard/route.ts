import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchLeaderboard } from "@/lib/social/leaderboard";
import { canAccessLeaderboardScope } from "@/lib/premium/features";
import type { LeaderboardPeriod } from "@/types";
import type { IndexMetric, LeaderboardScope } from "@/lib/social/constants";

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
    .select("subscription_tier, subscription_status, country")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") ?? "all_time") as LeaderboardPeriod;
  const scope = (searchParams.get("scope") ?? "global") as LeaderboardScope;
  const country = searchParams.get("country") ?? profile.country ?? undefined;
  const ageBracket = searchParams.get("ageBracket") ?? undefined;
  const weightClass = searchParams.get("weightClass") ?? undefined;
  const metric = (searchParams.get("metric") ?? "split") as IndexMetric;

  if (!canAccessLeaderboardScope(scope, profile)) {
    return NextResponse.json(
      {
        error: "Global leaderboards require Premium",
        premium_required: true,
        rows: await fetchLeaderboard(supabase, {
          period,
          scope: "country",
          country,
          metric,
        }),
      },
      { status: 403 }
    );
  }

  const rows = await fetchLeaderboard(supabase, {
    period,
    scope,
    country,
    ageBracket,
    weightClass,
    metric,
  });

  return NextResponse.json({ rows });
}
