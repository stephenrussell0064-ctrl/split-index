import type { ExternalActivity, ImportRowError } from "../types";

export interface TcxParseResult {
  activities: ExternalActivity[];
  errors: ImportRowError[];
}

function extractActivities(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<Activity[^>]*>([\s\S]*?)<\/Activity>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[0]);
  }
  return blocks;
}

function tagValue(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  return block.match(re)?.[1]?.trim();
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!m) return null;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseFloat(m[3] ?? "0");
  return h * 3600 + min * 60 + Math.round(s);
}

function detectSport(sportRaw: string | undefined): ExternalActivity["sport"] {
  const s = (sportRaw ?? "").toLowerCase();
  if (s.includes("bike") || s.includes("cycl")) return "indoor_cycling";
  if (s.includes("swim")) return "swimming";
  if (s.includes("row")) return "rowing";
  if (s.includes("walk")) return "walking";
  return "running";
}

function avgHrFromLaps(lapBlock: string): number | undefined {
  const hrs: number[] = [];
  const re = /<AverageHeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lapBlock)) !== null) {
    hrs.push(parseInt(m[1], 10));
  }
  if (hrs.length === 0) return undefined;
  return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
}

export function parseTcxContent(content: string, filename = "upload.tcx"): TcxParseResult {
  const errors: ImportRowError[] = [];
  const activities: ExternalActivity[] = [];

  if (!content.includes("<TrainingCenterDatabase") && !content.includes("<Activity")) {
    return { activities: [], errors: [{ message: "Invalid TCX file" }] };
  }

  const activityBlocks = extractActivities(content);

  activityBlocks.forEach((block, i) => {
    const sportRaw = block.match(/Sport="([^"]+)"/i)?.[1];
    const sport = detectSport(sportRaw);
    const id = tagValue(block, "Id") ?? tagValue(block, "StartTime");
    const lapMatch = block.match(/<Lap[^>]*StartTime="([^"]+)"[^>]*>([\s\S]*?)<\/Lap>/i);
    const startTime = lapMatch?.[1] ?? id;
    if (!startTime) {
      errors.push({ row: i + 1, message: "Missing activity start time" });
      return;
    }

    let durationSeconds = 0;
    let distanceMeters = 0;
    const lapRe = /<Lap[^>]*>([\s\S]*?)<\/Lap>/gi;
    let lap: RegExpExecArray | null;
    while ((lap = lapRe.exec(block)) !== null) {
      const lapInner = lap[0];
      const totalTime = tagValue(lapInner, "TotalTimeSeconds");
      if (totalTime) durationSeconds += parseInt(totalTime, 10);
      else {
        const iso = lapInner.match(/<Time[^>]*>([^<]+)<\/Time>/i)?.[1];
        const parsed = parseIsoDuration(iso);
        if (parsed) durationSeconds += parsed;
      }
      const dist = tagValue(lapInner, "DistanceMeters");
      if (dist) distanceMeters += parseFloat(dist);
    }

    if (durationSeconds <= 0) {
      errors.push({ row: i + 1, message: "Missing duration" });
      return;
    }

    const avgHr = avgHrFromLaps(block);
    const externalId = `tcx-${filename}-${i}-${startTime}`;

    activities.push({
      external_id: externalId,
      source: "file",
      sport,
      title: `${sport.replace("_", " ")} import`,
      started_at: new Date(startTime).toISOString(),
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters > 0 ? Math.round(distanceMeters) : undefined,
      avg_heart_rate: avgHr,
      notes: "Imported from TCX",
    });
  });

  return { activities, errors };
}
