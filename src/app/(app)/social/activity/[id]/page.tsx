import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchSharedActivity } from "@/lib/social/shared-activity";
import { formatIndex } from "@/lib/utils/format";

/**
 * A friend's session, in full.
 *
 * The feed could only ever show a headline — a title and a score — because the
 * feed query never read the lifts. This is where they are, and the only page in
 * the app that renders one athlete's training for another.
 *
 * `notFound()` answers BOTH "no such activity" and "not yours to see". Telling
 * the difference would confirm that a given id exists and belongs to somebody
 * who has not shared it, which is a small leak but a real one.
 */
export default async function SharedActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { activity } = await fetchSharedActivity(supabase, user.id, id);
  if (!activity) notFound();

  const who = activity.author.displayName ?? activity.author.username ?? "This athlete";
  const mins = Math.round(activity.durationSeconds / 60);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-[max(1rem,env(safe-area-inset-top))]">
      <Link
        href="/social"
        className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Feed
      </Link>

      <header className="mt-2">
        <p className="text-xs text-muted">
          {activity.isOwn ? "Your session" : `${who}'s session`}
        </p>
        <h1 className="font-display text-2xl font-bold">
          {activity.title ?? activity.sport}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {new Date(activity.startedAt).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {mins > 0 && ` · ${mins} min`}
          {activity.sportIndex != null && ` · ${formatIndex(activity.sportIndex)}`}
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-[10px] uppercase tracking-wider text-muted">
          {activity.exercises.length > 0
            ? `${activity.exercises.length} ${activity.exercises.length === 1 ? "exercise" : "exercises"}`
            : "Exercises"}
        </h2>

        {activity.exercises.length === 0 ? (
          /* Distinguishable from a session whose lifts are hidden: this page
             only renders at all once the viewer is allowed to see it, so an
             empty list means the session genuinely had no scored lifts — a run,
             or a gym session logged without weights. */
          <p className="mt-2 text-sm text-muted">
            No scored lifts in this session.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {activity.exercises.map((ex, i) => (
              <li
                key={`${ex.exerciseName}-${i}`}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-gym-border/20 bg-gym-bg/40 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{ex.exerciseName}</p>
                  {ex.muscleGroup && (
                    <p className="text-xs text-muted">{ex.muscleGroup}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {ex.strengthIndex != null && (
                    <p className="font-display font-bold tabular-nums text-gym-accent">
                      {formatIndex(ex.strengthIndex)}
                    </p>
                  )}
                  {ex.estimated1rmKg != null && (
                    <p className="text-xs tabular-nums text-muted">
                      {Math.round(ex.estimated1rmKg)} kg 1RM
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
