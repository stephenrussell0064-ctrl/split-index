import { parseQuery } from "@/lib/validation/boundary";
import { reportPeriodQuerySchema } from "@/lib/validation/schemas/query";
import { verifyCronRequest } from "@/lib/security/cron-auth";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPremiumUser } from "@/lib/retention/trial";
import { generateHybridReport, currentPeriodStart } from "@/lib/scoring/hybrid-report-data";
import type { ReportPeriod } from "@/lib/scoring/hybrid-report";


/**
 * Generates the Hybrid Athlete Report (Part 5) for every premium user, on
 * schedule (monthly on the 1st, quarterly handled the same way — a run that
 * isn't the start of a quarter just re-upserts the same quarterly period,
 * which is a no-op given the (user_id, period, period_start) unique key).
 */
export async function GET(request: Request) {
  if (!verifyCronRequest(request, "/api/cron/hybrid-reports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient("/api/cron/hybrid-reports");

  /*
    `period` is a plain switch, not a credential — it selects which report to
    build and is safe in the URL. It is read here rather than in the auth
    helper, which now takes only the Request and cares only about the header.
  */
  // N1. Same two values, same default, now declared rather than implied.
  const q = parseQuery(request, reportPeriodQuerySchema);
  if (q.response) return q.response;
  const period = q.data.period as ReportPeriod;

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, subscription_tier, subscription_status");

  if (error) {
    return databaseError(error, { operation: "GET /api/cron/hybrid-reports" });
  }

  const premiumUserIds = (profiles ?? [])
    .filter((p) => isPremiumUser(p.subscription_tier, p.subscription_status))
    .map((p) => p.user_id as string);

  let generated = 0;
  for (const userId of premiumUserIds) {
    await generateHybridReport(admin, userId, period);
    generated += 1;
  }

  return NextResponse.json({
    ok: true,
    period,
    periodStart: currentPeriodStart(period),
    generated,
  });
}
