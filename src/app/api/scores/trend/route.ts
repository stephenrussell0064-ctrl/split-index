import { NextResponse } from "next/server";
import { z, parseQuery } from "@/lib/validation/boundary";
import { createClient } from "@/lib/supabase/server";
import {
  fetchCardioScoreTrend,
  fetchStrengthScoreTrend,
  SCORE_TREND_MAX_POINTS,
} from "@/lib/scoring/score-trend";

/**
 * The series behind a tap-to-explain sheet: this athlete's own recent scores
 * for one sport or one lift.
 *
 * Their own row only. RLS enforces that, and the query is scoped to `user.id`
 * as well rather than trusting RLS alone — two independent reasons the answer
 * cannot be somebody else's training history.
 */
const querySchema = z.object({
  kind: z.enum(["cardio", "strength"]),
  /** A sport for cardio, an exercise name for strength. */
  key: z.string().min(1).max(80),
  /** Which of the session's two numbers to plot. */
  metric: z.enum(["personal", "population"]).catch("personal"),
  limit: z.coerce.number().int().min(2).max(SCORE_TREND_MAX_POINTS).catch(SCORE_TREND_MAX_POINTS),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = parseQuery(request, querySchema);
  if (q.response) return q.response;
  const { kind, key, metric, limit } = q.data;

  const { points, error } =
    kind === "cardio"
      ? await fetchCardioScoreTrend(supabase, user.id, key, metric, limit)
      : await fetchStrengthScoreTrend(supabase, user.id, key, metric, limit);

  // A trend that could not be read is not a flat trend. 503 so the sheet stays
  // silent about the chart rather than drawing an empty one, which would tell
  // the athlete they have no history when the truth is nothing answered.
  if (error) {
    console.error("[scores/trend] query failed for user", user.id, kind, metric, error);
    return NextResponse.json({ error }, { status: 503 });
  }

  return NextResponse.json({ points });
}
