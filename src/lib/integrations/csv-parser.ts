import type { SessionType, SportType } from "@/types";
import type { ExternalActivity, ImportRowError } from "./types";

const SPORT_KEYWORDS: { keywords: string[]; sport: SportType }[] = [
  { keywords: ["run", "running", "jog"], sport: "running" },
  { keywords: ["walk", "walking", "hike"], sport: "walking" },
  { keywords: ["swim", "swimming"], sport: "swimming" },
  { keywords: ["row", "rowing", "erg"], sport: "rowing" },
  { keywords: ["bike", "cycling", "cycle", "ride", "bicycle"], sport: "indoor_cycling" },
  { keywords: ["ski", "skierg"], sport: "ski_erg" },
  { keywords: ["gym", "weight", "strength", "lift"], sport: "gym" },
];

const SESSION_KEYWORDS: Record<string, SessionType> = {
  easy: "easy",
  recovery: "recovery",
  tempo: "tempo",
  threshold: "threshold",
  interval: "interval",
  race: "race",
  long: "long",
};

interface ParsedCsv {
  activities: ExternalActivity[];
  errors: ImportRowError[];
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function detectSport(raw: string | undefined): SportType {
  const value = (raw ?? "").toLowerCase();
  for (const { keywords, sport } of SPORT_KEYWORDS) {
    if (keywords.some((k) => value.includes(k))) return sport;
  }
  return "running";
}

function parseDuration(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    const h = colonMatch[3] ? parseInt(colonMatch[1], 10) : 0;
    const m = colonMatch[3] ? parseInt(colonMatch[2], 10) : parseInt(colonMatch[1], 10);
    const s = colonMatch[3] ? parseInt(colonMatch[3], 10) : parseInt(colonMatch[2], 10);
    return h * 3600 + m * 60 + s;
  }

  const hmMatch = trimmed.match(/^(\d+)h\s*(\d+)m?$/i);
  if (hmMatch) {
    return parseInt(hmMatch[1], 10) * 3600 + parseInt(hmMatch[2], 10) * 60;
  }

  const minMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*min/i);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);

  return null;
}

function parseDistanceMeters(value: string | undefined, unit?: string): number | null {
  if (!value?.trim()) return null;
  const num = parseFloat(value.replace(/,/g, ""));
  if (Number.isNaN(num)) return null;

  const u = (unit ?? value).toLowerCase();
  if (u.includes("km") || u.includes("kilometer")) return num * 1000;
  if (u.includes("mi") || u.includes("mile")) return num * 1609.34;
  if (u.includes("m") && !u.includes("km")) return num;
  if (num < 50) return num * 1000;
  return num;
}

function parseDate(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function pickField(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = row[key];
    if (val?.trim()) return val;
  }
  return undefined;
}

function parseSessionType(value: string | undefined): SessionType | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  return SESSION_KEYWORDS[normalized];
}

export function parseCsvContent(content: string, filename?: string): ParsedCsv {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      activities: [],
      errors: [{ message: "CSV must include a header row and at least one data row" }],
    };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const activities: ExternalActivity[] = [];
  const errors: ImportRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.every((v) => !v)) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });

    const dateRaw = pickField(row, [
      "date",
      "started_at",
      "start_date",
      "activity_date",
      "datetime",
      "time",
    ]);
    const startedAt = parseDate(dateRaw);
    const durationRaw = pickField(row, ["duration", "duration_seconds", "elapsed_time", "time_elapsed"]);
    const durationSeconds = parseDuration(durationRaw);

    if (!startedAt) {
      errors.push({ row: i + 1, message: "Missing or invalid date" });
      continue;
    }
    if (!durationSeconds || durationSeconds <= 0) {
      errors.push({ row: i + 1, message: "Missing or invalid duration" });
      continue;
    }

    const sportRaw = pickField(row, ["sport", "activity_type", "type", "workout_type"]);
    const sport = detectSport(sportRaw);
    const distanceRaw = pickField(row, ["distance", "distance_meters", "distance_km", "distance_mi"]);
    const distanceUnit = pickField(row, ["distance_unit", "unit"]);
    const distanceMeters = parseDistanceMeters(distanceRaw, distanceUnit ?? distanceRaw);

    const avgHrRaw = pickField(row, ["avg_heart_rate", "average_hr", "hr", "heart_rate"]);
    const maxHrRaw = pickField(row, ["max_heart_rate", "max_hr"]);
    const elevationRaw = pickField(row, ["elevation", "elevation_meters", "elevation_gain"]);
    const title = pickField(row, ["title", "name", "activity_name"]);
    const notes = pickField(row, ["notes", "description"]);
    const sessionRaw = pickField(row, ["session_type", "intensity"]);
    const exerciseName = pickField(row, ["exercise", "exercise_name", "lift", "movement"]);
    const setsRaw = pickField(row, ["sets", "set"]);
    const repsRaw = pickField(row, ["reps", "rep", "repetitions"]);
    const weightRaw = pickField(row, ["weight", "weight_kg", "load_kg"]);

    const externalId =
      pickField(row, ["external_id", "id", "activity_id"]) ??
      `csv-${filename ?? "upload"}-${i}-${startedAt}`;

    const isGymRow =
      sport === "gym" ||
      Boolean(exerciseName && (setsRaw || repsRaw || weightRaw));

    if (isGymRow) {
      const activity: ExternalActivity = {
        external_id: externalId,
        source: "csv",
        sport: "gym",
        title: title ?? "Gym import",
        started_at: startedAt,
        duration_seconds: durationSeconds,
        session_type: parseSessionType(sessionRaw),
        notes: notes ?? undefined,
        exercises: exerciseName
          ? [
              {
                exercise_name: exerciseName,
                muscle_group: pickField(row, ["muscle_group", "muscle"]) ?? "Other",
                sets: Array.from(
                  { length: setsRaw ? parseInt(setsRaw, 10) : 1 },
                  () => ({
                    weight_kg: weightRaw ? parseFloat(weightRaw) : 0,
                    reps: repsRaw ? parseInt(repsRaw, 10) : 1,
                    rpe: null,
                  })
                ),
                order_index: 0,
              },
            ]
          : [],
      };
      activities.push(activity);
      continue;
    }

    const activity: ExternalActivity = {
      external_id: externalId,
      source: "csv",
      sport,
      title: title ?? `${sport.replace("_", " ")} import`,
      started_at: startedAt,
      duration_seconds: durationSeconds,
      distance_meters: distanceMeters ?? undefined,
      elevation_meters: elevationRaw ? parseFloat(elevationRaw) : undefined,
      avg_heart_rate: avgHrRaw ? parseInt(avgHrRaw, 10) : undefined,
      max_heart_rate: maxHrRaw ? parseInt(maxHrRaw, 10) : undefined,
      session_type: parseSessionType(sessionRaw),
      notes: notes ?? undefined,
    };

    activities.push(activity);
  }

  return { activities, errors };
}

export function validateActivities(activities: ExternalActivity[]): ImportRowError[] {
  const errors: ImportRowError[] = [];
  activities.forEach((a, idx) => {
    if (!a.external_id) {
      errors.push({ row: idx + 1, message: "Missing external_id" });
    }
    if (a.duration_seconds <= 0) {
      errors.push({ row: idx + 1, external_id: a.external_id, message: "Invalid duration" });
    }
  });
  return errors;
}
