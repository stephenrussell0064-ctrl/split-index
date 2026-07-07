/** Canonical SI conversions used at the API/service layer (forms submit metric). */

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const KG_PER_LB = 0.45359237;

export function milesToMeters(miles: number): number {
  return Math.round(miles * METERS_PER_MILE);
}

export function kmToMeters(km: number): number {
  return Math.round(km * METERS_PER_KM);
}

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function metersToKm(meters: number): number {
  return meters / METERS_PER_KM;
}

export function lbToKg(lb: number): number {
  return Math.round(lb * KG_PER_LB * 100) / 100;
}

export function kgToLb(kg: number): number {
  return Math.round((kg / KG_PER_LB) * 100) / 100;
}

/** Pace (sec/km) from speed in km/h. */
export function paceSecPerKmFromSpeedKmh(speedKmh: number): number | null {
  if (speedKmh <= 0) return null;
  return Math.round(3600 / speedKmh);
}

/** Speed (km/h) from pace in seconds per km. */
export function speedKmhFromPaceSecPerKm(paceSecPerKm: number): number | null {
  if (paceSecPerKm <= 0) return null;
  return Math.round((3600 / paceSecPerKm) * 10) / 10;
}

/** Round-trip km → miles → meters should match direct km → meters. */
export function normalizeDistanceToMeters(
  value: number,
  unit: "km" | "m" | "miles"
): number {
  switch (unit) {
    case "km":
      return kmToMeters(value);
    case "miles":
      return milesToMeters(value);
    case "m":
      return Math.round(value);
  }
}
