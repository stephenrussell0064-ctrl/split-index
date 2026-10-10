import { Decoder, Stream } from "@garmin/fitsdk";
import {
  buildRoutePolyline,
  elevationGainMeters,
  type CadenceSample,
  type GpsPoint,
  type HrReading,
  type RoutePoint,
} from "@/lib/scoring/gps-track";
import { buildActivityStreams, type ActivityStreams } from "@/lib/analysis/streams";
import type { SportType } from "@/types";

/**
 * GPX, TCX and FIT files into the one shape the activities route scores.
 *
 * Phase 3 of the logging-effort plan: the path in for an athlete whose watch
 * does not write to Apple Health — Android, a Garmin export, a file a club
 * mate sent. Export-then-upload is friction of its own, so this is third
 * behind Apple Health and the one-tap gym log, but it is contained and it
 * makes the free tier's "file import" line true.
 *
 * Three formats, one result. Each parser reads what its format carries and
 * leaves the rest null; `toImportPreview` then derives what the scorer needs
 * (pace from distance and time, elevation gain by the app's one definition,
 * the route polyline and the per-sample streams by the same builders the
 * GPS run uses) so an imported run gets the same map, splits and score a
 * recorded one does.
 *
 * XML is read with regular expressions, as gpx-elevation.ts already does:
 * both schemas are simple enough, and it keeps the parsers identical in the
 * route and in tests. FIT is binary and goes through Garmin's own SDK.
 *
 * Pure. No I/O, no clock, no database. The route owns the file handling and
 * the dedup; this file owns the reading.
 */

export type ImportFileKind = "gpx" | "tcx" | "fit";

export interface ParsedWorkout {
  kind: ImportFileKind;
  /** What the file said it was, mapped to a sport, or null when the file did not say or said something Split Index does not score. */
  sport: SportType | null;
  /** The file's own word for the activity, for the preview when `sport` is null. */
  sportHint: string | null;
  startedAt: string;
  /** Moving time where the file distinguishes it, elapsed time otherwise. */
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  deviceName: string | null;
  points: GpsPoint[];
  hrReadings: HrReading[];
  cadenceSamples: CadenceSample[];
}

// ─── Detection ────────────────────────────────────────────────────────────

/** Which parser a file wants, by content first and the name second. */
export function detectImportFileKind(fileName: string, bytes: Uint8Array): ImportFileKind | null {
  if (bytes.length >= 12) {
    const magic = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (magic === ".FIT") return "fit";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096)).toLowerCase();
  if (head.includes("<gpx")) return "gpx";
  if (head.includes("<trainingcenterdatabase")) return "tcx";
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "gpx" || ext === "tcx" || ext === "fit") return ext;
  return null;
}

// ─── Sport words ──────────────────────────────────────────────────────────

/**
 * A file's word for its activity, to a sport. Strava writes GPX types as
 * words or as numbers (9 is running, 1 is cycling); TCX allows only
 * Running, Biking and Other; FIT has a long enum with sub-sports.
 */
export function sportFromHint(hint: string | null | undefined, subHint?: string | null): SportType | null {
  const h = (hint ?? "").trim().toLowerCase();
  const sub = (subHint ?? "").trim().toLowerCase();
  if (!h) return null;
  if (h === "9" || /run|jog|treadmill/.test(h)) return "running";
  if (h === "10" || /walk|hik/.test(h)) return "walking";
  if (h === "1" || /bik|cycl|ride|velo/.test(h)) {
    return /indoor|spin|virtual|trainer/.test(sub) || /indoor|virtual/.test(h) ? "indoor_cycling" : "outdoor_cycling";
  }
  if (h === "16" || /swim/.test(h)) return "swimming";
  if (/row/.test(h)) return "rowing";
  return null;
}

// ─── Shared helpers ───────────────────────────────────────────────────────

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

function trackDistance(points: GpsPoint[]): number | null {
  if (points.length < 2) return null;
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineMeters(points[i - 1], points[i]);
  return d;
}

