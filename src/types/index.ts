export type SportType =
  | "running"
  | "walking"
  | "swimming"
  | "rowing"
  | "bike_erg"
  | "indoor_cycling"
  | "ski_erg"
  | "gym";

export type EnduranceSport = Exclude<SportType, "gym">;

export type SportCategory = "endurance" | "strength";

/** Row in the `sports` reference table (slug mirrors the sport_type enum). */
export interface Sport {
  id: number;
  slug: SportType;
  name: string;
  category: SportCategory;
  icon: string | null;
  description: string | null;
  supports_distance: boolean;
  display_order: number;
  is_active: boolean;
}

export type SessionType =
  | "easy"
  | "recovery"
  | "tempo"
  | "threshold"
  | "interval"
  | "race"
  | "long"
  | "other";

export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

export type ExperienceLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "elite";

export type TrainingGoal =
  | "general_fitness"
  | "hybrid_performance"
  | "endurance"
  | "strength"
  | "weight_loss"
  | "competition";

export type SubscriptionTier = "free" | "premium";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface Profile {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  max_hr: number | null;
  gender: Gender | null;
  experience: ExperienceLevel | null;
  training_history_years: number | null;
  goals: TrainingGoal[];
  preferred_sports: SportType[];
  onboarding_completed: boolean;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
  /** Endurance weight for Split Index blend (0–1). Strength = 1 − this. Default 0.50. */
  split_endurance_weight?: number;
  index_updated_at: string | null;
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus | null;
  stripe_customer_id: string | null;
  /** IANA timezone for local-day workout grouping (e.g. Europe/London). */
  timezone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  user_id: string;
  sport: SportType;
  title: string | null;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_power_watts: number | null;
  avg_cadence: number | null;
  avg_pace_seconds_per_km: number | null;
  avg_split_seconds: number | null;
  stroke_type: string | null;
  temperature_celsius: number | null;
  session_type: SessionType | null;
  rpe: number | null;
  notes: string | null;
  source:
    | "manual"
    | "strava"
    | "garmin"
    | "apple_health"
    | "polar"
    | "coros"
    | "fitbit"
    | "csv"
    | "file";
  external_id: string | null;
  is_draft: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** A single working set — weight and reps rarely stay uniform across a whole exercise. */
export interface GymExerciseSet {
  weight_kg: number;
  reps: number;
  rpe?: number | null;
}

export interface GymExercise {
  id: string;
  activity_id: string;
  exercise_name: string;
  muscle_group: string;
  /** Best-set summary (kept in sync for backward compatibility) — see set_details for the full breakdown. */
  weight_kg: number;
  sets: number;
  reps: number;
  rpe: number | null;
  /** Full per-set breakdown; null for legacy rows logged before this existed. */
  set_details: GymExerciseSet[] | null;
  estimated_1rm_kg: number | null;
  order_index: number;
}

/** Payload shape for creating/updating a gym exercise — the client sends the real per-set data, not a pre-computed summary. */
export interface GymExerciseInput {
  exercise_name: string;
  muscle_group: string;
  sets: GymExerciseSet[];
  order_index: number;
}

export interface WorkoutScore {
  id: string;
  activity_id: string;
  user_id: string;
  sport: SportType;
  sport_index: number;
  endurance_component: number | null;
  strength_component: number | null;
  fatigue_impact: number;
  load_score: number;
  score_breakdown: ScoreBreakdown;
  created_at: string;
}

export interface ScoreBreakdown {
  base_score?: number;
  pace_factor?: number;
  distance_factor?: number;
  duration_factor?: number;
  elevation_factor?: number;
  hr_efficiency?: number;
  temperature_factor?: number;
  fatigue_multiplier?: number;
  session_type_modifier?: number;
  relative_strength?: number;
  volume_load?: number;
  rpe_adjustment?: number;
  /** DOTS score (primary strength headline) */
  dots_score?: number;
  /** IPF GL Points (secondary toggle) */
  gl_points?: number;
  use_gl?: boolean;
  strength_total_kg?: number;
  per_lift?: Record<
    string,
    { estimated1RM: number; relativeStrength: number } | undefined
  >;
  final_sport_index?: number;
  explanation: string[];
  /** V2 cardio engine output (full object persisted for re-runs) */
  cardio_activity?: import("@/lib/scoring/cardio-activity").CardioResult;
  /** Per-exercise strength engine outputs */
  strength_activities?: import("@/lib/scoring/split-strength-engine").ScoreStrengthResult[];
  /** V2 index aggregation snapshot */
  index_result?: import("@/lib/scoring/index-engine").IndexResult;
  /** Phase 2 additive cardio enrichment (display layer) */
  cardio_enrichment?: Record<string, unknown>;
}

export interface SessionTemplate {
  id: string;
  user_id: string;
  name: string;
  sport: SportType;
  template_data: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface SplitIndexSnapshot {
  id: string;
  user_id: string;
  split_index: number;
  endurance_index: number;
  strength_index: number;
  fatigue_score: number;
  recovery_score: number;
  predicted_index_7d: number | null;
  activity_id: string | null;
  recorded_at: string;
}

export interface AIFeedback {
  id: string;
  activity_id: string;
  user_id: string;
  performance_explanation: string;
  recovery_advice: string;
  next_workout_recommendation: string;
  long_term_insight: string;
  score_change_reason: string;
  created_at: string;
}

export interface PersonalRecord {
  id: string;
  user_id: string;
  sport: SportType;
  metric: string;
  value: number;
  unit: string;
  activity_id: string | null;
  achieved_at: string;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  sport: SportType | null;
  metric: string;
  target_value: number;
  start_date: string;
  end_date: string;
  is_global: boolean;
  created_by: string | null;
}

export type FriendStatus = "pending" | "accepted" | "blocked";

/** Row in the `friends` table: a friend request and its lifecycle status. */
export interface FriendRequest {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendStatus;
  created_at: string;
}

/** @deprecated Use FriendRequest. */
export type Friend = FriendRequest;

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BodyMetric {
  id: string;
  user_id: string;
  weight_kg: number;
  body_fat_percent: number | null;
  recorded_at: string;
}

/** Per-exercise strength scoring for a session (strength_scores table). */
export interface StrengthScore {
  id: string;
  user_id: string;
  activity_id: string;
  gym_exercise_id: string | null;
  exercise_name: string;
  muscle_group: string | null;
  estimated_1rm_kg: number;
  bodyweight_kg: number | null;
  relative_strength: number | null;
  volume_load_kg: number | null;
  strength_index: number;
  score_breakdown: Record<string, unknown>;
  recorded_at: string;
}

/**
 * Scoring-engine benchmark standard (reference_values table), e.g. expected
 * 5k pace or big-3 1RM/bodyweight ratio for a gender × experience bracket.
 */
export interface ReferenceValue {
  id: string;
  sport: SportType;
  metric: string;
  gender: Gender;
  experience: ExperienceLevel;
  age_min: number | null;
  age_max: number | null;
  value: number;
  unit: string;
  notes: string | null;
}

export interface SleepLog {
  id: string;
  user_id: string;
  sleep_date: string;
  bed_time: string | null;
  wake_time: string | null;
  sleep_hours: number;
  /** 1 (poor) to 5 (excellent) */
  quality: number | null;
  notes: string | null;
  created_at: string;
}

export type LeaderboardPeriod = "weekly" | "monthly" | "all_time";

/** Precomputed ranking row (leaderboard_entries table). */
export interface LeaderboardEntry {
  id: string;
  user_id: string;
  period: LeaderboardPeriod;
  period_start: string;
  split_index: number;
  endurance_index: number | null;
  strength_index: number | null;
  rank: number;
  previous_rank: number | null;
  computed_at: string;
}

export interface RecoverySnapshot {
  id: string;
  user_id: string;
  recovery_score: number;
  fatigue_score: number;
  sleep_hours: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  recorded_at: string;
}

export interface OnboardingData {
  age: number;
  height_cm: number;
  weight_kg: number;
  max_hr: number;
  gender: Gender;
  experience: ExperienceLevel;
  training_history_years: number;
  goals: TrainingGoal[];
  preferred_sports: SportType[];
}

export interface DashboardData {
  currentSplitIndex: number;
  enduranceIndex: number;
  strengthIndex: number;
  weeklyTrend: number;
  monthlyTrend: number;
  predictedIndex: number;
  recoveryScore: number;
  fatigueScore: number;
  latestWorkouts: Activity[];
  latestScores: WorkoutScore[];
  aiFeedback: AIFeedback | null;
  indexHistory: SplitIndexSnapshot[];
}

export interface ActivityFormData {
  sport: SportType;
  title?: string;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number;
  elevation_meters?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_power_watts?: number;
  avg_cadence?: number;
  avg_pace_seconds_per_km?: number;
  avg_split_seconds?: number;
  stroke_type?: string;
  temperature_celsius?: number;
  session_type?: SessionType;
  rpe?: number;
  notes?: string;
  exercises?: GymExerciseInput[];
}
