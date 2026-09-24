import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, ArrowRight } from "lucide-react";
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
        help={
          <>
            <p>
              Interference is what happens when one kind of training gets in the way of the
              other — a heavy leg day that leaves your run two days later slower than it should
              be, or a long run that takes the edge off your squat.
            </p>
            <p>
              This page looks at pairs of your own sessions that were close together and shows
              you where that is happening, and where the two are actually helping each other.
              It needs a few weeks of both kinds of training before it has enough to say.
            </p>
          </>
        }
        helpHref="/help#interference"
      />
      <InterferenceDetail report={report} />
      {/* A teaser for the planning surface keeps the natural connection here
          (one page explains how training interacts, the other says what to
          actually do about it) without re-embedding the whole feature.
          Repointed from the retired /training-plan wizard to the Hybrid Plan
          Engine — the link is the reason this needed touching at all, since a
          deleted route behind a live card is a 404 in production. */}
      <Link href="/hybrid-plan">
        <Card interactive className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <CalendarRange className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold">Hybrid Plan</p>
              <p className="text-xs text-muted">
                Build a training block back from your event date — balanced across running and
                lifting from your own diagnostic.
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
        </Card>
      </Link>
    </div>
  );
}