function num(value: string | undefined | null): number | null {
  if (value == null) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value: string | undefined | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function tag(body: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${name}>`, "i").exec(body);
  return m ? m[1] : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summariseSamples(points: GpsPoint[], hr: HrReading[], cad: CadenceSample[]) {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const first = sorted[0]?.time ?? null;
  const last = sorted.at(-1)?.time ?? null;
  const bpm = hr.map((r) => r.bpm);
  return {
    spanSeconds: first != null && last != null && last > first ? Math.round((last - first) / 1000) : null,
    distance: trackDistance(sorted),
    elevation: elevationGainMeters(sorted),
    avgHr: mean(bpm),
    maxHr: bpm.length ? Math.max(...bpm) : null,
    avgCadence: mean(cad.map((c) => c.spm)),
    sorted,
  };
}

// ─── GPX ──────────────────────────────────────────────────────────────────

const GPX_POINT_RE = /<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>/gi;
const GPX_LAT_LON_RE = /lat="(-?[\d.]+)"|lon="(-?[\d.]+)"/g;

/**
 * A GPX track. Time comes from each point's <time>; heart rate and cadence
 * from the Garmin TrackPointExtension most exporters write (gpxtpx:hr,
 * gpxtpx:cad), with the bare <hr> some apps use as a fallback. Distance is
 * the track's own length, since GPX carries no total.
 */
export function parseGpxWorkout(xml: string): ParsedWorkout | null {
  const points: GpsPoint[] = [];
  const hrReadings: HrReading[] = [];
  const cadenceSamples: CadenceSample[] = [];

  for (const match of xml.matchAll(GPX_POINT_RE)) {
    const attrs = match[1];
    const body = match[2];
    let latitude: number | null = null;
    let longitude: number | null = null;
    for (const a of attrs.matchAll(GPX_LAT_LON_RE)) {
      if (a[1] !== undefined) latitude = Number(a[1]);
      if (a[2] !== undefined) longitude = Number(a[2]);
    }
    const time = isoOrNull(tag(body, "time"));
    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !time) {
      continue;
    }
    const t = Date.parse(time);
    const altitude = num(tag(body, "ele"));
    points.push({ latitude, longitude, accuracy: 0, altitude, time: t });
    const hr = num(tag(body, "gpxtpx:hr")) ?? num(tag(body, "ns3:hr")) ?? num(tag(body, "hr"));
    if (hr != null && hr > 0) hrReadings.push({ bpm: hr, time: t });
    const cad = num(tag(body, "gpxtpx:cad")) ?? num(tag(body, "ns3:cad")) ?? num(tag(body, "cad"));
    if (cad != null && cad > 0) cadenceSamples.push({ spm: cad, time: t });
  }
  if (points.length < 2) return null;

  const s = summariseSamples(points, hrReadings, cadenceSamples);
  const typeHint = tag(xml, "type") ?? null;
  const creator = /<gpx[^>]*\screator="([^"]*)"/i.exec(xml)?.[1] ?? null;
  return {
    kind: "gpx",
    sport: sportFromHint(typeHint),
    sportHint: typeHint,
    startedAt: new Date(s.sorted[0].time).toISOString(),
    durationSeconds: s.spanSeconds ?? 0,
    distanceMeters: s.distance,
    elevationGainMeters: s.elevation,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
    avgCadence: s.avgCadence,
    deviceName: creator,
    points: s.sorted,
    hrReadings,
    cadenceSamples,
  };
}

// ─── TCX ──────────────────────────────────────────────────────────────────

const TCX_LAP_RE = /<Lap\b[^>]*>([\s\S]*?)<\/Lap>/gi;
const TCX_TRACKPOINT_RE = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi;

/**
 * A TCX activity. Totals come from the laps (time, distance, heart rate),
 * which is what the recording device computed and beats re-deriving them
 * from points; the track is still read for the map, the streams and any
 * total a lap did not carry.
 */
export function parseTcxWorkout(xml: string): ParsedWorkout | null {
  const sportAttr = /<Activity\s+Sport="([^"]*)"/i.exec(xml)?.[1] ?? null;
  const points: GpsPoint[] = [];
  const hrReadings: HrReading[] = [];
  const cadenceSamples: CadenceSample[] = [];
  let lastDistance: number | null = null;

  for (const match of xml.matchAll(TCX_TRACKPOINT_RE)) {
    const body = match[1];
    const time = isoOrNull(tag(body, "Time"));
    if (!time) continue;
    const t = Date.parse(time);
    const lat = num(tag(body, "LatitudeDegrees"));
    const lon = num(tag(body, "LongitudeDegrees"));
    if (lat != null && lon != null) {
      points.push({ latitude: lat, longitude: lon, accuracy: 0, altitude: num(tag(body, "AltitudeMeters")), time: t });
    }
    const d = num(tag(body, "DistanceMeters"));
    if (d != null) lastDistance = d;
    const hrBlock = /<HeartRateBpm[^>]*>([\s\S]*?)<\/HeartRateBpm>/i.exec(body)?.[1];
    const hr = hrBlock ? num(tag(hrBlock, "Value")) : null;
    if (hr != null && hr > 0) hrReadings.push({ bpm: hr, time: t });
    const cad = num(tag(body, "Cadence")) ?? num(tag(body, "ns3:RunCadence"));
    if (cad != null && cad > 0) cadenceSamples.push({ spm: cad, time: t });
  }

  let lapSeconds = 0;
  let lapDistance = 0;
  let lapStart: string | null = null;
  const lapAvgHr: number[] = [];
  const lapMaxHr: number[] = [];
  let lapCount = 0;
  for (const lap of xml.matchAll(TCX_LAP_RE)) {
    lapCount += 1;
    const body = lap[1];
    lapStart ??= isoOrNull(/StartTime="([^"]*)"/i.exec(lap[0])?.[1]);
    lapSeconds += num(tag(body, "TotalTimeSeconds")) ?? 0;
    lapDistance += num(tag(body, "DistanceMeters")) ?? 0;
    const avg = /<AverageHeartRateBpm[^>]*>([\s\S]*?)<\/AverageHeartRateBpm>/i.exec(body)?.[1];
    const max = /<MaximumHeartRateBpm[^>]*>([\s\S]*?)<\/MaximumHeartRateBpm>/i.exec(body)?.[1];
    const a = avg ? num(tag(avg, "Value")) : null;
    const m = max ? num(tag(max, "Value")) : null;
    if (a != null) lapAvgHr.push(a);
    if (m != null) lapMaxHr.push(m);
  }

  const s = summariseSamples(points, hrReadings, cadenceSamples);
  const startedAt = lapStart ?? (s.sorted[0] ? new Date(s.sorted[0].time).toISOString() : null);
  if (!startedAt) return null;
  const durationSeconds = lapSeconds > 0 ? Math.round(lapSeconds) : (s.spanSeconds ?? 0);
  if (durationSeconds <= 0 && points.length < 2) return null;

  const creator = tag(/<Creator[^>]*>([\s\S]*?)<\/Creator>/i.exec(xml)?.[1] ?? "", "Name");
  return {
    kind: "tcx",
    sport: sportFromHint(sportAttr),
    sportHint: sportAttr,
    startedAt,
    durationSeconds,
    distanceMeters: lapDistance > 0 ? lapDistance : (lastDistance ?? s.distance),
    elevationGainMeters: s.elevation,
    avgHr: lapAvgHr.length === lapCount && lapCount > 0 ? mean(lapAvgHr) : s.avgHr,
    maxHr: lapMaxHr.length ? Math.max(...lapMaxHr) : s.maxHr,
    avgCadence: s.avgCadence,
    deviceName: creator,
    points: s.sorted,
    hrReadings,
    cadenceSamples,
  };
}

// ─── FIT ──────────────────────────────────────────────────────────────────

const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

interface FitSession {
  sport?: string;
  subSport?: string;
  startTime?: Date;
  totalElapsedTime?: number;
  totalTimerTime?: number;
  totalDistance?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  totalAscent?: number;
  avgCadence?: number;
  avgRunningCadence?: number;
}

interface FitRecord {
  timestamp?: Date;
  positionLat?: number;
  positionLong?: number;
  distance?: number;
  altitude?: number;
  enhancedAltitude?: number;
  heartRate?: number;
  cadence?: number;
}

/**
 * A FIT activity file, through Garmin's SDK. The session message is the
 * device's own summary and wins; records give the track. A FIT file can hold
 * several sessions (a triathlon); only the first is imported, and the
 * preview says so through `sportHint`.
 */
export function parseFitWorkout(bytes: Uint8Array): ParsedWorkout | null {
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) return null;
  const decoder = new Decoder(stream);
  const { messages } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  }) as { messages: { sessionMesgs?: FitSession[]; recordMesgs?: FitRecord[]; deviceInfoMesgs?: { productName?: string; manufacturer?: string }[] } };

  const session = messages.sessionMesgs?.[0];
  const records = messages.recordMesgs ?? [];
  const points: GpsPoint[] = [];
  const hrReadings: HrReading[] = [];
  const cadenceSamples: CadenceSample[] = [];
  let lastDistance: number | null = null;

  for (const r of records) {
    if (!(r.timestamp instanceof Date)) continue;
    const t = r.timestamp.getTime();
    if (typeof r.positionLat === "number" && typeof r.positionLong === "number") {
      const altitude = typeof r.enhancedAltitude === "number" ? r.enhancedAltitude : typeof r.altitude === "number" ? r.altitude : null;
      points.push({
        latitude: r.positionLat * SEMICIRCLES_TO_DEGREES,
        longitude: r.positionLong * SEMICIRCLES_TO_DEGREES,
        accuracy: 0,
        altitude,
        time: t,
      });
    }
    if (typeof r.distance === "number") lastDistance = r.distance;
    if (typeof r.heartRate === "number" && r.heartRate > 0) hrReadings.push({ bpm: r.heartRate, time: t });
    if (typeof r.cadence === "number" && r.cadence > 0) cadenceSamples.push({ spm: r.cadence, time: t });
  }

  const s = summariseSamples(points, hrReadings, cadenceSamples);
  const startedAt =
    session?.startTime instanceof Date
      ? session.startTime.toISOString()
      : s.sorted[0]
        ? new Date(s.sorted[0].time).toISOString()
        : records[0]?.timestamp instanceof Date
          ? records[0].timestamp.toISOString()
          : null;
  if (!startedAt) return null;

  const duration = Math.round(session?.totalTimerTime ?? session?.totalElapsedTime ?? s.spanSeconds ?? 0);
  if (duration <= 0) return null;

  const device = messages.deviceInfoMesgs?.find((d) => d.productName || d.manufacturer);
  const deviceName = device ? [device.manufacturer, device.productName].filter(Boolean).join(" ") || null : null;
  const sportHint = session?.sport ?? null;
  const sessionCount = messages.sessionMesgs?.length ?? 0;

  return {
    kind: "fit",
    sport: sportFromHint(sportHint, session?.subSport),
    sportHint: sessionCount > 1 ? `${sportHint ?? "activity"} (first of ${sessionCount} sessions)` : sportHint,
    startedAt,
    durationSeconds: duration,
    distanceMeters: session?.totalDistance ?? lastDistance ?? s.distance,
    elevationGainMeters: session?.totalAscent ?? s.elevation,
    avgHr: session?.avgHeartRate ?? s.avgHr,
    maxHr: session?.maxHeartRate ?? s.maxHr,
    avgCadence: session?.avgRunningCadence ?? session?.avgCadence ?? s.avgCadence,
    deviceName,
    points: s.sorted,
    hrReadings,
    cadenceSamples,
  };
}

// ─── One entry point ──────────────────────────────────────────────────────

export function parseWorkoutFile(kind: ImportFileKind, bytes: Uint8Array): ParsedWorkout | null {
  if (kind === "fit") return parseFitWorkout(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  return kind === "gpx" ? parseGpxWorkout(text) : parseTcxWorkout(text);
}

// ─── Preview ──────────────────────────────────────────────────────────────

export interface ImportPreviewFields {
  sport: SportType | null;
  sportHint: string | null;
  title: string;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number;
  elevation_meters?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
  avg_pace_seconds_per_km?: number;
}

export interface ImportPreview {
  fields: ImportPreviewFields;
  route: RoutePoint[] | null;
  streams: ActivityStreams | null;
  pointCount: number;
  deviceName: string | null;
}

const SPORT_WORD: Partial<Record<SportType, string>> = {
  running: "Run",
  walking: "Walk",
  outdoor_cycling: "Ride",
  indoor_cycling: "Indoor ride",
  swimming: "Swim",
  rowing: "Row",
};

/**
 * What the form would have built from this file: the scored fields, the
 * route and the streams. The same builders the GPS run uses, so an imported
 * run and a recorded one agree on what a map and a split are. A file with
 * no track (an indoor ride, a pool swim) gets fields and nothing else.
 */
export function toImportPreview(parsed: ParsedWorkout, fileName: string): ImportPreview {
  const duration = Math.max(1, Math.round(parsed.durationSeconds));
  const distance = parsed.distanceMeters != null && parsed.distanceMeters >= 10 ? Math.round(parsed.distanceMeters) : undefined;
  const title = parsed.sport
    ? `${SPORT_WORD[parsed.sport] ?? "Session"} from ${parsed.deviceName ?? fileName}`
    : `Imported from ${parsed.deviceName ?? fileName}`;
  const fields: ImportPreviewFields = {
    sport: parsed.sport,
    sportHint: parsed.sportHint,
    title,
    started_at: parsed.startedAt,
    duration_seconds: duration,
    ...(distance != null ? { distance_meters: distance } : {}),
    ...(parsed.elevationGainMeters != null && parsed.elevationGainMeters > 0
      ? { elevation_meters: Math.round(parsed.elevationGainMeters) }
      : {}),
    ...(parsed.avgHr != null && parsed.avgHr >= 30 ? { avg_heart_rate: Math.round(parsed.avgHr) } : {}),
    ...(parsed.maxHr != null && parsed.maxHr >= 30 ? { max_heart_rate: Math.round(parsed.maxHr) } : {}),
    ...(parsed.avgCadence != null && parsed.avgCadence > 0 ? { avg_cadence: Math.round(parsed.avgCadence) } : {}),
    ...(distance != null ? { avg_pace_seconds_per_km: Math.round((duration / distance) * 1000) } : {}),
  };
  const hasTrack = parsed.points.length >= 2;
  return {
    fields,
    route: hasTrack ? buildRoutePolyline(parsed.points) : null,
    streams: hasTrack
      ? buildActivityStreams({
          points: parsed.points,
          pauses: [],
          hrReadings: parsed.hrReadings,
          cadenceSamples: parsed.cadenceSamples,
        })
      : null,
    pointCount: parsed.points.length,
    deviceName: parsed.deviceName,
  };
}
