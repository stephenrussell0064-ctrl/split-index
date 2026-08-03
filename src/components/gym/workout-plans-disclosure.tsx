"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { WORKOUT_PLANS } from "@/lib/constants/workout-plans";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/**
 * Collapsed by default — someone with their own routine shouldn't have a
 * full grid of prescribed plans dominating the page before they've even
 * looked at their own numbers. Still fully browsable for anyone who does
 * want a programmed plan, just one tap away instead of always-on.
 */
export function WorkoutPlansDisclosure() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-2xl glass-gym border border-gym-border/40 px-5 py-4 text-left transition-colors hover:border-gym-accent/40"
      >
        <span className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-gym-accent" />
          <span className="micro-label text-gym-muted">Browse workout plans</span>
          <span className="text-xs text-gym-muted">({WORKOUT_PLANS.length})</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-gym-muted transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {WORKOUT_PLANS.map((plan) => (
            <Link
              key={plan.id}
              href={`/gym/log?plan=${plan.id}`}
              className="group glass-gym rounded-2xl border border-gym-border/40 p-5 transition-all duration-200 hover:border-gym-accent/50 hover:shadow-[0_0_32px_-10px_var(--gym-glow)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full bg-gym-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gym-accent">
                  {LEVEL_LABELS[plan.level]}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-gym-muted">
                  ~{plan.durationMinutes} min
                </span>
              </div>
              <p className="font-semibold text-gym-text group-hover:text-gym-accent transition-colors">
                {plan.name}
              </p>
              <p className="mt-1 text-xs text-gym-muted">{plan.focus}</p>
              <p className="mt-3 text-xs text-gym-muted">{plan.exercises.length} exercises</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
