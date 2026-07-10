"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Target } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { cn } from "@/lib/utils/cn";
import { formatWeight } from "@/lib/utils/format";
import {
  formatPredictionLabel,
  formatRiegelPrediction,
} from "@/lib/scoring/presentation";
import { riegelPredictions } from "@/lib/scoring/cardio-activity";
import type { PredictedBenchmark, StrengthEstimate } from "./types";

const SPORT_LABELS: Record<PredictedBenchmark["sport"], string> = {
  run: "Running · 5K",
  walk: "Walking · pace/km",
  row: "Rowing · 2K",
  swim: "Swimming · 400m",
  cycle: "Cycling · 20K",
  ski: "SkiErg · 2K",
};

function formatBenchmarkValue(benchmark: PredictedBenchmark): string {
  if (benchmark.sport === "walk") {
    return `${formatRiegelPrediction(benchmark.benchmarkSeconds)} /km`;
  }
  return formatRiegelPrediction(benchmark.benchmarkSeconds);
}

function TrendIcon({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-success" />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-danger" />;
  return <Minus className="h-3.5 w-3.5 text-muted" />;
}

function PredictionsContent({
  benchmarks,
  strengthEstimates,
  showConfidence,
}: {
  benchmarks: PredictedBenchmark[];
  strengthEstimates: StrengthEstimate[];
  showConfidence: boolean;
}) {
  const runBenchmark = benchmarks.find((b) => b.sport === "run");
  const runLadder = runBenchmark
    ? riegelPredictions(5000, runBenchmark.benchmarkSeconds, "intermediate")
    : null;

  return (
    <div className="space-y-5">
      {benchmarks.length > 0 && (
        <div>
          <p className="micro-label text-muted mb-2">Predicted benchmarks</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {benchmarks.map((b) => (
              <div key={b.sport} className="glass rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {SPORT_LABELS[b.sport]}
                </p>
                <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                  {formatBenchmarkValue(b)}
                </p>
                <p className="text-[10px] text-muted">
                  {b.sampleCount} session{b.sampleCount === 1 ? "" : "s"} of evidence
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {runLadder && (
        <div>
          <p className="micro-label text-muted mb-2">Race ladder · from your running memory</p>
          <ul className="grid gap-1.5 sm:grid-cols-2 text-xs">
            {Object.entries(runLadder).map(([dist, sec]) => (
              <li key={dist} className="flex justify-between gap-2 tabular-nums glass rounded-lg px-3 py-1.5">
                <span className="text-muted">{formatPredictionLabel(dist)}</span>
                <span className="font-medium">{formatRiegelPrediction(sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {strengthEstimates.length > 0 && (
        <div>
          <p className="micro-label text-muted mb-2 flex items-center gap-1.5">
            <Target className="h-3 w-3" /> Adaptive 1RM · core lifts
          </p>
          <ul className="space-y-1.5">
            {strengthEstimates.map((est) => (
              <li
                key={est.exerciseName}
                className="flex items-center justify-between gap-2 glass rounded-lg px-3 py-2 text-sm"
              >
                <span className="text-foreground/90">{est.exerciseName}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <TrendIcon trend={est.trend} />
                  <span className="font-medium">{formatWeight(est.estimated1RmKg)}</span>
                  {showConfidence && est.bandKg && (
                    <span className="text-[10px] text-muted">
                      {formatWeight(est.bandKg[0])}–{formatWeight(est.bandKg[1])}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StoredPredictionsPanel({
  benchmarks,
  strengthEstimates,
  isPremium,
}: {
  benchmarks: PredictedBenchmark[];
  strengthEstimates: StrengthEstimate[];
  isPremium: boolean;
}) {
  const hasData = benchmarks.length > 0 || strengthEstimates.length > 0;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
      <Card className={cn(!hasData && "opacity-90")}>
        <CardHeader className="mb-3">
          <CardTitle>Stored Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <p className="text-sm text-muted">
              Log a few cardio sessions and gym lifts to unlock race-ladder and adaptive 1RM predictions.
            </p>
          ) : isPremium ? (
            <PredictionsContent
              benchmarks={benchmarks}
              strengthEstimates={strengthEstimates}
              showConfidence
            />
          ) : (
            <PremiumTease
              title="Race ladder & adaptive 1RM"
              subtitle="Unlock your full Riegel race ladder and per-lift adaptive 1RM predictions with Premium."
            >
              <PredictionsContent
                benchmarks={[
                  { sport: "run", benchmarkSeconds: 1194, sampleCount: 4, updatedAt: "" },
                ]}
                strengthEstimates={[
                  {
                    exerciseName: "Bench Press",
                    estimated1RmKg: 102.4,
                    trend: "up",
                    bandKg: [96.3, 108.1],
                    recordedAt: "",
                  },
                ]}
                showConfidence={false}
              />
            </PremiumTease>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
