"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Crosshair, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatIndex } from "@/lib/utils/format";

interface FocusWeekCardProps {
  weakerSide: "endurance" | "strength" | "balanced";
  enduranceIndex: number;
  strengthIndex: number;
  className?: string;
}

export function FocusWeekCard({
  weakerSide,
  enduranceIndex,
  strengthIndex,
  className,
}: FocusWeekCardProps) {
  const reducedMotion = useReducedMotion();
  const gap = Math.abs(enduranceIndex - strengthIndex);

  const insight =
    weakerSide === "endurance"
      ? {
          label: "Endurance",
          color: "text-endurance",
          action: "Add a zone-2 run, row, or ride this week",
          href: "/activities/new?sport=running",
        }
      : weakerSide === "strength"
        ? {
            label: "Strength",
            color: "text-strength",
            action: "Schedule a compound-lift gym session",
            href: "/activities/new?sport=gym",
          }
        : {
            label: "Balanced",
            color: "text-success",
            action: "Maintain the mix — you're tracking 50/50",
            href: "/activities/new",
          };

  return (
    <Card glow="accent" className={cn("relative overflow-hidden", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-accent" />
          <CardTitle>Your Focus This Week</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-sm text-muted">
            {weakerSide === "balanced" ? (
              "Your index is evenly split — keep alternating disciplines."
            ) : (
              <>
                <span className={cn("font-semibold", insight.color)}>
                  {insight.label}
                </span>{" "}
                is lagging by{" "}
                <span className="font-semibold tabular-nums">{formatIndex(gap)}</span>{" "}
                pts — bias your next sessions here.
              </>
            )}
          </p>
          <Link
            href={insight.href}
            className="group mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm transition-colors hover:border-accent/40 hover:bg-accent/10"
          >
            <span>{insight.action}</span>
            <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        </motion.div>
      </CardContent>
    </Card>
  );
}
