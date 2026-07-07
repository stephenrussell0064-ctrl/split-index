import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { LogbookView } from "@/components/activities/logbook-view";

export default async function ActivitiesPage() {
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

  const { data: activities } = await supabase
    .from("activities")
    .select("id, sport, title, started_at, duration_seconds, distance_meters")
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(50);

  const ids = (activities ?? []).map((a) => a.id);
  const { data: scores } = ids.length
    ? await supabase
        .from("workout_scores")
        .select("activity_id, sport_index")
        .in("activity_id", ids)
    : { data: [] };

  const scoreMap = Object.fromEntries(
    (scores ?? []).map((s) => [s.activity_id, s.sport_index as number])
  );

  const gymActivities = (activities ?? []).filter((a) => a.sport === "gym");
  const cardioActivities = (activities ?? []).filter((a) => a.sport !== "gym");

  const gymRows = gymActivities.map((a) => ({
    id: a.id as string,
    sport: a.sport as string,
    title: a.title as string | null,
    started_at: a.started_at as string,
    duration_seconds: a.duration_seconds as number | null,
    distance_meters: a.distance_meters as number | null,
  }));

  const cardioRows = cardioActivities.map((a) => ({
    id: a.id as string,
    sport: a.sport as string,
    title: a.title as string | null,
    started_at: a.started_at as string,
    duration_seconds: a.duration_seconds as number | null,
    distance_meters: a.distance_meters as number | null,
  }));

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="micro-label text-muted mb-2">Logbook</p>
            <h1 className="page-title">Activities</h1>
          </div>
          <Link href="/activities/new">
            <Button size="sm">
              <PlusCircle className="h-4 w-4" />
              Log new
            </Button>
          </Link>
        </div>

        {(activities ?? []).length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] py-16 text-center">
            <p className="font-medium">No activities yet</p>
            <Link href="/activities/new" className="mt-4 inline-block text-sm text-accent">
              Log workout →
            </Link>
          </div>
        ) : (
          <LogbookView gymRows={gymRows} cardioRows={cardioRows} scoreMap={scoreMap} />
        )}
      </div>
    </AppShell>
  );
}
