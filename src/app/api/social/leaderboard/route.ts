import { NextResponse } from "next/server";
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
        rows: fallback.rows,
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

  return NextResponse.json(result);
}
