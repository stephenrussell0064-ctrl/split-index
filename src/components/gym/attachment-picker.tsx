"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { AttachmentIcon } from "./attachment-icon";
import type { ExerciseAttachment } from "@/lib/scoring/strength/attachments";

/**
 * Equipment/attachment picker (user feedback: "equipment/attachment
 * picker for exercises (e.g. tricep pushdown rope vs straight bar) with
 * images/descriptions, and predictions differing per attachment").
 * Only rendered when the current exercise has attachment options — see
 * getAttachmentOptionsByKey() in strength/attachments.ts.
 */
export function AttachmentPicker({
  options,
  value,
  onChange,
}: {
  options: ExerciseAttachment[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
        Attachment
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt.id || (value === null && opt.anchorMultiplier === 1.0);
          const showInfo = expandedId === opt.id;
          return (
            <div key={opt.id} className="flex flex-col">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  selected
                    ? "border-gym-accent/30 bg-gym-accent/15 text-gym-accent"
                    : "border-white/[0.06] bg-white/[0.03] text-muted hover:text-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => onChange(opt.id)}
                  className="flex min-h-[28px] items-center gap-1.5"
                >
                  <AttachmentIcon icon={opt.icon} className="h-3.5 w-3.5 shrink-0" />
                  {opt.label}
                </button>
                <button
                  type="button"
                  aria-label={`What is ${opt.label}?`}
                  onClick={() => setExpandedId(showInfo ? null : opt.id)}
                  className="text-muted/50 hover:text-foreground"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
              {showInfo && (
                <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-muted/80">
                  {opt.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
