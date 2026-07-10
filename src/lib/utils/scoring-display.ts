import { REFERENCE_WATTS_PER_KG } from "@/lib/scoring/constants";
import { referencePaceForSport } from "@/lib/scoring/engine";
import { EXRX_TIER_LABELS, type ExRxTier } from "@/lib/scoring/strength/ratio-tiers";
import type { EnduranceSport, ExperienceLevel, Gender, SportType } from "@/types";
import { formatPace } from "@/lib/utils/format";

/** e.g. 1.23 → "1.2× bodyweight" */
export function formatRelativeStrength(ratio: number, short = false): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  const formatted = ratio.toFixed(1);
  return short ? `${formatted}× BW` : `${formatted}× bodyweight`;
}

/** e.g. "Squat: 1.5× bodyweight" */
export function formatLiftRelativeStrength(
  exerciseName: string,
  ratio: number
): string {
  return `${exerciseName}: ${formatRelativeStrength(ratio)}`;
}

/** Format DOTS score for display (1 decimal). */
export function formatDOTS(dots: number): string {
  if (!Number.isFinite(dots) || dots <= 0) return "—";
  return dots.toFixed(1);
}

/** Format IPF GL Points for display (1 decimal). */
export function formatGL(glPoints: number): string {
  if (!Number.isFinite(glPoints) || glPoints <= 0) return "—";
  return glPoints.toFixed(1);
}

/** ExRx tier label for accessory lifts. */
export function formatExRxTier(tier: ExRxTier): string {
  return EXRX_TIER_LABELS[tier];
}

/** Headline copy for gym session success screen. */
export function formatStrengthHeadline(
  dots: number,
  useGL: boolean,
  glPoints?: number
): string {
  if (useGL && glPoints) {
    return `IPF GL ${formatGL(glPoints)} · Strength Index from GL`;
  }
  return `DOTS ${formatDOTS(dots)} · bodyweight-adjusted total`;
}

/** Split Index breakdown copy: "412 cardio + 388 strength" */
export function formatSplitBreakdown(
  enduranceIndex: number,
  strengthIndex: number,
  enduranceWeightPct = 50
): string {
  const strPct = 100 - enduranceWeightPct;
  return `${Math.round(enduranceIndex)} cardio + ${Math.round(strengthIndex)} strength (${enduranceWeightPct}/${strPct})`;
}

/** Per-lift breakdown line with optional ExRx tier. */
export function formatLiftBreakdownLine(
  name: string,
  estimated1RM: number,
  relativeStrength: number,
  tierLabel?: string
): string {
  const base = `${name}: ${estimated1RM.toFixed(1)} kg (${relativeStrength.toFixed(2)}× BW)`;
  return tierLabel ? `${base} · ${tierLabel}` : base;
}

/** Compare actual pace to reference — positive = faster than benchmark */
export function paceVsBenchmarkPercent(
  actualSecPerKm: number,
  refSecPerKm: number
): number {
  if (actualSecPerKm <= 0 || refSecPerKm <= 0) return 0;
  return Math.round(((refSecPerKm - actualSecPerKm) / refSecPerKm) * 100);
}

export function formatPaceBenchmarkContext(
  sport: EnduranceSport,
  actualSecPerKm: number,
  gender: Gender | null,
  experience: ExperienceLevel | null
): string {
  const ref = referencePaceForSport(sport, gender, experience);
  const pct = paceVsBenchmarkPercent(actualSecPerKm, ref);
  const exp = experience ?? "intermediate";
  const label =
    sport === "running"
      ? `${exp} 5k benchmark`
      : `${sport.replace("_", " ")} reference pace`;

  if (Math.abs(pct) < 1) return `On par with ${label} (${formatPace(ref)})`;
  if (pct > 0) return `${pct}% faster than ${label} (${formatPace(ref)})`;
  return `${Math.abs(pct)}% slower than ${label} (${formatPace(ref)})`;
}

export function formatPowerBenchmarkContext(wattsPerKg: number): string {
  const pct = Math.round(
    ((wattsPerKg - REFERENCE_WATTS_PER_KG) / REFERENCE_WATTS_PER_KG) * 100
  );
  if (Math.abs(pct) < 1) {
    return `On par with intermediate benchmark (${REFERENCE_WATTS_PER_KG} W/kg)`;
  }
  if (pct > 0) {
    return `${pct}% above intermediate benchmark (${REFERENCE_WATTS_PER_KG} W/kg)`;
  }
  return `${Math.abs(pct)}% below intermediate benchmark (${REFERENCE_WATTS_PER_KG} W/kg)`;
}

export function formatHistoryPercentileContext(
  sportLabel: string,
  percentile: number,
  total: number
): string {
  if (total === 0) return `First ${sportLabel.replace(" Index", "")} session logged`;
  return `Your session ranks at the ${percentile}th percentile of your last ${Math.min(total, 10)} ${sportLabel.replace(" Index", "").toLowerCase()} sessions`;
}

export function sportMetricLabel(sport: SportType): string {
  switch (sport) {
    case "running":
    case "walking":
      return "pace";
    case "swimming":
      return "pace per 100m";
    case "rowing":
    case "ski_erg":
      return "split / 500m";
    case "bike_erg":
    case "indoor_cycling":
      return "power";
    case "gym":
      return "relative strength";
    default:
      return "performance";
  }
}
