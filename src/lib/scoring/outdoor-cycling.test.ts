import { describe, expect, it } from "vitest";
import { mapSportToBenchmarkSport, mapSportToCardioType } from "./adapters";
import { SPORT_FIELDS } from "@/components/activities/form-state";
import { SPORT_INDEX_LABELS, SPORTS } from "@/lib/constants/sports";

/**
 * outdoor_cycling (Slice F: sport-coverage gaps) shares its scoring bucket
 * with bike_erg/indoor_cycling ("cycle") but must route there explicitly —
 * mapSportToBenchmarkSport has a `default` fallthrough that would silently
 * score it as running if a case were ever missed here.
 */
describe("outdoor_cycling routes into the shared cycle scoring bucket", () => {
  it("mapSportToBenchmarkSport", () => {
    expect(mapSportToBenchmarkSport("outdoor_cycling")).toBe("cycle");
    expect(mapSportToBenchmarkSport("bike_erg")).toBe("cycle");
    expect(mapSportToBenchmarkSport("indoor_cycling")).toBe("cycle");
  });

  it("mapSportToCardioType falls through to 'run' (same as indoor_cycling), not a new branch", () => {
    expect(mapSportToCardioType("outdoor_cycling")).toBe("run");
    expect(mapSportToCardioType("indoor_cycling")).toBe("run");
  });
});

describe("outdoor_cycling form config", () => {
  it("has distance in km (unlike indoor_cycling/bike_erg's meters) plus elevation, unlike either sibling", () => {
    expect(SPORT_FIELDS.outdoor_cycling.distance).toBe("km");
    expect(SPORT_FIELDS.outdoor_cycling.elevation).toBe(true);
    expect(SPORT_FIELDS.indoor_cycling.distance).toBeUndefined();
    expect(SPORT_FIELDS.bike_erg.distance).toBe("m");
  });

  it("is present in the sport catalog and index-label map", () => {
    expect(SPORTS.some((s) => s.id === "outdoor_cycling")).toBe(true);
    expect(SPORT_INDEX_LABELS.outdoor_cycling).toBe("Outdoor Cycling Index");
  });
});
