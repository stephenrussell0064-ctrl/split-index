/**
 * Split Index composite orchestration — weighted blend of endurance + strength.
 * Recency weighting remains in engine.ts; this module handles the final composite.
 */

import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";

export interface CompositeSplitInput {
  enduranceIndex: number;
  strengthIndex: number;
  enduranceWeight?: number;
  strengthWeight?: number;
}

export interface CompositeSplitResult {
  splitIndex: number;
  enduranceContribution: number;
  strengthContribution: number;
  enduranceWeight: number;
  strengthWeight: number;
  breakdownLabel: string;
}

function clampIndex(value: number): number {
  return Math.min(MAX_INDEX, Math.max(MIN_INDEX, Math.round(value)));
}

/** Normalize weights to sum to 1. */
export function normalizeSplitWeights(
  enduranceWeight: number,
  strengthWeight: number
): { enduranceWeight: number; strengthWeight: number } {
  const sum = enduranceWeight + strengthWeight;
  if (sum <= 0) return { enduranceWeight: 0.5, strengthWeight: 0.5 };
  return {
    enduranceWeight: enduranceWeight / sum,
    strengthWeight: strengthWeight / sum,
  };
}

export function calculateCompositeSplitIndex(
  input: CompositeSplitInput
): CompositeSplitResult {
  const weights = normalizeSplitWeights(
    input.enduranceWeight ?? 0.5,
    input.strengthWeight ?? 0.5
  );

  const enduranceContribution =
    input.enduranceIndex * weights.enduranceWeight;
  const strengthContribution = input.strengthIndex * weights.strengthWeight;
  const splitIndex = clampIndex(enduranceContribution + strengthContribution);

  const endPct = Math.round(weights.enduranceWeight * 100);
  const strPct = Math.round(weights.strengthWeight * 100);

  return {
    splitIndex,
    enduranceContribution: Math.round(enduranceContribution),
    strengthContribution: Math.round(strengthContribution),
    enduranceWeight: weights.enduranceWeight,
    strengthWeight: weights.strengthWeight,
    breakdownLabel: `${Math.round(input.enduranceIndex)} cardio + ${Math.round(input.strengthIndex)} strength (${endPct}/${strPct})`,
  };
}

/** Trend delta between two composite values (reuses service pattern). */
export function calculateCompositeTrend(
  current: number,
  previous: number
): number {
  return Math.round((current - previous) * 10) / 10;
}

/** Linear projection for combined split index (mirrors engine predictIndex). */
export function projectCompositeIndex(
  history: number[],
  daysAhead = 7
): number {
  if (history.length < 2) return history[0] ?? 500;

  const n = history.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += history[i];
    sumXY += i * history[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return history[n - 1];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return clampIndex(intercept + slope * (n - 1 + daysAhead));
}
