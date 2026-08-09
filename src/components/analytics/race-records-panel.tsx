"use client";

import { format } from "date-fns";
import { motion } from "framer-motion";
import { Flag } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState } from "@/components/analytics/charts";
import { formatDuration } from "@/lib/utils/format";
import type { RaceRecord } from "@/lib/scoring/race-records";

/**
 * Distance-specific PB ladder, mined from the athlete's own logged
 * activities (race-records.ts) — user feedback: "why is IPF GL and DOTS
 * scores not there as well as current race records." Distinct from the
 * Race Ladder in Stored Predictions above (which is a Riegel *projection*
 * from a single benchmark distance) — every number here is a real time the
 * athlete actually ran at that exact distance.
 */
export function RaceRecordsPanel({ records }: { records: RaceRecord[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-endurance" />
            <CardTitle>Race Records</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <ChartEmptyState message="Log a 5K, 10K, half, or marathon effort to start your race-record ladder" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {records.map((r) => (
                <li key={r.label} className="glass rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted">{r.label}</p>
                  <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                    {formatDuration(r.bestSeconds)}
                  </p>
                  <p className="text-[10px] text-muted">
                    {format(new Date(r.achievedAt), "MMM d, yyyy")}
                    {r.isRace ? " · race" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
