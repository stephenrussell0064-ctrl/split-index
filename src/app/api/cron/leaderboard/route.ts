import { verifyCronRequest } from "@/lib/security/cron-auth";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodStart } from "@/lib/social/constants";
import { notifyOnce } from "@/lib/retention/notify";
import type { LeaderboardPeriod } from "@/types";

const PERIODS: LeaderboardPeriod[] = ["weekly", "monthly", "all_time"];

/** The rank worth being told you reached. */
const TOP_TEN = 10;
/**
 * Below this many ranked athletes, "top ten" is most of the board and means
 * nothing. 25 is a judgement, not a measurement: it is the smallest board on
 * which being tenth still excludes most people.
 */
const TOP_TEN_MIN_BOARD = 25;

interface ProfileRow {
  user_id: string;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
  username: string | null;
}


export async function GET(request: Request) {
  if (!verifyCronRequest(request, "/api/cron/leaderboard")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient("/api/cron/leaderboard");

  const { data: profiles, error } = await admin
    .from("profiles")
    .select(
      "user_id, username, current_split_index, current_endurance_index, current_strength_index"
    )
    .not("current_split_index", "is", null)
    .not("username", "is", null)
    .order("current_split_index", { ascending: false });

  if (error) {
    return databaseError(error, { operation: "GET /api/cron/leaderboard" });
  }

  const eligible = (profiles ?? []).filter(
    (p) => p.current_split_index != null
  ) as ProfileRow[];

  const previousRanks = new Map<LeaderboardPeriod, Map<string, number>>();

  for (const period of PERIODS) {
    const periodStart = getPeriodStart(period);
    const { data: existing } = await admin
      .from("leaderboard_entries")
      .select("user_id, rank")
      .eq("period", period)
      .eq("period_start", periodStart);

    const map = new Map<string, number>();
    for (const row of existing ?? []) {
      map.set(row.user_id, row.rank);
    }
    previousRanks.set(period, map);
  }

  let upserted = 0;
  let notified = 0;

  for (const period of PERIODS) {
    const periodStart = getPeriodStart(period);
    const prevMap = previousRanks.get(period) ?? new Map();

    const sorted = [...eligible].sort(
      (a, b) => (b.current_split_index ?? 0) - (a.current_split_index ?? 0)
    );

    const rows = sorted.map((p, i) => ({
      user_id: p.user_id,
      period,
      period_start: periodStart,
      split_index: p.current_split_index!,
      endurance_index: p.current_endurance_index,
      strength_index: p.current_strength_index,
      rank: i + 1,
      previous_rank: prevMap.get(p.user_id) ?? null,
      computed_at: new Date().toISOString(),
    }));

    if (rows.length === 0) continue;

    const { error: upsertError } = await admin
      .from("leaderboard_entries")
      .upsert(rows, { onConflict: "period,period_start,user_id" });

    if (upsertError) {
      return databaseError(upsertError, { operation: "GET /api/cron/leaderboard" });
    }

    upserted += rows.length;

    /*
      Climbing into the top ten is the one leaderboard event worth telling
      someone about unprompted, and this loop already knows it happened —
      `previous_rank` is computed three lines up and was, until now, written
      to a row nobody is looking at when it changes.

      Four deliberate narrowings, because the failure mode of a leaderboard
      notification is being annoying:

      - Weekly only. Monthly and all-time move for reasons that have nothing
        to do with what the athlete did this week, and all_time barely moves
        at all once a board matures.
      - Upward only. "You have been overtaken" is a real event and a bad
        message; nobody opens an app to be told they are losing.
      - Crossings only, not positions. Someone sitting at rank 4 all week has
        nothing new to hear on Tuesday.
      - Not on a small board, where the top ten is most of the board and the
        rank says nothing. TOP_TEN_MIN_BOARD is the floor for the boundary to
        mean anything at all.
    */
    if (period === "weekly" && eligible.length >= TOP_TEN_MIN_BOARD) {
      for (const row of rows) {
        const previous = row.previous_rank;
        // A null previous rank is a first appearance, not a climb. Telling a
        // brand-new entrant they "moved into" the top ten would be the
        // leaderboard's version of the hardcoded race prediction: plausible,
        // congratulatory and false.
        if (previous == null || previous <= TOP_TEN || row.rank > TOP_TEN) continue;

        notified += (
          await notifyOnce(admin, row.user_id, {
            type: `leaderboard_top_ten:${periodStart}`,
            title: `You are #${row.rank} this week`,
            body: `Up from #${previous}. You are in the top ${TOP_TEN} on the weekly board.`,
            metadata: { period, periodStart, rank: row.rank, previousRank: previous },
          })
        ).inserted
          ? 1
          : 0;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    profiles: eligible.length,
    entriesUpserted: upserted,
    notified,
    computedAt: new Date().toISOString(),
  });
}
