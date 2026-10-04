"use client";

import { useState } from "react";
import { GitCompare, ChevronDown } from "lucide-react";
import { Select } from "@/components/ui/input";
import { SPORTS } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { PeriodPreset, SportFilter, TrendGranularity } from "./types";

const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
];

const GRANULARITY_OPTIONS: { value: TrendGranularity; label: string; short: string }[] = [
  { value: "week", label: "Weekly", short: "W" },
  { value: "month", label: "Monthly", short: "M" },
  { value: "year", label: "Yearly", short: "Y" },
];

interface AnalyticsFiltersProps {
  sport: SportFilter;
  onSportChange: (sport: SportFilter) => void;
  granularity: TrendGranularity;
  onGranularityChange: (g: TrendGranularity) => void;
  periodA: PeriodPreset;
  onPeriodAChange: (p: PeriodPreset) => void;
  periodB: PeriodPreset;
  onPeriodBChange: (p: PeriodPreset) => void;
  compareEnabled: boolean;
  onCompareToggle: (enabled: boolean) => void;
  periodALabel: string;
  periodBLabel: string;
}

/**
 * Compact by default (user feedback: the filter bar at the top was too
 * large — a permanently-sticky, multi-row block with a label over every
 * field, eating real screen space before any actual data appeared). One
 * dense, non-sticky row now; Period A/B + Compare — the least frequently
 * touched controls — live behind a disclosure instead of always being
 * rendered, since most visits just want the sport/granularity toggle.
 */
export function AnalyticsFilters({
  sport,
  onSportChange,
  granularity,
  onGranularityChange,
  periodA,
  onPeriodAChange,
  periodB,
  onPeriodBChange,
  compareEnabled,
  onCompareToggle,
  periodALabel,
  periodBLabel,
}: AnalyticsFiltersProps) {
  const [comparisonOpen, setComparisonOpen] = useState(compareEnabled);

  const sportOptions = [
    { value: "all", label: "All sports" },
    ...SPORTS.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="glass rounded-xl border border-white/[0.06] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sport}
          onChange={(e) => onSportChange(e.target.value as SportFilter)}
          aria-label="Filter by sport"
          // text-base, not text-xs: under 16px iOS zooms into the control
          // and, in an SPA, never zooms back out. Same rule as `input.tsx`;
          // leading-none holds the h-9 box.
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 text-base leading-none text-foreground sm:max-w-[150px] sm:flex-none"
        >
          {sportOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div
          className="flex gap-0.5 rounded-lg border border-white/[0.06] glass p-0.5"
          role="group"
          aria-label="Period: this week, this month or this year"
          title="Sets the period for the figures below and the trend chart"
        >
          {GRANULARITY_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => onGranularityChange(g.value)}
              aria-label={g.label}
              className={cn(
                "h-8 w-8 rounded-md text-xs font-semibold transition-all duration-200",
                granularity === g.value
                  ? "bg-accent text-accent-foreground shadow-md shadow-accent/25"
                  : "text-muted hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              {g.short}
            </button>
          ))}
        </div>

        {/*
          ONE TAP. Compare used to open a row holding two selects and a THIRD
          control, "Show comparison", that actually switched the panel on —
          so tapping Compare appeared to do nothing (owner: the compare button
          "doesn't work at all"). Opening the row now enables the comparison
          and the panel renders directly beneath this bar; the row's selects
          choose what is compared; closing the row switches it off.
        */}
        <button
          type="button"
          aria-pressed={comparisonOpen}
          onClick={() => {
            const next = !comparisonOpen;
            setComparisonOpen(next);
            onCompareToggle(next);
          }}
          className={cn(
            "ml-auto flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all",
            comparisonOpen
              ? "bg-accent/20 text-accent border border-accent/30"
              : "glass border border-white/10 text-muted hover:text-foreground"
          )}
        >
          <GitCompare className="h-3.5 w-3.5" />
          Compare
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", comparisonOpen && "rotate-180")}
          />
        </button>
      </div>

      {comparisonOpen && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5">
          <Select
            value={periodA}
            onChange={(e) => onPeriodAChange(e.target.value as PeriodPreset)}
            options={PERIOD_PRESETS}
            className="h-9"
            wrapperClassName="min-w-[130px] flex-1 sm:flex-none"
          />
          <span className="text-xs text-muted">vs</span>
          <Select
            value={periodB}
            onChange={(e) => onPeriodBChange(e.target.value as PeriodPreset)}
            options={PERIOD_PRESETS}
            className="h-9"
            wrapperClassName="min-w-[130px] flex-1 sm:flex-none"
          />
          <p className="w-full text-[11px] text-muted sm:ml-auto sm:w-auto" aria-live="polite">
            {compareEnabled ? `Comparing ${periodALabel} vs ${periodBLabel} — see below.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
