import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { HybridReport } from "@/components/reports/hybrid-report";
import { loadFullHybridReport, REPORT_PERIOD_DAYS } from "@/lib/scoring/hybrid-report-full-data";
import { fetchLatestHybridReport } from "@/lib/scoring/hybrid-report-data";
import { hasShowcaseAccess } from "@/lib/retention/trial";
import { hasArticle9Consent } from "@/lib/consent/article9";

/**
 * The Hybrid Athlete Report.
 *
 * Built live on every visit from everything the app already knows (see
 * hybrid-report-full.ts) rather than read from the stored monthly row, which
 * carried four fields and was reported as "very poor with very little
 * information". The stored row still exists — the cron writes it and the
 * shareable PNG card reads it — so the share button only appears once a
 * stored report exists to share.
 */
export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed, subscription_tier, subscription_status, created_at, weight_kg, gender, timezone, scoring_basis"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium = hasShowcaseAccess(profile);

  /*
   * The injury Risk Index in the report needs Article 9 consent, and the rest
   * of the report does not — the same split analytics/page.tsx makes. Read
   * here and passed down, because this page is a surface the consent covers
   * and the loader is not (see consent-gate.test.ts).
   */
  const [report, stored] = premium
    ? await Promise.all([
        hasArticle9Consent(supabase, user.id).then((consent) =>
          loadFullHybridReport(supabase, user.id, profile, consent)
        ),
        fetchLatestHybridReport(supabase, user.id, "monthly"),
      ])
    : [null, null];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Premium"
        title="Hybrid Athlete Report"
        subtitle={`The last ${REPORT_PERIOD_DAYS} days of your training in one document — scores, balance, consistency, strength, endurance, recovery and how the two sides affect each other. Written to hand to a coach.`}
        help={
          <>
            <p>
              Everything the app knows about your last {REPORT_PERIOD_DAYS} days, on one page:
              where your scores stand and how they moved, how your time split between lifting and
              endurance, how consistent you were, your best lifts and predicted race times, how
              recovered you are, and whether one side of your training is costing the other.
            </p>
            <p>
              It is rebuilt every time you open it, so it is always current. The notes at the top
              are the sentences a coach would say first.
            </p>
          </>
        }
        helpHref="/help#scores"
      />
      <HybridReport report={report} isPremium={premium} hasStoredReport={stored !== null} />
    </div>
  );
}
