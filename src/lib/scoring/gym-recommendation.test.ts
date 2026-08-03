import { describe, expect, it } from "vitest";
import {
  recommendNextGymSplit,
  computeMuscleGroupStats,
  GYM_RECOMMENDATION_CONFIG,
  type LoggedGymSet,
} from "./gym-recommendation";

const NOW = new Date(Date.UTC(2026, 0, 30, 12, 0, 0));

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 86400000).toISOString();
}

function set(muscleGroup: string, daysAgo: number): LoggedGymSet {
  return { muscleGroup, startedAt: daysAgoIso(daysAgo) };
}

describe("recommendNextGymSplit", () => {
  it("with no history at all, recommends groups with no resting exclusions", () => {
    const result = recommendNextGymSplit([], NOW);
    expect(result.recommendedGroups).toHaveLength(GYM_RECOMMENDATION_CONFIG.RECOMMENDED_GROUP_COUNT);
    expect(result.restingCategories).toEqual([]);
  });

  it("never recommends a muscle group whose CATEGORY was trained inside the rest window, even if that exact group is under-trained (live-bug-class regression: legs example from the brief)", () => {
    // Quads trained yesterday — Hamstrings/Glutes/Calves are all "legs" too
    // and share the fatigue, even though they weren't directly logged.
    const loggedSets: LoggedGymSet[] = [set("Quads", 1)];
    const result = recommendNextGymSplit(loggedSets, NOW);

    expect(result.restingCategories).toContain("legs");
    const recommendedNames = result.recommendedGroups.map((g) => g.muscleGroup);
    expect(recommendedNames).not.toContain("Quads");
    expect(recommendedNames).not.toContain("Hamstrings");
    expect(recommendedNames).not.toContain("Glutes");
    expect(recommendedNames).not.toContain("Calves");
  });

  it("recommends the least-trained-in-window groups first", () => {
    const loggedSets: LoggedGymSet[] = [
      // Every group gets some volume so none are tied at zero — Chest is
      // trained heavily (well covered), Back gets a single distant session
      // (comparatively under-trained), everything else sits in between.
      set("Chest", 3),
      set("Chest", 10),
      set("Chest", 17),
      set("Chest", 24),
      set("Chest", 27),
      set("Back", 20),
      set("Shoulders", 8),
      set("Shoulders", 22),
      set("Biceps", 9),
      set("Biceps", 23),
      set("Triceps", 9),
      set("Triceps", 23),
      set("Core", 12),
      set("Core", 26),
      set("Quads", 6),
      set("Quads", 21),
      set("Hamstrings", 6),
      set("Hamstrings", 21),
      set("Glutes", 7),
      set("Glutes", 25),
      set("Calves", 7),
      set("Calves", 25),
    ];
    const result = recommendNextGymSplit(loggedSets, NOW);
    const recommendedNames = result.recommendedGroups.map((g) => g.muscleGroup);
    expect(recommendedNames).toContain("Back");
    expect(recommendedNames).not.toContain("Chest");
  });

  it("recommends rest instead of forcing a pick when every category is within the rest window", () => {
    const loggedSets: LoggedGymSet[] = [
      set("Chest", 0),
      set("Back", 1),
      set("Shoulders", 0),
      set("Biceps", 1),
      set("Quads", 0),
      set("Core", 1),
    ];
    const result = recommendNextGymSplit(loggedSets, NOW);
    expect(result.recommendedGroups).toEqual([]);
    expect(result.summary).toMatch(/rest day/i);
  });

  it("a muscle group trained exactly at the rest-day boundary is eligible again", () => {
    const loggedSets: LoggedGymSet[] = [set("Chest", GYM_RECOMMENDATION_CONFIG.MIN_REST_DAYS)];
    const result = recommendNextGymSplit(loggedSets, NOW);
    expect(result.restingCategories).not.toContain("chest");
  });

  it("suggests real catalog exercises for each recommended group", () => {
    const result = recommendNextGymSplit([], NOW);
    for (const group of result.recommendedGroups) {
      expect(group.exerciseNames.length).toBeGreaterThan(0);
    }
  });
});

describe("computeMuscleGroupStats", () => {
  it("ignores sets older than the lookback window", () => {
    const stats = computeMuscleGroupStats(
      [set("Chest", GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS + 5)],
      NOW
    );
    const chest = stats.find((s) => s.muscleGroup === "Chest")!;
    expect(chest.setsInWindow).toBe(0);
    expect(chest.daysSinceLastTrained).toBeNull();
  });

  it("counts sets within the window and tracks the most recent day", () => {
    const stats = computeMuscleGroupStats([set("Back", 10), set("Back", 3)], NOW);
    const back = stats.find((s) => s.muscleGroup === "Back")!;
    expect(back.setsInWindow).toBe(2);
    expect(back.daysSinceLastTrained).toBe(3);
  });
});
