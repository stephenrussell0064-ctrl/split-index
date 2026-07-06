import { COACH_SYSTEM_PROMPT, getOpenAI, hasOpenAIKey } from "@/lib/openai/client";
import type {
  Activity,
  GymExercise,
  ScoreBreakdown,
  SessionType,
  SportType,
  WorkoutScore,
} from "@/types";

export interface RecentActivitySummary {
  sport: SportType;
  started_at: string;
  duration_seconds: number;
  sport_index: number;
  load_score: number;
  session_type: SessionType | null;
}

export interface IndexHistoryEntry {
  split_index: number;
  endurance_index: number;
  strength_index: number;
  fatigue_score: number;
  recovery_score: number;
  predicted_index_7d: number | null;
  recorded_at: string;
}

export interface CoachInput {
  activity: Activity;
  score: WorkoutScore;
  previousSplitIndex: number;
  currentSplitIndex: number;
  enduranceIndex: number;
  strengthIndex: number;
  fatigueScore: number;
  recoveryScore: number;
  predictedIndex: number;
  recentLoads: { acute: number; chronic: number };
  indexHistory: IndexHistoryEntry[];
  recentActivities: RecentActivitySummary[];
  exercises?: GymExercise[];
  profile: {
    age: number | null;
    experience: string | null;
    goals: string[];
    preferred_sports: SportType[];
    weight_kg: number | null;
    max_hr: number | null;
    training_history_years: number | null;
  };
}

export interface CoachOutput {
  performance_explanation: string;
  recovery_advice: string;
  next_workout_recommendation: string;
  long_term_insight: string;
  score_change_reason: string;
}

export async function generateCoachFeedback(
  input: CoachInput,
  options?: { useOpenAI?: boolean }
): Promise<CoachOutput> {
  const breakdown = input.score.score_breakdown as ScoreBreakdown;
  const useOpenAI = options?.useOpenAI !== false;

  if (useOpenAI && hasOpenAIKey()) {
    try {
      return await generateOpenAIFeedback(input, breakdown);
    } catch {
      // Fall through to rules-based feedback
    }
  }

  return generateFallbackFeedback(input, breakdown);
}

/** One-sentence rules-based snippet for free-tier users. */
export function generateRulesBasedSnippet(
  input: CoachInput
): Pick<CoachOutput, "next_workout_recommendation"> {
  const breakdown = input.score.score_breakdown as ScoreBreakdown;
  const acwr =
    input.recentLoads.chronic > 0
      ? input.recentLoads.acute / input.recentLoads.chronic
      : 1;
  const indexGap = input.enduranceIndex - input.strengthIndex;
  const weakerSide =
    indexGap < -15 ? "endurance" : indexGap > 15 ? "strength" : "balanced";

  const nextSession = prescribeNextSession(
    input.activity.sport,
    input.fatigueScore,
    input.recoveryScore,
    acwr,
    weakerSide,
    input.profile.preferred_sports
  );

  const firstSentence = nextSession.split(/(?<=[.!?])\s+/)[0] ?? nextSession;
  void breakdown;

  return { next_workout_recommendation: firstSentence };
}

async function generateOpenAIFeedback(
  input: CoachInput,
  breakdown: ScoreBreakdown
): Promise<CoachOutput> {
  const userPrompt = buildCoachUserPrompt(input, breakdown);

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.35,
    max_tokens: 1100,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  const parsed = JSON.parse(content) as Partial<CoachOutput>;
  return validateCoachOutput(parsed, input, breakdown);
}

