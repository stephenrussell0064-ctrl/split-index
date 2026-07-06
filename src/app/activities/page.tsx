import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { formatIndex, formatDuration, formatDistance } from "@/lib/utils/format";
import { SPORTS } from "@/lib/constants/sports";

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

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="micro-label text-muted mb-2">Logbook</p>
            <h1 className="page-title">All activities</h1>
            <p className="mt-2 text-sm text-muted">
              Edit or delete past sessions. Scores compare against your own history.
            </p>
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
            <p className="mt-1 text-sm text-muted">Log your first workout to start building history.</p>
            <Link href="/activities/new" className="mt-4 inline-block text-sm text-accent hover:text-accent/80">
              Log workout →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            {(activities ?? []).map((a) => {
              const meta = SPORTS.find((s) => s.id === a.sport);
              const score = scoreMap[a.id as string];
              return (
                <li key={a.id as string}>
                  <Link
                    href={`/activities/${a.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-white/[0.03] min-h-[72px]"
                  >
                    <span className="text-2xl">{meta?.icon ?? "🏋️"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {(a.title as string) ?? meta?.name ?? String(a.sport)}
                      </p>
                      <p className="text-xs text-muted tabular-nums">
                        {format(new Date(a.started_at as string), "MMM d, yyyy")} ·{" "}
                        {formatDuration(a.duration_seconds as number)}
                        {a.distance_meters
                          ? ` · ${formatDistance(a.distance_meters as number)}`
                          : ""}
                      </p>
                    </div>
                    {score !== undefined && (
                      <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                        {formatIndex(score)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
