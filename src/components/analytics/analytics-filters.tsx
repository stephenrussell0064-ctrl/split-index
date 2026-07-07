"use client";

import { motion } from "framer-motion";
import { GitCompare, Filter } from "lucide-react";
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

const GRANULARITY_OPTIONS: { value: TrendGranularity; label: string }[] = [
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
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
  const sportOptions = [
    { value: "all", label: "All sports" },
    ...SPORTS.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong sticky top-0 z-20 rounded-2xl border border-white/[0.08] p-4 md:p-5"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>

        <div className="min-w-[140px] flex-1 sm:max-w-[180px]">
          <Select
            label="Sport"
            value={sport}
            onChange={(e) => onSportChange(e.target.value as SportFilter)}
            options={sportOptions}
          />
        </div>

        <div className="flex gap-1 rounded-xl border border-white/[0.06] glass p-1">
          {GRANULARITY_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => onGranularityChange(g.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                granularity === g.value
                  ? "bg-accent text-accent-foreground shadow-md shadow-accent/25"
                  : "text-muted hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="min-w-[140px] flex-1 sm:max-w-[160px]">
          <Select
            label="Period A"
            value={periodA}
            onChange={(e) => onPeriodAChange(e.target.value as PeriodPreset)}
            options={PERIOD_PRESETS}
          />
        </div>

        <div className="min-w-[140px] flex-1 sm:max-w-[160px]">
          <Select
            label="Period B"
            value={periodB}
            onChange={(e) => onPeriodBChange(e.target.value as PeriodPreset)}
            options={PERIOD_PRESETS}
            disabled={!compareEnabled}
          />
        </div>

        <button
          type="button"
          onClick={() => onCompareToggle(!compareEnabled)}
          className={cn(
            "flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all",
            compareEnabled
              ? "bg-accent/20 text-accent border border-accent/30"
              : "glass border border-white/10 text-muted hover:text-foreground"
          )}
        >
          <GitCompare className="h-4 w-4" />
          Compare
        </button>
      </div>

      {compareEnabled && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3 text-[10px] uppercase tracking-wider text-muted"
        >
          Comparing {periodALabel} vs {periodBLabel}
        </motion.p>
      )}
    </motion.div>
  );
}
