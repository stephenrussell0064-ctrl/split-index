import type {
  Activity,
  PersonalRecord,
  SplitIndexSnapshot,
  SportType,
} from "@/types";

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
}

export interface StrengthEstimate {
  exerciseName: string;
  estimated1RmKg: number;
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
