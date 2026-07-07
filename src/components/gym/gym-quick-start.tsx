"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, ChevronRight, Dumbbell, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WORKOUT_PLANS } from "@/lib/constants/workout-plans";
import type { WorkoutFormState } from "@/components/activities/form-state";

interface TemplateRow {
  id: string;
  name: string;
  template_data: WorkoutFormState;
}

interface RecentSession {
  id: string;
  title: string;
  startedAt: string;
  sportIndex?: number;
}

export function GymQuickStart({
  recentSessions,
}: {
  recentSessions: RecentSession[];
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/session-templates?sport=gym");
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates ?? []);
        }
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, []);

  const featuredPlans = WORKOUT_PLANS.slice(0, 6);

  return (
    <div className="space-y-8">
      {/* Preset plans — hero row */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="micro-label text-gym-muted">Preset plans</p>
          <Link
            href="/gym/log"
            className="text-xs text-gym-accent hover:text-gym-accent/80 flex items-center gap-1"
          >
            All plans <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
          {featuredPlans.map((plan) => (
            <Link
              key={plan.id}
              href={`/gym/log?plan=${plan.id}`}
              className="snap-start shrink-0 w-[200px] glass-gym rounded-2xl border border-gym-border/40 p-4 transition-all hover:border-gym-accent/50 hover:shadow-[0_0_24px_-8px_var(--gym-glow)]"
            >
              <Dumbbell className="h-4 w-4 text-gym-accent mb-3" />
              <p className="font-semibold text-gym-text text-sm">{plan.name}</p>
              <p className="text-[10px] text-gym-muted mt-1">{plan.focus}</p>
              <p className="text-[10px] text-gym-accent mt-2">
                {plan.exercises.length} exercises · ~{plan.durationMinutes}m
              </p>
            </Link>
          ))}
        </div>
      </div>

      {/* Previous workouts */}
      {recentSessions.length > 0 && (
        <div className="glass-gym rounded-2xl border border-gym-border/40 p-5">
          <div className="mb-4 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-gym-accent" />
            <p className="micro-label text-gym-muted">Repeat a session</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recentSessions.slice(0, 4).map((session) => (
              <Link
                key={session.id}
                href={`/gym/log?repeat=${session.id}`}
                className="flex items-center justify-between rounded-xl border border-gym-border/30 bg-gym-bg/50 px-4 py-3 transition-colors hover:border-gym-accent/40 hover:bg-gym-accent/5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gym-text truncate">
                    {session.title}
                  </p>
                  <p className="text-[10px] text-gym-muted">{session.startedAt}</p>
                </div>
                {session.sportIndex !== undefined && (
                  <span className="font-mono text-sm font-bold text-gym-accent tabular-nums">
                    {session.sportIndex}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Saved templates */}
      {!loadingTemplates && templates.length > 0 && (
        <div className="glass-gym rounded-2xl border border-gym-border/40 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-gym-accent" />
            <p className="micro-label text-gym-muted">Your saved templates</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/gym/log?template=${t.id}`}
                className="rounded-xl border border-gym-border/40 px-4 py-2.5 text-sm text-gym-text transition-colors hover:border-gym-accent/50 hover:bg-gym-accent/5"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link href="/gym/log">
        <Button className="w-full bg-gym-accent hover:bg-gym-accent/90 text-[#04120a] border-0 font-semibold h-12">
          <Dumbbell className="h-4 w-4" />
          Start blank session
        </Button>
      </Link>
    </div>
  );
}
