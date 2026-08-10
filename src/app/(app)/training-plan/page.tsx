import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TrainingPlanWizard } from "@/components/training-plan/training-plan-wizard";

/**
 * User feedback: "Training plan in interference tab. I want its own tab
 * for training plan as this is a huge thing." Own top-level page + nav
 * entry now (see secondaryNav in app-shell.tsx), same pattern Interference
 * itself was given rather than being buried as a sub-tab.
 */
export default async function TrainingPlanPage() {
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

  return <TrainingPlanWizard />;
}
