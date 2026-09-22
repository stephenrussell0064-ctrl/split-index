import { parseQuery } from "@/lib/validation/boundary";
import { reportPeriodQuerySchema } from "@/lib/validation/schemas/query";
import { verifyCronRequest } from "@/lib/security/cron-auth";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPaidAccess } from "@/lib/retention/trial";
import { generateHybridReport, currentPeriodStart } from "@/lib/scoring/hybrid-report-data";
import { notifyOnce } from "@/lib/retention/notify";
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
    .filter((p) => hasPaidAccess(p))
    .map((p) => p.user_id as string);

  const periodStart = currentPeriodStart(period);

  let generated = 0;
  let notified = 0;
  for (const userId of premiumUserIds) {
    await generateHybridReport(admin, userId, period);
    generated += 1;

    /*
      A report nobody is told about is a report nobody reads. This is the
      whole reason the report is worth generating on a schedule rather than
      on demand, and until now the only way to discover a new one was to
      navigate to it and notice the date had changed.

      Deduplicated against `periodStart` rather than a time window, because
      the schedule deliberately re-runs against the same period — the route's
      own header explains that a run which isn't the start of a quarter
      re-upserts the same quarterly period as a no-op. That no-op must stay a
      no-op here too, or a monthly cron would announce the same quarterly
      report every month.
    */
    const announced = await notifyOnce(admin, userId, {
      type: `hybrid_report_ready:${period}:${periodStart}`,
      title: `Your ${period} report is ready`,
      body: "See how your strength and endurance moved, and what changed between them.",
      metadata: { period, periodStart },
    });
    if (announced.inserted) notified += 1;
  }

  return NextResponse.json({
    ok: true,
    period,
    periodStart,
    generated,
    notified,
  });
}
