"use client";

import { format } from "date-fns";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SPORTS } from "@/lib/constants/sports";
import { ChartEmptyState } from "@/components/analytics/charts";
import { formatDuration, formatDistance } from "@/lib/utils/format";
import type { PersonalRecord } from "@/types";

interface PersonalRecordsTableProps {
  records: PersonalRecord[];
}

export function sportLabel(sport: string): string {
  return SPORTS.find((s) => s.id === sport)?.name ?? sport.replace("_", " ");
}

/** Time/distance-based metrics (personal-records.ts) read far better formatted than raw seconds/meters. */
export function formatRecordValue(pr: PersonalRecord): string {
  if (pr.unit === "seconds") return formatDuration(pr.value);
  if (pr.unit === "meters") return formatDistance(pr.value);
  return `${pr.value.toLocaleString()} ${pr.unit}`;
}

export function PersonalRecordsTable({ records }: PersonalRecordsTableProps) {
  const sorted = [...records].sort(
    (a, b) => new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28 }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <CardTitle>Personal Records</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <ChartEmptyState message="Personal bests appear here as you set new records" />
          ) : (
            <>
              {/*
                TWO LINES PER RECORD ON A PHONE, a table from `sm` up.

                This was one table wrapped in `overflow-x-auto`, which does
                nothing: the table is `w-full`, so it never exceeds its
                container and the wrapper never scrolls. What actually happened
                at 390px is that four columns — Sport, Metric, Value and a
                "MMM d, yyyy" date — squeezed into 318px and the metric column
                wrapped to three lines, so every row was three rows tall and
                none of the columns lined up with their headers any more.

                A record is two facts and two qualifiers: what you did and how
                much, then which metric and when. That is a list on a phone,
                not a table. The table is right at `sm` and up and is kept
                exactly as it was, minus the wrapper that was doing nothing.
              */}
              <ul className="sm:hidden">
                {sorted.map((pr, i) => (
                  <motion.li
                    key={pr.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex flex-col gap-0.5 border-b border-white/[0.03] py-3 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{sportLabel(pr.sport)}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-accent">
                        {formatRecordValue(pr)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                      <span className="capitalize">{pr.metric.replace(/_/g, " ")}</span>
                      <span className="shrink-0 tabular-nums">
                        {format(new Date(pr.achieved_at), "MMM d, yyyy")}
                      </span>
                    </div>
                  </motion.li>
                ))}
              </ul>

              <table className="hidden w-full text-sm sm:table">
                <thead>
                  <tr className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="pb-3 pr-4 font-medium">Sport</th>
                    <th className="pb-3 pr-4 font-medium">Metric</th>
                    <th className="pb-3 pr-4 font-medium text-right">Value</th>
                    <th className="pb-3 font-medium text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((pr, i) => (
                    <motion.tr
                      key={pr.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-white/[0.03] last:border-0"
                    >
                      <td className="py-3 pr-4">{sportLabel(pr.sport)}</td>
                      <td className="py-3 pr-4 capitalize text-muted">
                        {pr.metric.replace(/_/g, " ")}
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold tabular-nums text-accent">
                        {formatRecordValue(pr)}
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted">
                        {format(new Date(pr.achieved_at), "MMM d, yyyy")}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
