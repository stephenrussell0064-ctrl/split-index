"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The other half of the "don't make people scroll" rule — see
 * collapsible-section.tsx for the first.
 *
 * Some lists cannot be closed entirely: a records table with nothing in it
 * looks broken, and the first few rows are the ones people came for. So
 * these show the first `initial` entries and offer the rest behind one
 * button, instead of drawing all thirty and pushing the next section off
 * the screen.
 *
 * A hook rather than a component, because the personal-records table draws
 * its rows twice (a list on phones, a table from `sm` up) and both need the
 * same slice.
 */
export function useShowMore<T>(items: T[], initial: number) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = items.length > initial;
  const visible = expanded || !canExpand ? items : items.slice(0, initial);
  return {
    visible,
    expanded,
    canExpand,
    hiddenCount: Math.max(0, items.length - initial),
    toggle: () => setExpanded((v) => !v),
  };
}

export function ShowMoreButton({
  expanded,
  hiddenCount,
  noun,
  onClick,
  className,
}: {
  expanded: boolean;
  hiddenCount: number;
  /** "lifts", "records", "efforts" — the button reads "Show 8 more records". */
  noun: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(
        "mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] text-xs font-medium text-muted transition-colors hover:border-white/[0.12] hover:text-foreground",
        className
      )}
    >
      {expanded ? "Show fewer" : `Show ${hiddenCount} more ${noun}`}
      <ChevronDown
        className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}
