import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchDuels } from "@/lib/social/queries";
import type { DuelMetric } from "@/lib/social/types";
import type { SportType } from "@/types";

const DUEL_METRICS: DuelMetric[] = ["sessions", "load"];
const SPORT_TYPES: SportType[] = [
  "running",
  "walking",
  "swimming",
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "outdoor_cycling",
  "ski_erg",
  "gym",
];
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 30;
const DEFAULT_DURATION_DAYS = 7;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const duels = await fetchDuels(supabase, user.id);
  return NextResponse.json({ duels });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const opponentId = String(body.friendId ?? "");
  const metric: DuelMetric = DUEL_METRICS.includes(body.metric) ? body.metric : "sessions";
  const sport: SportType | null = SPORT_TYPES.includes(body.sport) ? body.sport : null;
  const days = Number.isFinite(body.days)
    ? Math.min(MAX_DURATION_DAYS, Math.max(MIN_DURATION_DAYS, Math.round(body.days)))
    : DEFAULT_DURATION_DAYS;

  if (!opponentId) {
    return NextResponse.json({ error: "friendId required" }, { status: 400 });
  }
  if (opponentId === user.id) {
    return NextResponse.json({ error: "Cannot challenge yourself" }, { status: 400 });
  }

  const { data: friendship } = await supabase
    .from("friends")
    .select("id, status")
    .or(
      `and(user_id.eq.${user.id},friend_id.eq.${opponentId}),and(user_id.eq.${opponentId},friend_id.eq.${user.id})`
    )
    .maybeSingle();

  if (!friendship || friendship.status !== "accepted") {
    return NextResponse.json({ error: "You can only duel an accepted friend" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("duels")
    .select("id")
    .or(
      `and(challenger_id.eq.${user.id},opponent_id.eq.${opponentId}),and(challenger_id.eq.${opponentId},opponent_id.eq.${user.id})`
    )
    .in("status", ["pending", "accepted"])
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already have a pending or active duel with this friend" }, { status: 409 });
  }

  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const { data: duel, error } = await supabase
    .from("duels")
    .insert({
      challenger_id: user.id,
      opponent_id: opponentId,
      metric,
      sport,
      start_date: startDate,
      end_date: endDate,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ duel });
}
