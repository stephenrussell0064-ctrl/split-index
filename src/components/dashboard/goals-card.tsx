"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Target, CalendarDays, Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatIndex } from "@/lib/utils/format";

/** Local shape for the `goals` table (types file is owned by another workstream) */
export interface DashboardGoal {
  id: string;
  title: string;
  target_split_index: number | null;
  deadline: string | null;
  completed: boolean;
}

interface GoalsCardProps {
  goals: DashboardGoal[];
  currentIndex: number;
  className?: string;
}

function daysRemaining(deadline: string): number {
  const end = new Date(`${deadline}T23:59:59`);
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

export function GoalsCard({ goals, currentIndex, className }: GoalsCardProps) {
  const reducedMotion = useReducedMotion();
  const active = goals.filter((g) => !g.completed).slice(0, 3);
  const completedCount = goals.filter((g) => g.completed).length;

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Upcoming Goals</CardTitle>
          {completedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
              <Trophy className="h-3 w-3" />
              {completedCount} done
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {active.length === 0 ? (
          <GoalsEmptyState currentIndex={currentIndex} />
        ) : (
          <div className="space-y-3">
            {active.map((goal, i) => {
              const target = goal.target_split_index;
              const progress = target
                ? Math.max(0, Math.min(100, (currentIndex / target) * 100))
                : null;
              const remaining = goal.deadline ? daysRemaining(goal.deadline) : null;

              return (
                <motion.div
                  key={goal.id}
                  initial={reducedMotion ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.5 }}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug">{goal.title}</p>
                    {remaining !== null && (
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                          remaining < 0
                            ? "bg-danger/10 text-danger"
                            : remaining <= 14
                              ? "bg-warning/10 text-warning"
                              : "bg-white/5 text-muted"
                        )}
                      >
                        <CalendarDays className="h-2.5 w-2.5" />
                        {remaining < 0 ? "Overdue" : `${remaining}d left`}
                      </span>
                    )}
                  </div>

                  {target !== null && progress !== null && (
                    <div className="mt-2.5">
                      <div className="flex justify-between text-[10px] tabular-nums text-muted">
                        <span>
                          {formatIndex(currentIndex)} / {formatIndex(target)}
                        </span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          initial={reducedMotion ? { width: `${progress}%` } : { width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{
                            duration: 1,
                            ease: [0.22, 1, 0.36, 1],
                            delay: 0.4 + i * 0.1,
                          }}
                          className={cn(
                            "h-full rounded-full",
                            progress >= 100
                              ? "bg-success"
                              : "bg-gradient-to-r from-accent/70 to-accent"
                          )}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalsEmptyState({ currentIndex }: { currentIndex: number }) {
  // suggest a target one clean step up from the current index
  const suggested = Math.min(999, Math.ceil((currentIndex + 25) / 25) * 25);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
        <Target className="h-5 w-5 text-accent" />
      </div>
      <div>
        <p className="text-sm font-medium">No goals set yet</p>
        <p className="mx-auto mt-1 max-w-[210px] text-xs leading-relaxed text-muted">
          Athletes with a target index improve ~2× faster. How about{" "}
          <span className="font-semibold tabular-nums text-accent">
            {formatIndex(suggested)}
          </span>{" "}
          by season&apos;s end?
        </p>
      </div>
    </div>
  );
}
