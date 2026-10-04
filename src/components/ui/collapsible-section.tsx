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
 * SECOND PASS (4 Oct 2026): "the dropdown in the analytics tab for the race
 * predictions and 1RMs is too small and easy to miss". The first version was
 * a 44px row of 14px text with an 11px "Show all" and a 16px chevron in the
 * muted colour — visually indistinguishable from a static card header, so
 * nobody knew it opened. It now reads as a control: a tinted icon tile, a
 * larger title, the count as a pill, and an accent-coloured "Show all N"
 * button with the chevron inside it. Closed, it carries a soft accent border
 * so the section itself says there is more behind it. The whole header is
 * still one button, so the enlarged target is the entire row.
 *
 * Keyboard and screen reader: it is a real button with `aria-expanded` and
 * `aria-controls`, so it announces its state and toggles on Enter/Space.
 */

type Tone = "neutral" | "gym" | "cardio";

const TONE = {
  neutral: {
    text: "text-foreground",
    muted: "text-muted",
    border: "border-white/[0.06]",
    closedBorder: "border-accent/25",
    accent: "text-accent",
    tile: "bg-accent/12 text-accent",
    control: "bg-accent/12 text-accent hover:bg-accent/20",
    controlOpen: "bg-white/[0.06] text-foreground hover:bg-white/[0.1]",
    pill: "bg-white/[0.06]",
  },
  gym: {
    text: "text-gym-text",
    muted: "text-gym-muted",
    border: "border-gym-border/30",
    closedBorder: "border-gym-accent/35",
    accent: "text-gym-accent",
    tile: "bg-gym-accent/12 text-gym-accent",
    control: "bg-gym-accent/15 text-gym-accent hover:bg-gym-accent/25",
    controlOpen: "bg-gym-bg-elevated/70 text-gym-text hover:bg-gym-bg-elevated",
    pill: "bg-gym-bg-elevated/60",
  },
  cardio: {
    text: "text-cardio-text",
    muted: "text-cardio-muted",
    border: "border-cardio-border/30",
    closedBorder: "border-cardio-accent/35",
    accent: "text-cardio-accent",
    tile: "bg-cardio-accent/12 text-cardio-accent",
    control: "bg-cardio-accent/15 text-cardio-accent hover:bg-cardio-accent/25",
    controlOpen: "bg-cardio-bg-elevated/70 text-cardio-text hover:bg-cardio-bg-elevated",
    pill: "bg-cardio-bg-elevated/60",
  },
} as const satisfies Record<Tone, Record<string, string>>;

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
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const t = TONE[tone];

  return (
    <section
      className={cn(
        "rounded-2xl border bg-white/[0.02] transition-colors",
        open ? t.border : t.closedBorder,
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] sm:px-5",
          open && "rounded-b-none"
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          {icon && (
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4",
                t.tile
              )}
              aria-hidden
            >
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold leading-tight", t.text)}>
              <span className="min-w-0 break-words line-clamp-2">{title}</span>
              {count && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    t.pill,
                    t.muted
                  )}
                >
                  {count}
                </span>
              )}
            </span>
            {description && (
              <span className={cn("mt-1 block text-xs leading-snug", t.muted)}>{description}</span>
            )}
          </span>
        </span>
        <span
          className={cn(
            "flex h-9 shrink-0 items-center gap-1 rounded-full pl-3.5 pr-2.5 text-xs font-semibold transition-colors",
            open ? t.controlOpen : t.control
          )}
        >
          {open ? "Hide" : "Show all"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {!open && summary && <div className="px-4 pb-4 sm:px-5">{summary}</div>}

      <div id={panelId} hidden={!open} className={cn("border-t px-4 pb-4 pt-4 sm:px-5", t.border)}>
        {open && children}
      </div>
    </section>
  );
}

/**
 * The closed-state summary most sections want: a row of pills, each a label
 * and a value. Wraps rather than scrolls, so nothing goes off-screen.
 *
 * Sized to be read, not glanced past, but compact enough that two sit side
 * by side in the 240px a nested section gets on a 375px phone: value at
 * 13px, label at 11.
 */
export function SummaryPills({
  items,
  more,
  tone = "neutral",
}: {
  items: { label: string; value: string }[];
  /** How many entries are NOT shown here — rendered as a trailing "+N more". */
  more?: number;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          className={cn(
            "flex max-w-full items-baseline gap-1.5 rounded-xl border px-2.5 py-1.5",
            t.pill,
            t.border
          )}
        >
          <span className={cn("min-w-0 truncate text-[11px]", t.muted)}>{item.label}</span>
          <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", t.text)}>{item.value}</span>
        </li>
      ))}
      {more != null && more > 0 && (
        <li className={cn("flex items-center px-1 py-1.5 text-xs font-medium", t.accent)}>
          +{more} more
        </li>
      )}
    </ul>
  );
}
