"use client";

import { motion } from "framer-motion";
import { Gauge, Flame } from "lucide-react";
import { format } from "date-fns";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { formatPace } from "@/lib/utils/format";
import type { LactateThresholdEstimate, RaceEffortVo2MaxEstimate } from "@/lib/scoring/cardio/fitness-estimates";

const CONFIDENCE_LABEL: Record<LactateThresholdEstimate["confidence"], string> = {
  low: "1 session — directional only",
  medium: "2 sessions",
  high: "3+ sessions — stable",
};

function LactateThresholdCard({ estimate }: { estimate: LactateThresholdEstimate | null }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <Flame className="h-4 w-4 text-warning" />
        <p className="micro-label text-muted">Lactate threshold</p>
      </div>
      {estimate ? (
        <>
          <div className="flex items-baseline gap-4">
            <div>
              <p className="index-display text-2xl font-bold tabular-nums">{estimate.hrBpm}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted/70">bpm</p>
            </div>
            <div>
              <p className="index-display text-2xl font-bold tabular-nums">
                {formatPace(estimate.paceSecondsPerKm)}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-muted/70">pace</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            From your {estimate.sport.replace("_", " ")} sessions tagged threshold/tempo ·{" "}
            {CONFIDENCE_LABEL[estimate.confidence]} · as of{" "}
            {format(new Date(estimate.asOfIso), "MMM d")}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">
          Tag a sustained 15–70min effort as &quot;Threshold&quot; or &quot;Tempo&quot; when
          logging to unlock this — a single easy run or race doesn&apos;t tell us where your
          threshold sits.
        </p>
      )}
    </div>
  );
}

function Vo2MaxCard({ estimate }: { estimate: RaceEffortVo2MaxEstimate | null }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cardio-accent" />
        <p className="micro-label text-muted">Estimated VO2max</p>
      </div>
      {estimate ? (
        <>
          <p className="index-display text-2xl font-bold tabular-nums">
            {estimate.value}
            <span className="ml-1.5 text-xs font-normal text-muted/70">ml/kg/min</span>
          </p>
          <p className="mt-2 text-xs text-muted">
            {estimate.source === "logged-race" && estimate.asOfIso
              ? `From your race on ${format(new Date(estimate.asOfIso), "MMM d")}`
              : "From your predicted 5K — log a real race for a sharper estimate"}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">
          Log a race, or keep logging so we can predict your 5K, to unlock this.
        </p>
      )}
    </div>
  );
}

export function FitnessEstimatesPanel({
  lactateThreshold,
  vo2max,
}: {
  lactateThreshold: LactateThresholdEstimate | null;
  vo2max: RaceEffortVo2MaxEstimate | null;
}) {
  if (!lactateThreshold && !vo2max) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
      <Card>
        <CardHeader className="mb-2">
          <CardTitle>Fitness Estimates</CardTitle>
          <p className="text-xs text-muted">
            Neither of these is a lab measurement — no wearable measures actual blood lactate or
            gas exchange. Both are estimated the same way Garmin and every other platform does it,
            from your own logged pace, heart rate, and effort.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <LactateThresholdCard estimate={lactateThreshold} />
            <Vo2MaxCard estimate={vo2max} />
          </div>
          <ScoringExplainerNote href="/how-scoring-works#fitness-estimates" className="mt-4 text-muted">
            Lactate threshold uses your own sessions tagged Threshold/Tempo (15–70min sustained
            efforts). VO2max uses the Daniels &amp; Gilbert VDOT formula on your most recent race,
            or your predicted 5K if you haven&apos;t logged one recently.
          </ScoringExplainerNote>
        </CardContent>
      </Card>
    </motion.div>
  );
}
