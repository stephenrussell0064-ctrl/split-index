import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodStart } from "@/lib/social/constants";
import type { LeaderboardPeriod } from "@/types";

const PERIODS: LeaderboardPeriod[] = ["weekly", "monthly", "all_time"];

interface ProfileRow {
  user_id: string;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
  username: string | null;
}

function verifyCronSecret(request: Request): boolean {
  const { searchParams } = new URL(request.url);
  const secret =
    searchParams.get("secret") ??
    request.headers.get("authorization")?.replace("Bearer ", "");
  return secret === process.env.CRON_SECRET && !!process.env.CRON_SECRET;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: profiles, error } = await admin
    .from("profiles")
    .select(
      "user_id, username, current_split_index, current_endurance_index, current_strength_index"
    )
    .not("current_split_index", "is", null)
    .not("username", "is", null)
    .order("current_split_index", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    upserted += rows.length;
  }

  return NextResponse.json({
    ok: true,
    profiles: eligible.length,
    entriesUpserted: upserted,
    computedAt: new Date().toISOString(),
  });
}
