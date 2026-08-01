import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { HybridReportView } from "@/components/analytics/hybrid-report-view";
import { fetchLatestHybridReport } from "@/lib/scoring/hybrid-report-data";
import { isPremiumUser, hasSoftTrialAccess } from "@/lib/retention/trial";

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, subscription_tier, subscription_status, created_at")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium =
    isPremiumUser(profile.subscription_tier, profile.subscription_status) ||
    hasSoftTrialAccess(profile.created_at, profile.subscription_tier, profile.subscription_status);

  const report = premium ? await fetchLatestHybridReport(supabase, user.id, "monthly") : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Premium"
        title="Hybrid Athlete Report"
        subtitle="A periodic synthesis of your score trend, cross-training interference, readiness, and race predictions — good enough to hand to a coach."
      />
      <HybridReportView report={report} isPremium={premium} />
    </div>
  );
}
