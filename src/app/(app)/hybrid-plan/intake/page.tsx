import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { IntakeWizard } from "@/components/hybrid-plan/intake-wizard";
import { allows, getEntitlements } from "@/lib/premium/entitlements";

/** Hybrid Plan Engine — WP2. Safety and goal are mandatory and short; everything after is skippable with its cost stated. */
export default async function HybridPlanIntakePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /*
   * The subscription gate, enforced here as well as on the plan endpoint.
   *
   * Not only because a UI that collects answers nothing will read is a dead
   * end. This form is a PAR-Q: injuries, pregnancy, low energy availability,
   * chest pain. Asking a free athlete for special category health data to
   * build a plan we will then decline to build fails data minimisation — the
   * lawful basis for processing it is the plan, and there is no plan.
   *
   * They are sent to /hybrid-plan rather than shown a locked form, because
   * that screen states the position and carries the upgrade route, and an
   * athlete who already has a stored block sees it there unchanged.
   */
  if (!allows(await getEntitlements(supabase, user.id), "hybrid_plan")) {
    redirect("/hybrid-plan");
  }

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
