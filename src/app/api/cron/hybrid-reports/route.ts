import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPremiumUser } from "@/lib/retention/trial";
import { generateHybridReport, currentPeriodStart } from "@/lib/scoring/hybrid-report-data";
import type { ReportPeriod } from "@/lib/scoring/hybrid-report";

function verifyCronSecret(request: Request): boolean {
  const { searchParams } = new URL(request.url);
  const secret =
    searchParams.get("secret") ??
    request.headers.get("authorization")?.replace("Bearer ", "");
  return secret === process.env.CRON_SECRET && !!process.env.CRON_SECRET;
}

/**
 * Generates the Hybrid Athlete Report (Part 5) for every premium user, on
 * schedule (monthly on the 1st, quarterly handled the same way — a run that
 * isn't the start of a quarter just re-upserts the same quarterly period,
 * which is a no-op given the (user_id, period, period_start) unique key).
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const period: ReportPeriod = searchParams.get("period") === "quarterly" ? "quarterly" : "monthly";

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, subscription_tier, subscription_status");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
