import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { InterferenceDetail } from "@/components/analytics/interference-detail";
import { TrainingPlanCard } from "@/components/analytics/training-plan-card";
import { fetchInterferenceReport } from "@/lib/scoring/interference-data";

export default async function InterferencePage() {
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

  const report = await fetchInterferenceReport(supabase, user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cross-Training Intelligence"
        title="Interference Radar"
        subtitle="Is your lifting hurting your running? Is your running hurting your squat? Mined from your own paired history — not a population average dressed up as personal advice."
      />
      <InterferenceDetail report={report} />
      {/* User feedback: "I now want alongside the interference page of, is
          my cardio affecting my strength and vice versa, i want a
          recommendation of what to train... generated plans for users to
          build the most effective route to their goal." Natural neighbor
          to the interference findings above: one explains how training
          interacts, this says what to actually do about it. */}
      <TrainingPlanCard />
    </div>
  );
}
