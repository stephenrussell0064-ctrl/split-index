"use client";

import { motion } from "framer-motion";
import { Medal } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AchievementIcon } from "@/components/social/achievement-icon";
import type { AchievementBadge } from "@/lib/social/types";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";

interface AchievementsPanelProps {
  achievements: AchievementBadge[];
  streak: number;
}

export function AchievementsPanel({ achievements, streak }: AchievementsPanelProps) {
  const earnedCount = achievements.filter((a) => a.earned).length;

  return (
    <div className="space-y-4">
      {streak > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass rounded-2xl border border-warning/20 p-4 glow-accent"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔥</span>
            <div>
              <p className="font-semibold">{streak} day streak</p>
              <p className="text-xs text-muted">Consecutive training days</p>
            </div>
          </div>
        </motion.div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Medal className="h-4 w-4 text-strength" />
              <CardTitle>Achievements</CardTitle>
            </div>
            <span className="text-xs text-muted">
              {earnedCount}/{achievements.length}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {achievements.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                className={cn(
                  "rounded-xl p-3 text-center transition-colors",
                  a.earned ? "glass glow-accent" : "opacity-40"
                )}
                title={a.description}
              >
                <div className="mb-2 flex justify-center">
                  <AchievementIcon slug={a.slug} icon={a.icon} earned={a.earned} />
                </div>
                <p className="text-xs font-medium leading-tight">{a.title}</p>
                {a.earnedAt && (
                  <p className="mt-1 text-[10px] text-muted">
                    {format(new Date(a.earnedAt), "d MMM yyyy")}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
