import type {
  Activity,
  PersonalRecord,
  SplitIndexSnapshot,
  SportType,
} from "@/types";
import type { RaceRecord } from "@/lib/scoring/race-records";
import type { OverallDotsGlResult } from "@/lib/scoring/strength/overall-dots-gl";

export type SportFilter = "all" | SportType;

export type TrendGranularity = "week" | "month" | "year";

export type PeriodPreset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "custom";

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export interface AnalyticsActivity {
  id: string;
  sport: SportType;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  session_type: Activity["session_type"];
  rpe: number | null;
}

export interface AnalyticsScore {
  activity_id: string;
  sport: SportType;
  sport_index: number;
  load_score: number;
  created_at: string;
}

export interface PredictedBenchmark {
  sport: "run" | "walk" | "row" | "swim" | "cycle" | "ski";
  benchmarkSeconds: number;
  sampleCount: number;
  updatedAt: string;
  /** This athlete's own personalized Riegel exponent (see personalizedRiegelK in cardio-predictions.ts) — null until enough cross-distance evidence exists, in which case the ladder falls back to a generic experience-tier k. */
  riegelK?: number | null;
}

export interface StrengthEstimate {
  exerciseName: string;
  estimated1RmKg: number;
  /** Best ever achieved on this lift — mined from every session's stored 1RM, so it is a true high-water mark rather than whatever the most recent session implied. */
  allTime1RmKg: number;
  /** What recent training says the athlete could lift today — falls after a worse block. See split-strength-engine.ts. */
  current1RmKg: number;
  trend?: "up" | "down" | "flat";
  confidence?: number;
  bandKg?: [number, number];
  recordedAt: string;
}

export interface AnalyticsPayload {
  isPremium: boolean;
  maxHr: number | null;
  timezone?: string | null;
  targetSessionsPerWeek: number;
  indexHistory: SplitIndexSnapshot[];
  activities: AnalyticsActivity[];
  scores: AnalyticsScore[];
  personalRecords: PersonalRecord[];
  predictedBenchmarks: PredictedBenchmark[];
  strengthEstimates: StrengthEstimate[];
  /** Optional HRV (rMSSD, ms) — most recent reading and rolling baseline average of the preceding readings. Null when the user hasn't logged any. */
  hrvToday: number | null;
  hrvBaseline: number | null;
  /**
   * Article 9 explicit consent. Gates the injury Risk Index, which states a
   * conclusion about the athlete's physical condition rather than reporting a
   * number they logged — see src/lib/consent/article9.ts.
   */
  article9Consent: boolean;
  /** Best-ever time per standard race distance, mined from the athlete's own logged activities (race-records.ts) — not gated by premium, same as the rest of Personal Records. */
  raceRecords: RaceRecord[];
  /** Profile-wide best-ever SBD DOTS/GL (overall-dots-gl.ts) — null until bodyweight is set. Gated by `showDotsGl`, same premium feature as the Lab page's own DOTS/GL card. */
  overallDotsGl: OverallDotsGlResult | null;
  showDotsGl: boolean;
}

export interface PeriodMetrics {
  label: string;
  avgSplit: number;
  avgEndurance: number;
  avgStrength: number;
  avgRecovery: number;
  avgFatigue: number;
  totalLoad: number;
  totalDuration: number;
  totalDistance: number;
  sessions: number;
  consistencyPct: number;
}

export interface TrendPoint {
  date: string;
  split: number;
  endurance: number;
  strength: number;
}

export interface MovingAveragePoint {
  date: string;
  split: number;
  splitMa7: number | null;
  splitMa28: number | null;
  enduranceMa7: number | null;
  strengthMa7: number | null;
}

export interface ProjectionPoint {
  date: string;
  split: number | null;
  projected: number | null;
  isForecast: boolean;
}

export interface FatigueRecoveryPoint {
  date: string;
  fatigue: number;
  recovery: number;
  acwr: number | null;
}

export interface VolumeWeek {
  week: string;
  load: number;
  duration: number;
  distance: number;
  sessions: number;
}

export interface DistributionSlice {
  name: string;
  value: number;
  color: string;
}

export interface HeatmapDay {
  date: string;
  load: number;
  workouts: number;
}
