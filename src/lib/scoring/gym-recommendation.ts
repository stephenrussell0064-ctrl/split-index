/**
 * Balanced gym-split recommendation — mines the athlete's own recent
 * training history to suggest which muscle groups (and example exercises)
 * to train next, biased toward whatever's been under-trained relative to
 * everything else. The one hard rule: a muscle group trained within the
 * rest window is NEVER recommended, even if it's the most under-trained
 * one overall — "balance the program" must never override "let it recover."
 */
import { COMMON_EXERCISES, MUSCLE_GROUPS, muscleToCategory, type MuscleGroupCategory } from "@/lib/constants/sports";

export const GYM_RECOMMENDATION_CONFIG = {
  /** How far back to look when judging "how much has this muscle group been trained lately". */
  LOOKBACK_DAYS: 28,
  /**
   * A muscle group whose CATEGORY (legs, chest, back, ...) was trained more
   * recently than this many days ago is excluded entirely — training Quads
   * hard fatigues Hamstrings/Glutes/Calves too even if they weren't
   * directly targeted, so the exclusion applies at the category level, not
   * just the exact logged muscle group.
   */
  MIN_REST_DAYS: 2,
  /** How many muscle groups to put forward for the next session. */
  RECOMMENDED_GROUP_COUNT: 2,
  /** Example exercises suggested per recommended muscle group. */
  EXERCISES_PER_GROUP: 2,
} as const;

export interface LoggedGymSet {
  muscleGroup: string;
  startedAt: string;
}

export interface MuscleGroupStat {
  muscleGroup: string;
  category: MuscleGroupCategory;
  /** Null if never logged within the lookback window. */
  daysSinceLastTrained: number | null;
  setsInWindow: number;
}

export interface RecommendedGroup {
  muscleGroup: string;
  exerciseNames: string[];
}

export interface GymSplitRecommendation {
  recommendedGroups: RecommendedGroup[];
  /** Categories excluded this round because they're still within the rest window. */
  restingCategories: MuscleGroupCategory[];
  summary: string;
}

const DAY_MS = 86400000;

function dateOnlyUtcMs(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Both sides must be date-truncated before diffing — comparing a full timestamp against a truncated one silently inflates the day count by up to 1 depending on time-of-day, which previously let a muscle group trained "yesterday" slip past the rest-day gate. */
function daysBetween(laterDateMs: number, earlierIso: string): number {
  return Math.round((laterDateMs - dateOnlyUtcMs(earlierIso)) / DAY_MS);
}

function exercisesForGroup(muscleGroup: string, count: number): string[] {
  const matches = COMMON_EXERCISES.filter((e) => e.muscle === muscleGroup);
  const compounds = matches.filter((e) => e.kind === "compound");
  const ordered = [...compounds, ...matches.filter((e) => e.kind !== "compound")];
  return ordered.slice(0, count).map((e) => e.name);
}

/** Computes per-muscle-group training recency/volume from raw logged sets. Exported for the loader that builds the actual log form to reuse the same numbers the summary displays. */
export function computeMuscleGroupStats(
  loggedSets: LoggedGymSet[],
  now: Date = new Date()
): MuscleGroupStat[] {
  const nowMs = now.getTime();
  const nowDateMs = dateOnlyUtcMs(now);
  const cutoffMs = nowMs - GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS * DAY_MS;

  return MUSCLE_GROUPS.map((muscleGroup) => {
    const relevant = loggedSets.filter(
      (s) => s.muscleGroup === muscleGroup && new Date(s.startedAt).getTime() >= cutoffMs
    );

    let daysSinceLastTrained: number | null = null;
    for (const s of relevant) {
      const days = daysBetween(nowDateMs, s.startedAt);
      if (daysSinceLastTrained === null || days < daysSinceLastTrained) {
        daysSinceLastTrained = days;
      }
    }

    return {
      muscleGroup,
      category: muscleToCategory(muscleGroup),
      daysSinceLastTrained,
      setsInWindow: relevant.length,
    };
  });
}

export function recommendNextGymSplit(
  loggedSets: LoggedGymSet[],
  now: Date = new Date()
): GymSplitRecommendation {
  const stats = computeMuscleGroupStats(loggedSets, now);

  const restingCategories = [
    ...new Set(
      stats
        .filter(
          (s) =>
            s.daysSinceLastTrained !== null &&
            s.daysSinceLastTrained < GYM_RECOMMENDATION_CONFIG.MIN_REST_DAYS
        )
        .map((s) => s.category)
    ),
  ];

  const eligible = stats.filter((s) => !restingCategories.includes(s.category));

  if (eligible.length === 0) {
    return {
      recommendedGroups: [],
      restingCategories,
      summary:
        "Every muscle group has been trained in the last couple of days — a rest day (or light cardio) will serve you better than forcing volume onto something that hasn't recovered yet.",
    };
  }

  // Least-trained-in-window first; a muscle group never logged at all
  // (daysSinceLastTrained: null) ranks as maximally under-trained.
  const ranked = [...eligible].sort((a, b) => {
    if (a.setsInWindow !== b.setsInWindow) return a.setsInWindow - b.setsInWindow;
    const aDays = a.daysSinceLastTrained ?? Infinity;
    const bDays = b.daysSinceLastTrained ?? Infinity;
    return bDays - aDays;
  });

  const chosen = ranked.slice(0, GYM_RECOMMENDATION_CONFIG.RECOMMENDED_GROUP_COUNT);

  const recommendedGroups: RecommendedGroup[] = chosen.map((s) => ({
    muscleGroup: s.muscleGroup,
    exerciseNames: exercisesForGroup(s.muscleGroup, GYM_RECOMMENDATION_CONFIG.EXERCISES_PER_GROUP),
  }));

  const groupList = recommendedGroups.map((g) => g.muscleGroup).join(" and ");
  // A trailing parenthetical aside ("(skipping X — trained too recently...)")
  // read like an internal debug note rather than written copy (user
  // feedback: "don't include the brackets... this looks unprofessional").
  // A second plain sentence says the same thing without looking like one.
  const restNote =
    restingCategories.length > 0
      ? ` ${restingCategories.join(", ")} ${restingCategories.length === 1 ? "was" : "were"} trained too recently to recommend again yet.`
      : "";

  return {
    recommendedGroups,
    restingCategories,
    summary: `${groupList} could use the most attention based on your last ${GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS} days.${restNote}`,
  };
}
