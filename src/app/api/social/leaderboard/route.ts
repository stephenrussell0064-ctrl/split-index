import { NextResponse } from "next/server";
import { fetchBlockedUserIds, withoutBlocked } from "@/lib/social/moderation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeaderboardWithBracket } from "@/lib/social/leaderboard";
import { canAccessLeaderboardScope } from "@/lib/premium/features";
import { parseQuery } from "@/lib/validation/boundary";
import { leaderboardQuerySchema } from "@/lib/validation/schemas/leaderboard";

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

  /*
   * Parsed, not cast. These used to be `as LeaderboardPeriod` and friends —
   * an assertion to the compiler about a value that came off the network,
   * which is the one place an assertion cannot be trusted. `?metric=nonsense`
   * fell through a switch with no default and returned the split index; a bad
   * scope skipped every filter branch and returned an unfiltered board.
   */
  const query = parseQuery(request, leaderboardQuerySchema);
  if (query.response) return query.response;
  const { period, scope, metric, ageBracket, weightClass } = query.data;
  const country = query.data.country ?? profile.country ?? undefined;

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
