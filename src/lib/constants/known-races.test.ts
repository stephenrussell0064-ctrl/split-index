import { describe, expect, it } from "vitest";
import { KNOWN_RACES } from "./known-races";
import { COMMON_DISTANCES } from "@/components/analytics/upcoming-races-panel";

describe("KNOWN_RACES", () => {
  it("has no duplicate names", () => {
    const names = KNOWN_RACES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every race's distance matches one of the panel's own distance <select> options (regression: a mismatched value silently shows as unselected even though it's technically correct)", () => {
    const allowedDistances = new Set(COMMON_DISTANCES.map((d) => d.meters));
    for (const race of KNOWN_RACES) {
      expect(allowedDistances.has(race.distanceMeters), `${race.name}: ${race.distanceMeters}m not in COMMON_DISTANCES`).toBe(
        true
      );
    }
  });

  it("every race has a positive, plausible elevation gain", () => {
    for (const race of KNOWN_RACES) {
      expect(race.elevationGainMeters).toBeGreaterThan(0);
      expect(race.elevationGainMeters).toBeLessThan(3000); // sanity ceiling — no road race in this list is Everest
    }
  });

  it("every race has a real terrain classification and a non-empty note", () => {
    const validTerrains = new Set(["flat", "rolling", "hilly", "mountainous"]);
    for (const race of KNOWN_RACES) {
      expect(validTerrains.has(race.terrain)).toBe(true);
      expect(race.note.trim().length).toBeGreaterThan(0);
      expect(race.location.trim().length).toBeGreaterThan(0);
    }
  });

  it("flags the flattest and hilliest races consistently with their own elevation numbers", () => {
    const flattest = [...KNOWN_RACES].sort((a, b) => a.elevationGainMeters - b.elevationGainMeters)[0];
    const hilliest = [...KNOWN_RACES].sort((a, b) => b.elevationGainMeters - a.elevationGainMeters)[0];
    expect(flattest.terrain).toBe("flat");
    expect(hilliest.terrain).toBe("mountainous");
  });
});
