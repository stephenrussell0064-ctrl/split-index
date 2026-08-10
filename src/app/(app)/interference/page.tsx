import Link from "next/link";
import { redirect } from "next/navigation";
import { Target, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { InterferenceDetail } from "@/components/analytics/interference-detail";
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
      {/* Training Plan moved to its own page (user feedback: "Training plan
          in interference tab. I want its own tab for training plan as this
          is a huge thing") — a teaser here keeps the natural connection
          (one explains how training interacts, the other says what to
          actually do about it) without re-embedding the whole feature. */}
      <Link href="/training-plan">
        <Card interactive className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <Target className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold">Training Plan</p>
              <p className="text-xs text-muted">
                Set goals across any sport or lift — get a weekly plan that prioritizes what
                you&apos;re furthest from.
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
        </Card>
      </Link>
    </div>
  );
}
