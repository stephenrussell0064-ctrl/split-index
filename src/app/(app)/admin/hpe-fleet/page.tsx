import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAdminRole } from "@/lib/auth/admin-role";
import { PageHeader } from "@/components/ui/page-header";
import { FleetDashboard } from "@/components/hybrid-plan/fleet-dashboard";

/**
 * Fleet operations view for the Hybrid Plan Engine.
 *
 * Gated twice on purpose: here, so a non-admin gets a 404 and never learns the
 * page exists, and again in the API route, so the gate does not depend on
 * anyone remembering to render this wrapper.
 */
export default async function HpeFleetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const identity = await resolveAdminRole(user.id);
  if (!identity) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Hybrid Plan fleet"
        subtitle="The view the kill-switch decision is made from. Aggregate across all users; no individual athlete is identifiable here."
      />
      <FleetDashboard />
    </div>
  );
}
