"use client";

import { format } from "date-fns";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SPORTS } from "@/lib/constants/sports";
import { ChartEmptyState } from "@/components/analytics/charts";
import type { PersonalRecord } from "@/types";

interface PersonalRecordsTableProps {
  records: PersonalRecord[];
}

function sportLabel(sport: string): string {
  return SPORTS.find((s) => s.id === sport)?.name ?? sport.replace("_", " ");
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
                        {pr.value.toLocaleString()} {pr.unit}
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted">
                        {format(new Date(pr.achieved_at), "MMM d, yyyy")}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
