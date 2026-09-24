"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A list that opens on demand.
 *
 * User feedback: "the 1 rep max predictions in the data analytics [should]
 * be a drop down which you can see all of them, otherwise they make the user
 * scroll too much, same for the stored predictions for running and other
 * cardio... follow this principle elsewhere in the app".
 *
 * The shape is the same everywhere it is used: a header row you can tap
 * (title, a count, a chevron), a one-line description, and — while it is
 * closed — an optional `summary`: the two or three most important entries,
 * rendered compactly, so the section still says something without being
 * opened. Tap, and the full list takes its place.
 *
 * Closed by default on purpose. Every one of these sits in a page with
 * several other sections, and a dozen lifts or five race distances open by
 * default is what pushed the sections below them off the screen.
 *
 * Keyboard and screen reader: it is a real button with `aria-expanded` and
 * `aria-controls`, so it announces its state and toggles on Enter/Space.
 */
export function CollapsibleSection({
  title,
  icon,
  count,
  description,
  summary,
  defaultOpen = false,
  tone = "neutral",
  className,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** "12 lifts", "5 distances" — shown beside the title, and it is what the button promises to reveal. */
  count?: string;
  description?: React.ReactNode;
  /** What is shown while closed — the headline entries, compactly. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** The Lab and The Engine have their own text colours; everything else uses the neutral set. */
  tone?: "neutral" | "gym" | "cardio";
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const text =
    tone === "gym" ? "text-gym-text" : tone === "cardio" ? "text-cardio-text" : "text-foreground";
  const muted =
    tone === "gym" ? "text-gym-muted" : tone === "cardio" ? "text-cardio-muted" : "text-muted";
  const border =
    tone === "gym"
      ? "border-gym-border/30"
      : tone === "cardio"
        ? "border-cardio-border/30"
        : "border-white/[0.06]";

  return (
    <section className={cn("rounded-2xl border bg-white/[0.02]", border, className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03]",
          open && "rounded-b-none"
        )}
      >
        <span className="min-w-0">
          <span className={cn("flex items-center gap-2 text-sm font-semibold", text)}>
            {icon}
            <span className="truncate">{title}</span>
            {count && (
              <span className={cn("shrink-0 text-[11px] font-medium", muted)}>· {count}</span>
            )}
          </span>
          {description && (
            <span className={cn("mt-0.5 block text-xs leading-snug", muted)}>{description}</span>
          )}
        </span>
        <span className={cn("flex shrink-0 items-center gap-1.5 text-[11px] font-medium", muted)}>
          {open ? "Hide" : "Show all"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {!open && summary && <div className="px-4 pb-3">{summary}</div>}

      <div id={panelId} hidden={!open} className={cn("border-t px-4 pb-4 pt-3", border)}>
        {open && children}
      </div>
    </section>
  );
}

/**
 * The closed-state summary most sections want: a row of small pills, each a
 * label and a value. Wraps rather than scrolls, so nothing goes off-screen.
 */
export function SummaryPills({
  items,
  more,
  tone = "neutral",
}: {
  items: { label: string; value: string }[];
  /** How many entries are NOT shown here — rendered as a trailing "+N more". */
  more?: number;
  tone?: "neutral" | "gym" | "cardio";
}) {
  const muted =
    tone === "gym" ? "text-gym-muted" : tone === "cardio" ? "text-cardio-muted" : "text-muted";
  const text =
    tone === "gym" ? "text-gym-text" : tone === "cardio" ? "text-cardio-text" : "text-foreground";
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-baseline gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1 text-xs"
        >
          <span className={cn("truncate", muted)}>{item.label}</span>
          <span className={cn("shrink-0 font-semibold tabular-nums", text)}>{item.value}</span>
        </li>
      ))}
      {more != null && more > 0 && (
        <li className={cn("flex items-center px-1.5 py-1 text-xs", muted)}>+{more} more</li>
      )}
    </ul>
  );
}
