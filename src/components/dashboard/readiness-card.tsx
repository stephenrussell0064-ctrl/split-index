"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { ReadinessResult } from "@/lib/scoring/readiness";

/**
 * Cross-domain readiness (interference-engine brief, Part 2) — built from
 * BOTH recent strength load and recent cardio load together, not either
 * domain in isolation (a Whoop-style score only sees HRV/sleep; it has no
 * idea a heavy squat session happened). The one daily number shown first,
 * with a one-line reason that names which domain is actually driving it.
 */
export function ReadinessCard({ readiness, className }: { readiness: ReadinessResult; className?: string }) {
  const reducedMotion = useReducedMotion();
  const tone =
    readiness.readiness >= 70 ? "text-success" : readiness.readiness >= 40 ? "text-warning" : "text-danger";

  return (
    <Card glow="accent" padding="lg" className={cn("relative overflow-hidden", className)}>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <p className="micro-label mb-1 flex items-center gap-1.5 text-muted">
            <Gauge className="h-3.5 w-3.5" />
            Today&apos;s Readiness
          </p>
          <p className={cn("index-display text-5xl font-bold tabular-nums", tone)}>
            {readiness.readiness}
          </p>
        </div>
        <p className="max-w-sm text-sm text-muted">{readiness.reason}</p>
      </motion.div>
    </Card>
  );
}
