"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function ExpandableSection({
  title,
  hint,
  defaultOpen = false,
  children,
  tone = "neutral",
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  tone?: "neutral" | "cardio" | "gym";
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={cn(
        "rounded-2xl border overflow-hidden",
        tone === "cardio" && "border-cardio-border/25 bg-cardio-bg-elevated/5",
        tone === "gym" && "border-gym-border/25 bg-gym-bg-elevated/5",
        tone === "neutral" && "border-white/[0.08] bg-white/[0.02]"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left min-h-[52px] hover:bg-white/[0.02] transition-colors"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted/80">
            {title}
          </p>
          {hint && !open && (
            <p className="mt-0.5 text-xs text-muted/60">{hint}</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-5 pb-5 pt-0 space-y-5 border-t border-white/[0.05]">{children}</div>}
    </section>
  );
}
