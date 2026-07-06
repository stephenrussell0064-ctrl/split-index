import type { ExperienceLevel, SportType, TrainingGoal } from "@/types";

const EXPERIENCE_BASE: Record<ExperienceLevel, number> = {
  beginner: 420,
  intermediate: 520,
  advanced: 620,
  elite: 720,
};

/** Display-only onboarding baseline — does not affect the scoring engine. */
export function estimateStartingSplitIndex(input: {
  experience: ExperienceLevel;
  training_history_years: number;
  goals: TrainingGoal[];
  preferred_sports: SportType[];
}): { splitIndex: number; enduranceIndex: number; strengthIndex: number } {
  const base = EXPERIENCE_BASE[input.experience] ?? 500;
  const yearsBonus = Math.min(40, Math.round(input.training_history_years * 8));
  const hasEndurance = input.preferred_sports.some((s) => s !== "gym");
  const hasStrength = input.preferred_sports.includes("gym");
  const hybridBonus = hasEndurance && hasStrength ? 15 : 0;
  const goalBonus = input.goals.includes("hybrid_performance") ? 10 : 0;

  const splitIndex = Math.min(
    850,
    Math.max(350, Math.round(base + yearsBonus + hybridBonus + goalBonus))
  );

  let enduranceBias = 0;
  if (input.goals.includes("endurance")) enduranceBias = 12;
  if (input.goals.includes("strength")) enduranceBias = -12;

  const enduranceIndex = Math.min(999, Math.max(300, splitIndex + enduranceBias));
  const strengthIndex = Math.min(999, Math.max(300, splitIndex - enduranceBias));

  return { splitIndex, enduranceIndex, strengthIndex };
}

export function suggestGoalTarget(currentIndex: number): number {
  return Math.min(999, Math.ceil((currentIndex + 50) / 25) * 25);
}
