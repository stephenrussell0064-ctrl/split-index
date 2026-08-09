"use client";

import { motion } from "framer-motion";
import { Scale } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { ChartEmptyState } from "@/components/analytics/charts";
import { formatDOTS, formatGL } from "@/lib/utils/scoring-display";
import type { OverallDotsGlResult } from "@/lib/scoring/strength/overall-dots-gl";

/**
 * Profile-wide, best-ever-SBD DOTS/GL — user feedback: "why is IPF GL and
 * DOTS scores not there" in analytics. Same calculateOverallDotsGl() result
 * the Lab page's own DOTS/GL card shows (gym/page.tsx), reused here rather
 * than recomputed, so the two pages never disagree.
 */
function DotsGlContent({ result }: { result: OverallDotsGlResult }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-6">
        <div>
          <p className="font-mono text-3xl font-semibold tabular-nums">{formatDOTS(result.dotsScore)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">DOTS</p>
        </div>
        <div>
          <p className="font-mono text-3xl font-semibold tabular-nums">{formatGL(result.glPoints)}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">IPF GL</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-medium tabular-nums">{result.sbdTotalKg.toFixed(1)} kg total</p>
        <p className="text-[10px] text-muted">
          {result.liftsLogged}/3 SBD lifts logged
        </p>
      </div>
    </div>
  );
}

export function DotsGlPanel({
  result,
  hasAccess,
}: {
  result: OverallDotsGlResult | null;
  /** Per-feature gate (canAccessProfile("strength_dots_gl", profile)), not the raw isPremium flag — same convention as the Lab page's own showDotsGl. */
  hasAccess: boolean;
}) {
  const hasData = result != null && result.sbdTotalKg > 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-strength" />
            <CardTitle>DOTS &amp; IPF GL</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <ChartEmptyState message="Log a squat, bench, or deadlift to unlock DOTS and IPF GL scoring" />
          ) : hasAccess ? (
            <DotsGlContent result={result} />
          ) : (
            <PremiumTease
              title="DOTS & IPF GL scoring"
              subtitle="Unlock bodyweight-adjusted DOTS percentile and IPF GL comparison with Premium."
            >
              {/* Synthetic placeholder, never the athlete's real total — same
                  135/135/190kg reference lifter cited in overall-dots-gl.ts. */}
              <DotsGlContent
                result={{
                  bestSbdKg: { squat: 135, bench: 135, deadlift: 190 },
                  sbdTotalKg: 460,
                  liftsLogged: 3,
                  dotsScore: 317.19,
                  glPoints: 64.88,
                }}
              />
            </PremiumTease>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
