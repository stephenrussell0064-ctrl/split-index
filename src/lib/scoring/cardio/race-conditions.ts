/**
 * Race-day condition adjustments (user feedback: "would it be possible to
 * have a section where people can enter the run event they are doing...
 * and Split Index would be able to give advice on the terrain, the
 * elevation and the weather on the day to give more specifically tailored
 * race predictions" — with a real example: predicted 39:00 for a 10K,
 * actually ran 40:33 on a flat course, attributed to heat and wind).
 *
 * Honesty first: these are order-of-magnitude, direction-correct
 * approximations grounded in commonly-cited running-physiology heuristics
 * (Minetti et al. 2002 for grade cost; the widely-cited "heat above ~12°C
 * ideal racing temp costs pace, longer races more than short" finding;
 * Pugh 1970 for the roughly-quadratic aerodynamic cost of wind) — NOT a
 * precise physical simulation. Nobody's model (including Garmin's) can
 * predict exactly how heat/wind affect a specific athlete on a specific
 * day; the honest goal here is "meaningfully closer than ignoring
 * conditions entirely," which the reported case (39:00 flat prediction,
 * ~4% too fast on a genuinely hot/windy day) already illustrates the gap
 * for. Every input is optional — provide only what you actually know
 * (elevation from the race's published profile, temperature/wind from a
 * forecast close to race day) and get adjustments for just that.
 */

/** Seconds of extra time per metre of net elevation gain, for a road race pace. Approximation — doesn't account for how the gain is distributed (one steep hill costs more than the same total spread gently, per Minetti's convex cost-of-grade curve), only total climb. */
const ELEVATION_SECONDS_PER_METER = 3.5;

/** Below this, heat isn't a meaningful factor — most runners are comfortable at or below typical UK/temperate racing conditions. */
const IDEAL_RACE_TEMP_CELSIUS = 12;
/** Per-°C-above-ideal pace penalty fraction, calibrated for a marathon-length effort (~180min) — scaled down for shorter races below. */
const MARATHON_HEAT_PENALTY_PER_DEGREE = 0.0025;
const MARATHON_REFERENCE_MINUTES = 180;
/** Even a 5K isn't immune to heat — floor the duration-scaling so short races still get *some* adjustment on a genuinely hot day. */
const MIN_HEAT_SCALE_FACTOR = 0.3;

/** Wind speed (km/h) at which the model treats conditions as "very windy" — used to scale the penalty, not a hard cutoff. */
const WIND_REFERENCE_KPH = 30;
/** Cap on the wind penalty fraction at/above the reference speed. */
const MAX_WIND_PENALTY_FRACTION = 0.05;

export interface RaceConditionInputs {
  distanceMeters: number;
  /** The athlete's own unadjusted prediction for this distance (from the existing race ladder) — what this function adjusts. */
  baseSeconds: number;
  /** Net elevation gain in metres over the course, if known (from the race's published profile). Null if unknown. */
  elevationGainMeters?: number | null;
  /** Forecast temperature at race time, if within forecast range (~10 days). Null if too far out or unknown. */
  forecastTempCelsius?: number | null;
  /** Forecast wind speed (km/h), same availability caveat as temperature. */
  forecastWindKph?: number | null;
}

export interface RaceConditionAdjustment {
  adjustedSeconds: number;
  elevationPenaltySeconds: number;
  temperaturePenaltySeconds: number;
  windPenaltySeconds: number;
  /** Plain-language notes on which adjustments actually applied, for display. Empty when no condition data was provided at all. */
  notes: string[];
}

function heatScaleFactor(baseSeconds: number): number {
  const minutes = baseSeconds / 60;
  return Math.max(MIN_HEAT_SCALE_FACTOR, Math.min(1, minutes / MARATHON_REFERENCE_MINUTES));
}

export function applyRaceConditionAdjustments(
  input: RaceConditionInputs
): RaceConditionAdjustment {
  const notes: string[] = [];
  let elevationPenaltySeconds = 0;
  let temperaturePenaltySeconds = 0;
  let windPenaltySeconds = 0;

  if (input.elevationGainMeters != null && input.elevationGainMeters > 0) {
    elevationPenaltySeconds = input.elevationGainMeters * ELEVATION_SECONDS_PER_METER;
    notes.push(
      `+${Math.round(elevationPenaltySeconds)}s for ${Math.round(input.elevationGainMeters)}m of climbing`
    );
  }

  if (input.forecastTempCelsius != null && input.forecastTempCelsius > IDEAL_RACE_TEMP_CELSIUS) {
    const degreesOver = input.forecastTempCelsius - IDEAL_RACE_TEMP_CELSIUS;
    const fraction = MARATHON_HEAT_PENALTY_PER_DEGREE * heatScaleFactor(input.baseSeconds) * degreesOver;
    temperaturePenaltySeconds = input.baseSeconds * fraction;
    notes.push(
      `+${Math.round(temperaturePenaltySeconds)}s for ${Math.round(input.forecastTempCelsius)}°C (${Math.round(degreesOver)}°C above ideal)`
    );
  }

  if (input.forecastWindKph != null && input.forecastWindKph > 0) {
    const fraction =
      Math.min(1, input.forecastWindKph / WIND_REFERENCE_KPH) ** 2 * MAX_WIND_PENALTY_FRACTION;
    windPenaltySeconds = input.baseSeconds * fraction;
    if (windPenaltySeconds > 0) {
      notes.push(`+${Math.round(windPenaltySeconds)}s for ${Math.round(input.forecastWindKph)}km/h wind`);
    }
  }

  return {
    adjustedSeconds: Math.round(
      input.baseSeconds + elevationPenaltySeconds + temperaturePenaltySeconds + windPenaltySeconds
    ),
    elevationPenaltySeconds: Math.round(elevationPenaltySeconds),
    temperaturePenaltySeconds: Math.round(temperaturePenaltySeconds),
    windPenaltySeconds: Math.round(windPenaltySeconds),
    notes,
  };
}
