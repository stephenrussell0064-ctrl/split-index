import { describe, expect, it } from "vitest";
import { mapSportToBenchmarkSport, mapSportToCardioType } from "./adapters";
import { SPORT_FIELDS } from "@/components/activities/form-state";
import { SPORT_INDEX_LABELS, SPORTS } from "@/lib/constants/sports";
import { detectSport as detectSportCsv } from "@/lib/integrations/csv-parser";
import { detectSport as detectSportTcx } from "@/lib/integrations/parsers/tcx";
import { STRAVA_TYPE_TO_SPORT } from "@/lib/integrations/providers/index";

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

describe("import sport-detection routes generic bike/cycle text to outdoor_cycling, trainer signals to indoor_cycling", () => {
  it("CSV keyword detection", () => {
    expect(detectSportCsv("cycling")).toBe("outdoor_cycling");
    expect(detectSportCsv("Road Ride")).toBe("outdoor_cycling");
    expect(detectSportCsv("Zwift ride")).toBe("indoor_cycling");
    expect(detectSportCsv("Peloton class")).toBe("indoor_cycling");
    expect(detectSportCsv("Trainer session")).toBe("indoor_cycling");
  });

  it("TCX sport-field detection", () => {
    expect(detectSportTcx("Cycling")).toBe("outdoor_cycling");
    expect(detectSportTcx("Bike Ride")).toBe("outdoor_cycling");
    expect(detectSportTcx("Indoor Cycling")).toBe("indoor_cycling");
    expect(detectSportTcx("Zwift Cycling")).toBe("indoor_cycling");
  });
});

describe("Strava outdoor ride types map to outdoor_cycling, VirtualRide stays indoor_cycling", () => {
  it("genuinely outdoor ride types", () => {
    expect(STRAVA_TYPE_TO_SPORT.Ride).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.GravelRide).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.MountainBikeRide).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.EBikeRide).toBe("outdoor_cycling");
  });

  it("simulated/stationary ride stays indoor", () => {
    expect(STRAVA_TYPE_TO_SPORT.VirtualRide).toBe("indoor_cycling");
  });
});
