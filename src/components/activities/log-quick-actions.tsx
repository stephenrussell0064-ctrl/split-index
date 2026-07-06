"use client";

import { useState } from "react";
import { Bookmark, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SportType } from "@/types";
import type { WorkoutFormState } from "./form-state";

interface TemplateRow {
  id: string;
  name: string;
  sport: SportType;
  template_data: WorkoutFormState;
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
  const [loadingLast, setLoadingLast] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  const loadTemplates = async () => {
    if (!sport || templatesLoaded) return;
    const res = await fetch(`/api/session-templates?sport=${sport}`);
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
    setTemplatesLoaded(true);
  };

  const repeatLast = async () => {
    if (!sport) return;
    setLoadingLast(true);
    try {
      const res = await fetch(`/api/activities/last?sport=${sport}`);
      const data = await res.json();
      if (data.found && data.formState) {
        onApplyState(data.formState as WorkoutFormState);
      }
    } finally {
      setLoadingLast(false);
    }
  };

  if (!sport) return null;

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={loadingLast}
        onClick={() => void repeatLast()}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Repeat last
      </Button>

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
  );
}
