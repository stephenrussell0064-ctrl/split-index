import { NextResponse } from "next/server";
import { fetchBlockedUserIds, withoutBlocked } from "@/lib/social/moderation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeaderboardWithBracket } from "@/lib/social/leaderboard";
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

  const blocked = await fetchBlockedUserIds(supabase, user.id);

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") ?? "all_time") as LeaderboardPeriod;
  const scope = (searchParams.get("scope") ?? "bracket") as LeaderboardScope;
  const country = searchParams.get("country") ?? profile.country ?? undefined;
  const ageBracket = searchParams.get("ageBracket") ?? undefined;
  const weightClass = searchParams.get("weightClass") ?? undefined;
  const metric = (searchParams.get("metric") ?? "split") as IndexMetric;

  if (!canAccessLeaderboardScope(scope, profile)) {
    const fallback = await fetchLeaderboardWithBracket(
      supabase,
      {
        period,
        scope: "bracket",
        country,
        metric,
      },
      user.id
    );
    return NextResponse.json(
      {
        error: "Global leaderboards require Premium",
        premium_required: true,
        rows: withoutBlocked(fallback.rows, blocked, (row) => row.userId),
        bracket: fallback.bracket,
      },
      { status: 403 }
    );
  }

  const result = await fetchLeaderboardWithBracket(
    supabase,
    {
      period,
      scope,
      country,
      ageBracket,
      weightClass,
      metric,
    },
    user.id
  );

  /*
    A blocked athlete is removed from the board before it is sent.

    Ranks are deliberately NOT renumbered afterwards: they are this athlete's
    real position among everyone, and resequencing them would quietly tell a
    blocker they are higher up than they are. A gap in the numbering is the
    honest rendering of "someone is there and you have chosen not to see them".
  */
  return NextResponse.json({
    ...result,
    rows: withoutBlocked(result.rows, blocked, (row) => row.userId),
  });
}
