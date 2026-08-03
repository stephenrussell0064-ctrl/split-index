"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Bookmark, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SportType } from "@/types";
import type { WorkoutFormState } from "./form-state";

interface TemplateRow {
  id: string;
  name: string;
  sport: SportType;
  template_data: WorkoutFormState;
}

interface PastWorkoutRow {
  activityId: string;
  startedAt: string;
  title: string | null;
  exerciseNames: string[];
  formState: WorkoutFormState;
}

export function LogQuickActions({
  sport,
  onApplyState,
  onSaveTemplate,
  savingTemplate = false,
}: {
  sport: SportType | null;
  onApplyState: (state: WorkoutFormState) => void;
  onSaveTemplate?: (name: string) => void;
  savingTemplate?: boolean;
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [pastWorkouts, setPastWorkouts] = useState<PastWorkoutRow[]>([]);
  const [loadingPastWorkouts, setLoadingPastWorkouts] = useState(false);
  const [pastWorkoutsOpen, setPastWorkoutsOpen] = useState(false);

  const loadTemplates = async () => {
    if (!sport || templatesLoaded) return;
    const res = await fetch(`/api/session-templates?sport=${sport}`);
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
    setTemplatesLoaded(true);
  };

  const loadPastWorkouts = async () => {
    if (!sport) return;
    if (pastWorkoutsOpen) {
      setPastWorkoutsOpen(false);
      return;
    }
    setPastWorkoutsOpen(true);
    if (pastWorkouts.length > 0) return;
    setLoadingPastWorkouts(true);
    try {
      const res = await fetch(`/api/activities/recent?sport=${sport}`);
      if (res.ok) {
        const data = await res.json();
        setPastWorkouts(data.workouts ?? []);
      }
    } finally {
      setLoadingPastWorkouts(false);
    }
  };

  if (!sport) return null;

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {sport === "gym" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={loadingPastWorkouts}
            onClick={() => void loadPastWorkouts()}
          >
            <History className="h-3.5 w-3.5" />
            Start from a past workout
          </Button>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void loadTemplates()}
        >
          Templates{templates.length > 0 ? ` (${templates.length})` : ""}
        </Button>

        {templates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center w-full sm:w-auto">
            {templates.slice(0, 4).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onApplyState(t.template_data)}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:border-accent/30 transition-colors min-h-[36px]"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {onSaveTemplate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={savingTemplate}
            onClick={() => {
              const name = window.prompt("Template name");
              if (name?.trim()) onSaveTemplate(name.trim());
            }}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Save as template
          </Button>
        )}
      </div>

      {sport === "gym" && pastWorkoutsOpen && (
        <div className="mt-3 space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-2">
          {loadingPastWorkouts ? (
            <p className="px-2 py-3 text-xs text-muted">Loading your recent workouts…</p>
          ) : pastWorkouts.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted">No past gym workouts logged yet.</p>
          ) : (
            pastWorkouts.map((w) => (
              <button
                key={w.activityId}
                type="button"
                onClick={() => {
                  onApplyState(w.formState);
                  setPastWorkoutsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground/90">
                    {w.exerciseNames.length > 0 ? w.exerciseNames.slice(0, 3).join(", ") : w.title || "Gym session"}
                  </p>
                  <p className="text-xs text-muted">{format(new Date(w.startedAt), "EEE, MMM d")}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
