/**
 * Real elevation gain from an uploaded race-course GPX file (user feedback:
 * "I want this to take the data from as many online racing venues found as
 * possible with their recorded elevation gain"). No comprehensive, free,
 * universal database of race-course elevation profiles exists to pull
 * from automatically — but most race organizers publish an official course
 * GPX (or one can be pulled from Strava/a previous runner's upload), so
 * letting the athlete provide that file directly gives a real, accurate
 * number instead of a scraped or guessed one.
 *
 * Deliberately regex-based, not DOMParser — this needs to run identically
 * in the browser (no bundler-heavy XML library) and in tests (no jsdom
 * dependency wired into this project's Vitest config). GPX's <trkpt>/
 * <rtept> structure is simple and well-defined enough that this is a
 * legitimate, common lightweight approach, not a fragile hack.
 *
 * Same elevation-gain rule as live GPS tracking (gps-track.ts's
 * elevationGainMeters — sum of positive altitude deltas between
 * consecutive points) for consistency: one definition of "elevation gain"
 * across the whole app, not two.
 */
import { elevationGainMeters, type GpsPoint } from "./gps-track";

const POINT_BLOCK_RE = /<(trkpt|rtept)\s+([^>]*)>([\s\S]*?)<\/\1>/g;
const LAT_LON_RE = /lat="(-?[\d.]+)"|lon="(-?[\d.]+)"/g;
const ELE_RE = /<ele>\s*(-?[\d.]+)\s*<\/ele>/;

/**
 * Parses a GPX file's track/route points into the same GpsPoint shape live
 * GPS tracking uses, so elevationGainMeters() can be reused unchanged.
 * Returns null if the file has no parseable points at all.
 */
export function parseGpxPoints(gpxXmlText: string): GpsPoint[] | null {
  const points: GpsPoint[] = [];

  for (const match of gpxXmlText.matchAll(POINT_BLOCK_RE)) {
    const attrs = match[2];
    const body = match[3];

    let latitude: number | null = null;
    let longitude: number | null = null;
    for (const attrMatch of attrs.matchAll(LAT_LON_RE)) {
      if (attrMatch[1] !== undefined) latitude = Number(attrMatch[1]);
      if (attrMatch[2] !== undefined) longitude = Number(attrMatch[2]);
    }
    if (latitude === null || longitude === null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      continue;
    }

    const eleMatch = ELE_RE.exec(body);
    const altitude = eleMatch ? Number(eleMatch[1]) : null;

    points.push({
      latitude,
      longitude,
      accuracy: 0,
      altitude: altitude !== null && !Number.isNaN(altitude) ? altitude : null,
      time: points.length,
    });
  }

  return points.length > 0 ? points : null;
}

export interface GpxElevationResult {
  elevationGainMeters: number;
  pointCount: number;
  distanceMeters: number;
}

const EARTH_RADIUS_METERS = 6371000;
function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}
function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Full result from an uploaded GPX file — elevation gain (the primary
 * ask) plus distance and point count so the UI can show "detected a
 * 10.1km course with 213m of climbing" rather than just a bare number.
 * Returns null if the file has no usable points, or none of them carry
 * elevation data at all (a route-only GPX with no <ele> tags).
 */
export function computeGpxElevation(gpxXmlText: string): GpxElevationResult | null {
  const points = parseGpxPoints(gpxXmlText);
  if (!points) return null;

  const gain = elevationGainMeters(points);
  if (gain === null) return null;

  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += haversineMeters(points[i - 1], points[i]);

  return {
    elevationGainMeters: Math.round(gain),
    pointCount: points.length,
    distanceMeters: Math.round(distance),
  };
}
