/**
 * GPX parser — uses DOMParser (server-safe via @xmldom or native).
 * Node 20+ and Next.js server routes expose DOMParser via undici/jsdom in some setups;
 * we parse with regex + simple XML traversal for zero deps.
 */

import type { ExternalActivity } from "../types";

export interface GpxParseResult {
  activities: ExternalActivity[];
  errors: { message: string }[];
}

interface TrackPoint {
  lat: number;
  lon: number;
  time?: string;
  ele?: number;
  hr?: number;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const m = block.match(re);
  return m?.[1]?.trim();
}

function parseTrackPoints(xml: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  const trkptRe = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
  let match: RegExpExecArray | null;
  while ((match = trkptRe.exec(xml)) !== null) {
    const inner = match[3];
    points.push({
      lat: parseFloat(match[1]),
      lon: parseFloat(match[2]),
      time: extractTag(inner, "time"),
      ele: parseTagNum(inner, "ele"),
      hr: extractHr(inner),
    });
  }
  return points;
}

function parseTagNum(block: string, tag: string): number | undefined {
  const v = extractTag(block, tag);
  if (!v) return undefined;
  const n = parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}

function extractHr(block: string): number | undefined {
  const ext = block.match(/<gpxtpx:hr>(\d+)<\/gpxtpx:hr>/i) ?? block.match(/<hr>(\d+)<\/hr>/i);
  if (ext) return parseInt(ext[1], 10);
  return undefined;
}

function trackPointsToActivity(points: TrackPoint[], filename: string, index: number): ExternalActivity | null {
  if (points.length < 2) return null;

  let distance = 0;
  let elevationGain = 0;
  const hrSamples: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    distance += haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
    if (prev.ele !== undefined && curr.ele !== undefined && curr.ele > prev.ele) {
      elevationGain += curr.ele - prev.ele;
    }
    if (curr.hr) hrSamples.push(curr.hr);
  }

  const startTime = points.find((p) => p.time)?.time;
  const endTime = [...points].reverse().find((p) => p.time)?.time;
  if (!startTime) return null;

  let durationSeconds = 0;
  if (endTime) {
    durationSeconds = Math.round(
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000
    );
  }
  if (durationSeconds <= 0) durationSeconds = Math.max(60, Math.round(distance / 3));

  const avgHr =
    hrSamples.length > 0
      ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length)
      : undefined;

  const nameMatch = filename.match(/([^/\\]+)\.gpx$/i);

  return {
    external_id: `gpx-${filename}-${index}-${startTime}`,
    source: "file",
    sport: "running",
    title: nameMatch?.[1] ?? "GPX import",
    started_at: new Date(startTime).toISOString(),
    duration_seconds: durationSeconds,
    distance_meters: Math.round(distance),
    elevation_meters: elevationGain > 0 ? Math.round(elevationGain) : undefined,
    avg_heart_rate: avgHr,
    notes: "Imported from GPX",
  };
}

export function parseGpxContent(content: string, filename = "upload.gpx"): GpxParseResult {
  const errors: { message: string }[] = [];
  const activities: ExternalActivity[] = [];

  if (!content.includes("<gpx") && !content.includes("<trkpt")) {
    return { activities: [], errors: [{ message: "Invalid GPX file" }] };
  }

  const trkSegments = content.split(/<trkseg[^>]*>/i).slice(1);
  const segments =
    trkSegments.length > 0
      ? trkSegments.map((seg) => parseTrackPoints(`<trkseg>${seg}`))
      : [parseTrackPoints(content)];

  segments.forEach((pts, i) => {
    const activity = trackPointsToActivity(pts, filename, i);
    if (activity) activities.push(activity);
    else if (pts.length > 0) errors.push({ message: `Track segment ${i + 1}: insufficient data` });
  });

  return { activities, errors };
}
