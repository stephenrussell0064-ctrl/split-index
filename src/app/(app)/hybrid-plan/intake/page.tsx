import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { IntakeWizard } from "@/components/hybrid-plan/intake-wizard";

/** Hybrid Plan Engine — WP2. Safety and goal are mandatory and short; everything after is skippable with its cost stated. */
export default async function HybridPlanIntakePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Hybrid plan"
        title="About you"
        subtitle="Most of this is already filled in from what you have logged. The parts that are not are the ones no data can answer."
      />
      <IntakeWizard />
    </div>
  );
}
