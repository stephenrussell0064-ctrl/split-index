"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Radar, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { cn } from "@/lib/utils/cn";
import { hasShareableFinding } from "@/lib/scoring/interference";
import type { InterferenceReport } from "@/lib/scoring/interference";

/**
 * Interference & Synergy Engine (interference-engine brief, Part 1) — the
 * flagship, dashboard-prominent panel. Split Index is the only place that
 * sees both halves of a hybrid athlete's training on one timeline; this is
 * the actual answer to "is my running hurting my squat, is my squat
 * hurting my running" — genuinely personal, mined from the athlete's own
 * paired history, never a population-average tip dressed up as one.
 */
export function InterferenceRadarCard({
  report,
  className,
}: {
  report: InterferenceReport;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const { strengthToCardio, cardioToStrength } = report;

  const hasFinding = hasShareableFinding(report);

  return (
    <Card glow="accent" className={cn("relative overflow-hidden", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-accent" />
            <CardTitle>Interference Radar</CardTitle>
          </div>
          {hasFinding && (
            <ShareImageButton
              href="/api/interference/report-card"
              filename="interference-report.png"
              shareTitle="My Split Index Interference Report"
              shareText="Here's what leg day does to my running — tracked with Split Index."
              label="Share"
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          {strengthToCardio.totalQualifyingSessions === 0 && cardioToStrength.sampleCount === 0 ? (
            <p className="text-sm text-muted">
              Gathering data — log both a strength and a cardio session across a few weeks and
              we&apos;ll show you something no other app can: how your lifting and running
              actually affect each other.
            </p>
          ) : (
            <>
              <div>
                <p className="micro-label mb-1 text-muted/70">Does lifting slow your cardio?</p>
                <p className="text-sm">
                  {strengthToCardio.weeklyFallback?.summary ?? strengthToCardio.summary}
                </p>
              </div>
              <div className="border-t border-white/5 pt-3">
                <p className="micro-label mb-1 text-muted/70">Does cardio weaken your lifting?</p>
                <p className="text-sm">{cardioToStrength.summary}</p>
              </div>
            </>
          )}
          <Link
            href="/interference"
            className="group mt-2 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm transition-colors hover:border-accent/40 hover:bg-accent/10"
          >
            <span>See the full Interference Radar</span>
            <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        </motion.div>
      </CardContent>
    </Card>
  );
}
