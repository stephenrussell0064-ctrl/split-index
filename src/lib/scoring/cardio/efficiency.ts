export interface EfficiencyFactorResult {
  /** Higher = more output per heartbeat (pace-based: speed/HR; power-based: W/HR) */
  efficiencyFactor: number;
  unit: "pace_per_hr" | "power_per_hr";
  displayValue: string;
}

export interface DecouplingResult {
  firstHalfEF: number;
  secondHalfEF: number;
  /** Positive = aerobic decoupling (EF dropped in 2nd half); negative = improved */
  decouplingPct: number;
  flag: "stable" | "decoupling" | "negative_split";
  note: string;
}

/** Efficiency Factor: output metric / avg HR */
export function calculateEfficiencyFactor(params: {
  avgHeartRate: number | null;
  paceSecPerKm?: number | null;
  avgPowerWatts?: number | null;
}): EfficiencyFactorResult | null {
  const { avgHeartRate, paceSecPerKm, avgPowerWatts } = params;
  if (!avgHeartRate || avgHeartRate <= 0) return null;

  if (avgPowerWatts && avgPowerWatts > 0) {
    const ef = avgPowerWatts / avgHeartRate;
    return {
      efficiencyFactor: Math.round(ef * 100) / 100,
      unit: "power_per_hr",
      displayValue: `${ef.toFixed(2)} W/bpm`,
    };
  }

  if (paceSecPerKm && paceSecPerKm > 0) {
    const speedMPerMin = (1000 / paceSecPerKm) * 60;
    const ef = speedMPerMin / avgHeartRate;
    return {
      efficiencyFactor: Math.round(ef * 1000) / 1000,
      unit: "pace_per_hr",
      displayValue: `${ef.toFixed(3)} m/min per bpm`,
    };
  }

  return null;
}

/**
 * Aerobic decoupling from split halves or session duration estimate.
 * When only total duration is available, assumes even effort split (no decoupling data).
 */
export function calculateAerobicDecoupling(params: {
  avgHeartRate: number | null;
  paceSecPerKm?: number | null;
  avgPowerWatts?: number | null;
  /** Optional per-km or per-segment paces (seconds) */
  splitPacesSec?: number[];
  durationSeconds?: number;
}): DecouplingResult | null {
  const { avgHeartRate, paceSecPerKm, avgPowerWatts, splitPacesSec, durationSeconds } = params;
  if (!avgHeartRate) return null;

  if (splitPacesSec && splitPacesSec.length >= 4) {
    const mid = Math.floor(splitPacesSec.length / 2);
    const firstHalf = splitPacesSec.slice(0, mid);
    const secondHalf = splitPacesSec.slice(mid);
    const avgPace = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const pace1 = avgPace(firstHalf);
    const pace2 = avgPace(secondHalf);
    const ef1 = (1000 / pace1) * 60 / avgHeartRate;
    const ef2 = (1000 / pace2) * 60 / avgHeartRate;
    const decouplingPct = ((ef1 - ef2) / ef1) * 100;

    const fasterSecondHalf = pace2 < pace1;
    return {
      firstHalfEF: Math.round(ef1 * 1000) / 1000,
      secondHalfEF: Math.round(ef2 * 1000) / 1000,
      decouplingPct: Math.round(decouplingPct * 10) / 10,
      flag:
        decouplingPct > 5
          ? "decoupling"
          : fasterSecondHalf && pace1 - pace2 > 3
            ? "negative_split"
            : "stable",
      note:
        decouplingPct > 5
          ? `Aerobic decoupling ~${decouplingPct.toFixed(0)}% — HR drift vs pace in 2nd half`
          : fasterSecondHalf && pace1 - pace2 > 3
            ? "Negative split detected — faster second half"
            : "Pacing stable across splits",
    };
  }

  if (durationSeconds && durationSeconds >= 2400 && paceSecPerKm) {
    return {
      firstHalfEF: 0,
      secondHalfEF: 0,
      decouplingPct: 0,
      flag: "stable",
      note: "Add split data to unlock aerobic decoupling analysis",
    };
  }

  if (paceSecPerKm || avgPowerWatts) {
    const ef = calculateEfficiencyFactor({ avgHeartRate, paceSecPerKm, avgPowerWatts });
    if (!ef) return null;
    return {
      firstHalfEF: ef.efficiencyFactor,
      secondHalfEF: ef.efficiencyFactor,
      decouplingPct: 0,
      flag: "stable",
      note: "Single-segment session — EF computed from average pace/power",
    };
  }

  return null;
}
