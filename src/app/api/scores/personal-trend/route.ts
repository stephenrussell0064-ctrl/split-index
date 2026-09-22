import { NextResponse } from "next/server";
import { z } from "@/lib/validation/boundary";
import { parseQuery } from "@/lib/validation/boundary";
import { createClient } from "@/lib/supabase/server";
import { fetchPersonalTrend, PERSONAL_TREND_MAX_POINTS } from "@/lib/scoring/personal-trend";

/**
 * The athlete's own recent personal scores, for the sheet behind the "vs you"
 * number. Their own row only — RLS enforces that, and the query is scoped to
 * `user.id` as well rather than trusting it alone.
 */
const querySchema = z.object({
  // A free-text sport rather than the sport enum: the column is written from
  // the same string the logger sends, and a sport this athlete has never
  // logged simply returns no points. Bounded so it cannot be used to probe.
  sport: z.string().min(1).max(40),
  limit: z.coerce
    .number()
    .int()
    .min(2)
    .max(PERSONAL_TREND_MAX_POINTS)
    .catch(PERSONAL_TREND_MAX_POINTS),
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

  const { points, error } = await fetchPersonalTrend(supabase, user.id, q.data.sport, q.data.limit);

  // A trend that could not be read is not a flat trend. 503 so the sheet can
  // stay silent about the chart rather than drawing an empty one, which would
  // tell the athlete they have no history when the truth is nothing answered.
  if (error) {
    console.error("[scores/personal-trend] query failed for user", user.id, error);
    return NextResponse.json({ error }, { status: 503 });
  }

  return NextResponse.json({ points });
}
