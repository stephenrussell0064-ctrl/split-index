import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { MonitoringDashboard } from "@/components/hybrid-plan/monitoring-dashboard";

/** Hybrid Plan Engine — WP10 monitoring. Scoped to the athlete's own account; see the route's own note on why a fleet-wide view is not shipped here. */
export default async function HybridPlanMonitoringPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Hybrid plan"
        title="Plan health"
        subtitle="Adherence, refusals, injuries and drift — the numbers that say whether the plans are working."
      />
      <MonitoringDashboard />
    </div>
  );
}
