import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HybridPlanScreen } from "@/components/hybrid-plan/hybrid-plan-screen";

/**
 * Hybrid Plan Engine — WP9.
 *
 * Separate route from /training-plan on purpose. The existing training-plan
 * wizard answers "balance my goals across this week"; this answers "build me
 * a block that arrives at an event date". They are different products with
 * different inputs, and merging them would make both worse.
 */
export default async function HybridPlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  return <HybridPlanScreen />;
}
