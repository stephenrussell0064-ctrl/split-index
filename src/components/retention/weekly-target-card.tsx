"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CalendarCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface WeeklyTargetCardProps {
  sessions: number;
  target?: number;
  className?: string;
}

export function WeeklyTargetCard({
  sessions,
  target = 4,
  className,
}: WeeklyTargetCardProps) {
  const reducedMotion = useReducedMotion();
  const pct = Math.min(100, (sessions / target) * 100);
  const hit = sessions >= target;

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Weekly Target</CardTitle>
          <CalendarCheck
            className={cn("h-4 w-4", hit ? "text-success" : "text-muted")}
          />
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        <div className="flex items-end justify-between">
          <p className="text-3xl font-bold tabular-nums">
            {sessions}
            <span className="text-lg font-normal text-muted">/{target}</span>
          </p>
          <p
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              hit ? "text-success" : "text-muted"
            )}
          >
            {hit ? "Target hit" : `${target - sessions} to go`}
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/5">
          <motion.div
            initial={reducedMotion ? { width: `${pct}%` } : { width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "h-full rounded-full",
              hit ? "bg-success" : "bg-accent"
            )}
          />
        </div>
        <p className="text-xs text-muted">
          Hybrid athletes who hit {target} sessions weekly retain 2× longer.
        </p>
      </CardContent>
    </Card>
  );
}