function buildCoachUserPrompt(
  input: CoachInput,
  breakdown: ScoreBreakdown
): string {
  const indexDelta = input.currentSplitIndex - input.previousSplitIndex;
  const acwr =
    input.recentLoads.chronic > 0
      ? input.recentLoads.acute / input.recentLoads.chronic
      : 1;
  const sport = input.activity.sport.replace("_", " ");
  const durationMin = Math.round(input.activity.duration_seconds / 60);
  const distanceKm = input.activity.distance_meters
    ? (input.activity.distance_meters / 1000).toFixed(1)
    : null;
  const paceMinKm = input.activity.avg_pace_seconds_per_km
    ? (input.activity.avg_pace_seconds_per_km / 60).toFixed(1)
    : input.activity.distance_meters
      ? (
          input.activity.duration_seconds /
          60 /
          (input.activity.distance_meters / 1000)
        ).toFixed(1)
      : null;

  const historyLines = input.indexHistory.slice(-10).map((h) => {
    const date = new Date(h.recorded_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${date}: split=${h.split_index}, endurance=${h.endurance_index}, strength=${h.strength_index}, fatigue=${h.fatigue_score}, recovery=${h.recovery_score}`;
  });

  const recentLines = input.recentActivities.slice(0, 8).map((a) => {
    const date = new Date(a.started_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${date} ${a.sport}: index=${a.sport_index}, load=${a.load_score.toFixed(1)}, ${Math.round(a.duration_seconds / 60)}min, type=${a.session_type ?? "N/A"}`;
  });

  const exerciseLines =
    input.exercises?.map(
      (ex) =>
        `${ex.exercise_name}: ${ex.sets}×${ex.reps} @ ${ex.weight_kg}kg${ex.rpe ? ` RPE ${ex.rpe}` : ""}${ex.estimated_1rm_kg ? `, e1RM ${ex.estimated_1rm_kg}kg` : ""}`
    ) ?? [];

  return `Analyze this workout and produce coaching feedback in the required JSON format.

WORKOUT
- Sport: ${sport}
- Duration: ${durationMin} min
- Distance: ${distanceKm ? `${distanceKm} km` : "N/A"}
- Pace: ${paceMinKm ? `${paceMinKm} min/km` : "N/A"}
- Avg HR: ${input.activity.avg_heart_rate ?? "N/A"} bpm
- Max HR: ${input.activity.max_heart_rate ?? "N/A"} bpm
- Avg power: ${input.activity.avg_power_watts ? `${input.activity.avg_power_watts} W` : "N/A"}
- Elevation: ${input.activity.elevation_meters ? `${input.activity.elevation_meters} m` : "N/A"}
- Temperature: ${input.activity.temperature_celsius !== null ? `${input.activity.temperature_celsius}°C` : "N/A"}
- Session type: ${input.activity.session_type ?? "N/A"}
- RPE: ${input.activity.rpe ?? "N/A"}
${exerciseLines.length > 0 ? `- Exercises:\n  ${exerciseLines.join("\n  ")}` : ""}

SCORING
- Sport index: ${input.score.sport_index}
- Endurance component: ${input.score.endurance_component ?? "N/A"}
- Strength component: ${input.score.strength_component ?? "N/A"}
- Load score: ${input.score.load_score.toFixed(1)}
- Split Index: ${input.previousSplitIndex} → ${input.currentSplitIndex} (${indexDelta >= 0 ? "+" : ""}${indexDelta})
- Endurance index: ${input.enduranceIndex}
- Strength index: ${input.strengthIndex}
- Predicted index (7d): ${input.predictedIndex}
- Fatigue score: ${input.fatigueScore}/100
- Recovery score: ${input.recoveryScore}/100
- ACWR: ${acwr.toFixed(2)} (acute load ${input.recentLoads.acute.toFixed(1)}, chronic ${input.recentLoads.chronic.toFixed(1)})

SCORE BREAKDOWN FACTORS
${JSON.stringify(breakdown, null, 2)}

INDEX HISTORY (recent)
${historyLines.length > 0 ? historyLines.join("\n") : "No prior history"}

RECENT ACTIVITIES
${recentLines.length > 0 ? recentLines.join("\n") : "No prior activities"}

ATHLETE
- Age: ${input.profile.age ?? "unknown"}
- Experience: ${input.profile.experience ?? "unknown"}
- Training history: ${input.profile.training_history_years ?? "unknown"} years
- Bodyweight: ${input.profile.weight_kg ? `${input.profile.weight_kg} kg` : "unknown"}
- Max HR: ${input.profile.max_hr ?? "unknown"} bpm
- Goals: ${input.profile.goals.join(", ") || "general fitness"}
- Preferred sports: ${input.profile.preferred_sports.join(", ") || "none specified"}`;
}

function validateCoachOutput(
  parsed: Partial<CoachOutput>,
  input: CoachInput,
  breakdown: ScoreBreakdown
): CoachOutput {
  const required: (keyof CoachOutput)[] = [
    "performance_explanation",
    "score_change_reason",
    "recovery_advice",
    "next_workout_recommendation",
    "long_term_insight",
  ];

  const missing = required.filter(
    (key) => !parsed[key] || parsed[key]!.trim().length === 0
  );

  if (missing.length > 0) {
    return generateFallbackFeedback(input, breakdown);
  }

  return parsed as CoachOutput;
}

function generateFallbackFeedback(
  input: CoachInput,
  breakdown: ScoreBreakdown
): CoachOutput {
  const indexDelta = input.currentSplitIndex - input.previousSplitIndex;
  const acwr =
    input.recentLoads.chronic > 0
      ? input.recentLoads.acute / input.recentLoads.chronic
      : 1;
  const sport = input.activity.sport.replace("_", " ");
  const factors = breakdown.explanation ?? [];
  const durationMin = Math.round(input.activity.duration_seconds / 60);
  const distanceKm = input.activity.distance_meters
    ? (input.activity.distance_meters / 1000).toFixed(1)
    : null;
  const paceMinKm =
    input.activity.avg_pace_seconds_per_km ??
    (input.activity.distance_meters
      ? input.activity.duration_seconds / (input.activity.distance_meters / 1000)
      : null);
  const paceStr = paceMinKm
    ? `${(paceMinKm / 60).toFixed(1)} min/km`
    : "N/A";

  const limitingFactor = findLimitingFactor(breakdown);
  const improvingFactor = findImprovingFactor(
    input.activity.sport,
    input.score.sport_index,
    input.recentActivities
  );

  const indexGap = input.enduranceIndex - input.strengthIndex;
  const weakerSide =
    indexGap < -15 ? "endurance" : indexGap > 15 ? "strength" : "balanced";

  const restHours = estimateRestHours(
    input.score.load_score,
    input.fatigueScore,
    input.activity.rpe
  );

  const nextSession = prescribeNextSession(
    input.activity.sport,
    input.fatigueScore,
    input.recoveryScore,
    acwr,
    weakerSide,
    input.profile.preferred_sports
  );

  const trendInsight = buildTrendInsight(input.indexHistory, input.predictedIndex);

  return {
    performance_explanation: `Your ${sport} session scored ${input.score.sport_index} on the sport index over ${durationMin} min${distanceKm ? ` covering ${distanceKm} km at ${paceStr}` : ""}${input.activity.avg_heart_rate ? ` with avg HR ${input.activity.avg_heart_rate} bpm` : ""}. Primary score drivers: ${factors.slice(0, 4).join("; ")}.${limitingFactor ? ` ${limitingFactor} limited your index.` : ""}${improvingFactor ? ` ${improvingFactor}` : ""}`,
    score_change_reason: `Split Index moved from ${input.previousSplitIndex} to ${input.currentSplitIndex} (${indexDelta >= 0 ? "+" : ""}${indexDelta} pts), driven by a ${sport} sport index of ${input.score.sport_index} against your composite endurance (${input.enduranceIndex}) and strength (${input.strengthIndex}) indices.${breakdown.fatigue_multiplier && breakdown.fatigue_multiplier < 1 ? ` Fatigue multiplier ${breakdown.fatigue_multiplier.toFixed(2)} (ACWR ${acwr.toFixed(2)}) reduced the raw score.` : ""}`,
    recovery_advice: `Session load was ${input.score.load_score.toFixed(1)} with fatigue at ${input.fatigueScore}/100 and recovery at ${input.recoveryScore}/100 (ACWR ${acwr.toFixed(2)}, acute load ${input.recentLoads.acute.toFixed(0)}).${input.activity.rpe ? ` Reported RPE ${input.activity.rpe}/10.` : ""} Allow ${restHours} before your next high-intensity session; prioritize ${input.recoveryScore < 60 ? "complete rest or mobility" : "easy aerobic work at ≤65% max HR"} to bring fatigue below 50.`,
    next_workout_recommendation: nextSession,
    long_term_insight: `${trendInsight} Endurance index ${input.enduranceIndex} vs strength ${input.strengthIndex} (${indexGap >= 0 ? "+" : ""}${indexGap} gap) — ${weakerSide === "balanced" ? "maintain hybrid balance with alternating endurance and strength sessions" : `prioritize ${weakerSide} volume over the next 2 weeks`}. Predicted Split Index in 7 days: ${input.predictedIndex}.`,
  };
}

function findLimitingFactor(breakdown: ScoreBreakdown): string | null {
  if (breakdown.fatigue_multiplier && breakdown.fatigue_multiplier < 0.95) {
    return `Fatigue multiplier ${breakdown.fatigue_multiplier.toFixed(2)} from elevated ACWR`;
  }
  if (breakdown.pace_factor && breakdown.pace_factor < 0.85) {
    return `Pace factor ${breakdown.pace_factor.toFixed(2)} was below baseline`;
  }
  if (breakdown.hr_efficiency && breakdown.hr_efficiency < 0.95) {
    return `HR efficiency ${breakdown.hr_efficiency.toFixed(2)} suggests elevated cardiac cost`;
  }
  if (breakdown.relative_strength && breakdown.relative_strength < 0.85) {
    return `Relative strength factor ${breakdown.relative_strength.toFixed(2)} trailed your experience baseline`;
  }
  return null;
}

function findImprovingFactor(
  sport: SportType,
  sportIndex: number,
  recent: RecentActivitySummary[]
): string | null {
  const recentSameSport = recent
    .slice(1)
    .filter((a) => a.sport === sport)
    .slice(0, 5);
  if (recentSameSport.length === 0) return null;

  const prevAvg =
    recentSameSport.reduce((s, a) => s + a.sport_index, 0) /
    recentSameSport.length;
  const delta = sportIndex - prevAvg;

  if (Math.abs(delta) < 5) return null;
  return delta > 0
    ? `Sport index improved ${Math.round(delta)} pts vs your recent ${Math.round(prevAvg)} average.`
    : `Sport index dropped ${Math.abs(Math.round(delta))} pts vs your recent ${Math.round(prevAvg)} average.`;
}

function estimateRestHours(
  loadScore: number,
  fatigueScore: number,
  rpe: number | null
): string {
  let hours = 24;
  if (loadScore > 80 || fatigueScore > 65) hours = 48;
  else if (loadScore > 50 || fatigueScore > 45) hours = 36;
  if (rpe && rpe >= 8) hours = Math.max(hours, 48);
  if (fatigueScore < 30 && loadScore < 30) hours = 12;
  return `${hours}h`;
}

function prescribeNextSession(
  sport: SportType,
  fatigueScore: number,
  recoveryScore: number,
  acwr: number,
  weakerSide: "endurance" | "strength" | "balanced",
  preferredSports: SportType[]
): string {
  const needsRecovery = fatigueScore > 55 || recoveryScore < 55 || acwr > 1.3;

  if (needsRecovery) {
    const recoverySport =
      preferredSports.find((s) => s !== "gym" && s !== sport) ?? "walking";
    return `Schedule a ${recoverySport.replace("_", " ")} recovery session within 24h: 30-40 min at easy intensity (RPE 3-4), target load <25. Defer threshold or interval work until ACWR drops below 1.2 (currently ${acwr.toFixed(2)}).`;
  }

  if (sport === "gym") {
    const enduranceSport =
      preferredSports.find((s) => s !== "gym") ?? "running";
    return `Follow with ${enduranceSport.replace("_", " ")} easy session in 24-36h: 35-45 min at RPE 4-5 to maintain aerobic base without adding load. Next gym session in 48-72h focusing on ${weakerSide === "endurance" ? "compound volume" : "progressive overload on primary lifts"}.`;
  }

  if (weakerSide === "strength" && acwr < 1.2) {
    return `Within 48h, add a gym session: 45-60 min, 3-4 compound lifts at RPE 6-7, target load 40-55. Your strength index trails endurance — this closes the ${weakerSide} gap without exceeding ACWR ${acwr.toFixed(2)}.`;
  }

  const progressionType =
    sport === "running" || sport === "walking"
      ? "tempo"
      : sport === "swimming"
        ? "threshold"
        : "interval";

  return `Next ${sport.replace("_", " ")} session in 24-48h: ${progressionType} format, 40-50 min total, RPE 6-7, target load ${Math.round(35 + fatigueScore * 0.3)}-${Math.round(50 + fatigueScore * 0.2)}. Progress duration by 5-10% if recovery score stays above ${recoveryScore}.`;
}

function buildTrendInsight(history: IndexHistoryEntry[], predicted: number): string {
  if (history.length < 2) {
    return "Insufficient index history for trend analysis — consistent logging will unlock progression tracking.";
  }

  const oldest = history[0];
  const previous = history[history.length - 2];
  const latest = history[history.length - 1];
  const spanDays = Math.round(
    (new Date(latest.recorded_at).getTime() -
      new Date(oldest.recorded_at).getTime()) /
      86400000
  );
  const trendDelta = latest.split_index - oldest.split_index;
  const fatigueTrend = latest.fatigue_score - oldest.fatigue_score;

  return `Over ${spanDays} days your Split Index moved ${trendDelta >= 0 ? "+" : ""}${Math.round(trendDelta)} pts (${oldest.split_index} → ${latest.split_index}); fatigue trend ${fatigueTrend >= 0 ? "+" : ""}${Math.round(fatigueTrend)} vs prior ${previous.split_index} snapshot. 7-day projection: ${predicted}.`;
}
