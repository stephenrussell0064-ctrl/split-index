import type { LeaderboardPeriod } from "@/types";

export type LeaderboardScope = "global" | "country" | "age" | "weight" | "sport";
export type IndexMetric = "split" | "endurance" | "strength";

export const LEADERBOARD_PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "all_time", label: "All Time" },
];

export const LEADERBOARD_SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "country", label: "Country" },
  { value: "age", label: "Age Group" },
  { value: "weight", label: "Weight Class" },
  { value: "sport", label: "Sport Index" },
];

export const AGE_BRACKETS = [
  { value: "18-29", min: 18, max: 29, label: "18–29" },
  { value: "30-39", min: 30, max: 39, label: "30–39" },
  { value: "40-49", min: 40, max: 49, label: "40–49" },
  { value: "50+", min: 50, max: 120, label: "50+" },
] as const;

export const WEIGHT_CLASSES = [
  { value: "light", min: 0, max: 70, label: "Light (<70 kg)" },
  { value: "middle", min: 70, max: 85, label: "Middle (70–85 kg)" },
  { value: "heavy", min: 85, max: 100, label: "Heavy (85–100 kg)" },
  { value: "super", min: 100, max: 999, label: "Super (100+ kg)" },
] as const;

export const INDEX_METRICS: { value: IndexMetric; label: string; color: string }[] = [
  { value: "split", label: "Split", color: "#fafafa" },
  { value: "endurance", label: "Endurance", color: "#0ea5e9" },
  { value: "strength", label: "Strength", color: "#00e65f" },
];

export function getPeriodStart(period: LeaderboardPeriod): string {
  const now = new Date();
  if (period === "all_time") return "1970-01-01";
  if (period === "monthly") {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export function matchesAgeBracket(age: number | null, bracket: string): boolean {
  if (age == null) return false;
  const found = AGE_BRACKETS.find((b) => b.value === bracket);
  if (!found) return true;
  return age >= found.min && age <= found.max;
}

export function matchesWeightClass(weightKg: number | null, weightClass: string): boolean {
  if (weightKg == null) return false;
  const found = WEIGHT_CLASSES.find((w) => w.value === weightClass);
  if (!found) return true;
  return weightKg >= found.min && weightKg < found.max;
}
