import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAdminRole } from "@/lib/auth/admin-role";
import { PageHeader } from "@/components/ui/page-header";
import { LoggingEffortDashboard } from "@/components/admin/logging-effort-dashboard";

/**
 * The logging-effort plan's measurement, read from migration 090's views.
 *
 * Gated twice like the Hybrid Plan fleet page: here, so a non-admin gets a
 * 404 and never learns the page exists, and again in the API route.
 */
export default async function LoggingEffortPage() {
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
        title="Logging effort"
        subtitle="Whether each phase of the logging-effort plan lowered the work of logging, and whether more athletes log more often. Aggregate across all users; no individual athlete is identifiable here."
      />
      <LoggingEffortDashboard />
    </div>
  );
}
