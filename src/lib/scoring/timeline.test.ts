import { describe, expect, it } from "vitest";
import { domainForSport } from "./timeline";

describe("domainForSport", () => {
  it("gym is the only strength domain sport", () => {
    expect(domainForSport("gym")).toBe("strength");
  });

  it("every other sport is cardio", () => {
    expect(domainForSport("running")).toBe("cardio");
    expect(domainForSport("walking")).toBe("cardio");
    expect(domainForSport("swimming")).toBe("cardio");
    expect(domainForSport("rowing")).toBe("cardio");
    expect(domainForSport("bike_erg")).toBe("cardio");
    expect(domainForSport("indoor_cycling")).toBe("cardio");
    expect(domainForSport("outdoor_cycling")).toBe("cardio");
    expect(domainForSport("ski_erg")).toBe("cardio");
  });
});
