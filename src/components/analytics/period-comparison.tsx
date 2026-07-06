"use client";

import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatDuration, formatIndex, formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { pctDelta } from "./utils";
import type { PeriodMetrics } from "./types";

interface PeriodComparisonProps {
  periodA: PeriodMetrics;
  periodB: PeriodMetrics;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const delta = pctDelta(current, previous);
  if (delta === null) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-muted">
        <Minus className="h-3 w-3" /> —
      </span>
    );
  }
  const positive = delta >= 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-[10px] font-medium tabular-nums",
        positive ? "text-success" : "text-danger"
      )}
    >
      <Icon className="h-3 w-3" />
      {positive ? "+" : ""}
      {delta}%
    </span>
  );
}

const METRICS: {
  key: keyof PeriodMetrics;
  label: string;
  format: (v: number, m: PeriodMetrics) => string;
  invertDelta?: boolean;
}[] = [
  { key: "avgSplit", label: "Avg Split Index", format: (v) => formatIndex(v) },
  { key: "avgEndurance", label: "Endurance", format: (v) => formatIndex(v) },
  { key: "avgStrength", label: "Strength", format: (v) => formatIndex(v) },
  { key: "avgRecovery", label: "Recovery", format: (v) => formatPercent(v) },
  {
    key: "avgFatigue",
    label: "Fatigue",
    format: (v) => formatPercent(v),
    invertDelta: true,
  },
  { key: "totalLoad", label: "Training Load", format: (v) => `${v} AU` },
  {
    key: "totalDuration",
    label: "Duration",
    format: (v) => formatDuration(v),
  },
  { key: "sessions", label: "Sessions", format: (v) => String(v) },
  {
    key: "consistencyPct",
    label: "Consistency",
    format: (v) => formatPercent(v),
  },
];

export function PeriodComparison({ periodA, periodB }: PeriodComparisonProps) {
  return (
    <Card glow="accent">
      <CardHeader>
        <CardTitle>
          Period Comparison · {periodA.label} vs {periodB.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS.map((m, i) => {
            const valA = periodA[m.key] as number;
            const valB = periodB[m.key] as number;
            return (
              <motion.div
                key={m.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="glass rounded-xl p-4"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {m.label}
                </p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xl font-bold tabular-nums">
                      {m.format(valA, periodA)}
                    </p>
                    <p className="text-[10px] text-muted">{periodA.label}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-muted">
                      {m.format(valB, periodB)}
                    </p>
                    <DeltaBadge
                      current={m.invertDelta ? -valA : valA}
                      previous={m.invertDelta ? -valB : valB}
                    />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
