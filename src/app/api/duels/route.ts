import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { fetchDuels } from "@/lib/social/queries";
import type { DuelMetric } from "@/lib/social/types";
import { parseBody } from "@/lib/validation/boundary";
import {
  DEFAULT_DURATION_DAYS,
  createDuelSchema,
} from "@/lib/validation/schemas/social";
import type { SportType } from "@/types";


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

  /*
    N1. This clamped and defaulted: an out-of-range `days` became 30, an
    unrecognised `metric` became "sessions", an unknown `sport` became null. A
    malformed request produced a working duel that was not the one asked for,
    so a client bug looked like a feature until somebody noticed the length was
    wrong. The schema refuses and says which field.

    The DEFAULTS survive, because they are a different thing from clamping: an
    ABSENT metric or duration still means "the usual one". Only a PRESENT but
    invalid value is now refused.
  */
  const parsed = await parseBody(request, createDuelSchema);
  if (parsed.response) return parsed.response;

  const opponentId = parsed.data.friendId;
  const metric = (parsed.data.metric ?? "sessions") as DuelMetric;
  const sport = (parsed.data.sport ?? null) as SportType | null;
  const days = parsed.data.days ?? DEFAULT_DURATION_DAYS;
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
    return databaseError(error, { operation: "POST /api/duels" });
  }

  return NextResponse.json({ duel });
}
