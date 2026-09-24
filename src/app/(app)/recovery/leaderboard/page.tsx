import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LeaderboardConsentCard } from "@/components/recovery/leaderboard-consent-card";
import { LEADERBOARD_CONSENT_KEY, hasArticle9Consent } from "@/lib/consent/article9";
import { cn } from "@/lib/utils/cn";

/**
 * The alcohol-free streak leaderboard.
 *
 * WHAT IS ON IT AND WHAT IS NOT. Days since an athlete's last logged drink,
 * and how long they have been tracking. Not a drink, not a unit, not a volume,
 * not a timestamp, not a recovery score — the view this reads (migration 087)
 * cannot project those columns, so this page could not show them if it tried.
 *
 * WHY IT RANKS DRY DAYS RATHER THAN DRINKS. The feature was asked for as a
 * board of drinks logged. Ranking athletes by how much they drink rewards
 * drinking; the same data read the other way round ranks the same people on
 * the thing they would actually want to win at, and is not a problem to
 * explain to App Review.
 *
 * Everybody signed in can READ this. Only athletes who have explicitly
 * consented appear on it, and the filter is in the database rather than here —
 * a page that forgot its WHERE clause would otherwise publish the lot.
 */

interface StreakRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  streak_days: number;
  tracked_days: number;
}

const BOARD_LIMIT = 50;

function medalFor(rank: number): string | null {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
}

export default async function AlcoholFreeLeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const [{ data: rows }, onBoard] = await Promise.all([
    supabase
      .from("public_alcohol_free_streaks")
      .select("user_id, username, display_name, avatar_url, streak_days, tracked_days")
      .order("streak_days", { ascending: false })
      .limit(BOARD_LIMIT),
    hasArticle9Consent(supabase, user.id, LEADERBOARD_CONSENT_KEY),
  ]);

  const board = (rows ?? []) as StreakRow[];
  const myRank = board.findIndex((r) => r.user_id === user.id) + 1;

  return (
    <div className="space-y-6">
      <Link
        href="/recovery"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Recovery
      </Link>

      <PageHeader
        eyebrow="Leaderboard"
        title="Alcohol-free streaks"
        subtitle="Days since each athlete's last logged drink. Opt-in — only athletes who have chosen to appear are listed, and nobody's individual drinks are ever shown."
      />

      {board.length === 0 ? (
        <Card padding="lg">
          <CardContent>
            <p className="text-sm text-muted">
              Nobody has joined the leaderboard yet. If you want to be first, opt in below —
              you can leave again at any time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card padding="lg">
          <CardContent className="space-y-1">
            {board.map((row, i) => {
              const rank = i + 1;
              const isMe = row.user_id === user.id;
              const medal = medalFor(rank);
              return (
                <div
                  key={row.user_id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl px-3 py-3",
                    isMe ? "border border-accent/30 bg-accent/[0.07]" : "hover:bg-white/[0.03]"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-8 shrink-0 text-center text-sm tabular-nums text-muted">
                      {medal ?? rank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {row.display_name || row.username || "Athlete"}
                        {isMe && <span className="ml-2 text-xs text-accent">you</span>}
                      </p>
                      <p className="text-xs text-muted">
                        tracking for {row.tracked_days} {row.tracked_days === 1 ? "day" : "days"}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="index-display text-xl font-bold tabular-nums">
                      {row.streak_days}
                    </span>
                    <span className="ml-1 text-xs text-muted">
                      {row.streak_days === 1 ? "day" : "days"}
                    </span>
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {onBoard && myRank > 0 && (
        <Card padding="lg" glow="accent">
          <CardContent className="flex items-center gap-3">
            <Trophy className="h-5 w-5 shrink-0 text-accent" />
            <p className="text-sm">
              You&apos;re <span className="font-semibold">#{myRank}</span> of {board.length}.
            </p>
          </CardContent>
        </Card>
      )}

      <LeaderboardConsentCard />

      <p className="text-xs leading-relaxed text-muted">
        Streaks are self-reported: they count days since the last drink you logged, so they are
        only as accurate as your own logging and are not verified. Tracking time is shown beside
        each streak so a long streak on a short history reads as what it is.
      </p>
    </div>
  );
}
