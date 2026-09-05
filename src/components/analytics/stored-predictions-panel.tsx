"use client";

import { motion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { cn } from "@/lib/utils/cn";
import { AdaptiveOneRmList } from "./adaptive-1rm-list";
import {
  formatPredictionLabel,
  formatRiegelPrediction,
} from "@/lib/scoring/presentation";
import { riegelPredictions, sportRacePredictions, walkPacePredictions } from "@/lib/scoring/cardio-activity";
import { BENCHMARK_DISTANCE_METERS } from "@/lib/scoring/cardio-benchmarks";
import { tier2IsCalibrating, TIER2_MIN_SAMPLES_TO_DISPLAY } from "@/lib/scoring/cardio/race-prediction";
import type { PredictedBenchmark, StrengthEstimate } from "./types";

const SPORT_LABELS: Record<PredictedBenchmark["sport"], string> = {
  run: "Running · 5K",
  walk: "Walking · pace/km",
  row: "Rowing · 2K",
  swim: "Swimming · 400m",
  cycle: "Cycling · 20K",
  ski: "SkiErg · 2K",
};

/** Race ladder label per sport — every endurance sport but cycle gets one (user feedback: only running had a ladder). */
const LADDER_TITLE: Partial<Record<PredictedBenchmark["sport"], string>> = {
  run: "Race ladder · from your running memory",
  row: "Race ladder · from your rowing memory",
  ski: "Race ladder · from your SkiErg memory",
  swim: "Race ladder · from your swimming memory",
  walk: "Pace ladder · from your walking memory",
};

/** Builds the race/pace ladder for a stored Tier 2 benchmark — same Riegel projection each sport's per-session ladder uses, seeded from the profile-level prediction instead of a single session. */
function buildLadder(benchmark: PredictedBenchmark): Record<string, number> | null {
  if (tier2IsCalibrating(benchmark.sampleCount)) return null;
  switch (benchmark.sport) {
    case "run":
      return riegelPredictions(5000, benchmark.benchmarkSeconds, "intermediate", benchmark.riegelK);
    case "row":
    case "ski":
    case "swim":
      return sportRacePredictions(
        benchmark.sport,
        BENCHMARK_DISTANCE_METERS[benchmark.sport],
        benchmark.benchmarkSeconds,
        "intermediate",
        benchmark.riegelK
      );
    case "walk":
      return walkPacePredictions(1000, benchmark.benchmarkSeconds);
    default:
      return null;
  }
}

function formatBenchmarkValue(benchmark: PredictedBenchmark): string {
  if (benchmark.sport === "walk") {
    return `${formatRiegelPrediction(benchmark.benchmarkSeconds)} /km`;
  }
  return formatRiegelPrediction(benchmark.benchmarkSeconds);
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
  const ladders = benchmarks
    .map((b) => ({ benchmark: b, ladder: buildLadder(b) }))
    .filter((entry): entry is { benchmark: PredictedBenchmark; ladder: Record<string, number> } => entry.ladder !== null);

  return (
    <div className="space-y-5">
      {benchmarks.length > 0 && (
        <div>
          <p className="micro-label text-muted mb-2">
            Profile prediction · built from your full training history
          </p>
          {benchmarks.some((b) => b.riegelK != null) ? (
            <ScoringExplainerNote href="/how-scoring-works#race-predictions" className="mb-2 mt-0">
              Uses Riegel&apos;s formula personalized to your own pace curve across distances — not a
              generic exponent.
            </ScoringExplainerNote>
          ) : (
            <ScoringExplainerNote href="/how-scoring-works#race-predictions" className="mb-2 mt-0">
              Uses Riegel&apos;s formula with a population-average exponent — log races or hard efforts
              across a couple of distances to personalize this to your own pace curve.
            </ScoringExplainerNote>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {benchmarks.map((b) => {
              const calibrating = tier2IsCalibrating(b.sampleCount);
              return (
                <div key={b.sport} className="glass rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted">
                    {SPORT_LABELS[b.sport]}
                  </p>
                  {calibrating ? (
                    <>
                      <p className="mt-0.5 text-sm font-medium text-muted">Calibrating…</p>
                      <p className="text-[10px] text-muted">
                        {b.sampleCount}/{TIER2_MIN_SAMPLES_TO_DISPLAY} sessions logged
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                        {formatBenchmarkValue(b)}
                      </p>
                      <p className="text-[10px] text-muted">
                        {b.sampleCount} session{b.sampleCount === 1 ? "" : "s"} of evidence
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ladders.map(({ benchmark, ladder }) => (
        <div key={benchmark.sport}>
          <p className="micro-label text-muted mb-2">
            {LADDER_TITLE[benchmark.sport] ?? "Race ladder"}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 text-xs">
            {Object.entries(ladder)
              // JS object key order sorts integer-like keys (e.g. "42195")
              // numerically ahead of any key containing a decimal point
              // (e.g. "21097.5", the half-marathon distance in meters),
              // regardless of insertion order — silently put Marathon
              // before Half in every ladder (user feedback: "why is half
              // below marathon"). Sort explicitly by the real distance.
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([dist, sec]) => (
              <li key={dist} className="flex justify-between gap-2 tabular-nums glass rounded-lg px-3 py-1.5">
                <span className="text-muted">{formatPredictionLabel(dist)}</span>
                <span className="font-medium">{formatRiegelPrediction(sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <AdaptiveOneRmList strengthEstimates={strengthEstimates} showConfidence={showConfidence} />
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
              subtitle="Unlock your full race ladder and per-lift adaptive 1RM predictions with Premium."
            >
              <PredictionsContent
                benchmarks={[
                  { sport: "run", benchmarkSeconds: 1194, sampleCount: 4, updatedAt: "" },
                ]}
                strengthEstimates={[
                  {
                    exerciseName: "Bench Press",
                    estimated1RmKg: 102.4,
                    current1RmKg: 99.8,
                    allTime1RmKg: 107.5,
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
