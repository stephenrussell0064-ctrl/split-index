import { describe, expect, it } from "vitest";
import {
  enduranceMetPrescription,
  prescribedEnduranceFields,
  sportForPrescription,
  titleForPrescription,
} from "./prescribed-endurance";

const RUN = "8.1km in 48min at 5:42-6:12/km. HR 147-164 (physiological easy band from HR reserve).";
const SWIM = "Swim 0.5km in 25min at 5:13-5:41/100m. HR 138-156 (HR reserve).";
const RIDE = "Ride 25min at a conversational effort. HR 141-160.";

describe("sportForPrescription", () => {
  it("reads the modality from the verb the engine opens with, and running from no verb", () => {
    expect(sportForPrescription(RUN)).toBe("running");
    expect(sportForPrescription(SWIM)).toBe("swimming");
    expect(sportForPrescription(RIDE)).toBe("outdoor_cycling");
    expect(sportForPrescription("Row 2000m in 8min.")).toBe("rowing");
    expect(sportForPrescription("Walk 40min briskly.")).toBe("walking");
  });
});

describe("titleForPrescription", () => {
  it("names the session as the day card does", () => {
    expect(titleForPrescription({ kind: "long_run", prescription: RUN })).toBe("Long run");
    expect(titleForPrescription({ kind: "easy_run", prescription: SWIM })).toBe("Easy swim");
    expect(titleForPrescription({ kind: "interval_run", prescription: SWIM })).toBe("Swim intervals");
  });
});

describe("prescribedEnduranceFields", () => {
  it("fills a run in kilometres with the time split out", () => {
    const f = prescribedEnduranceFields({ id: "s", kind: "long_run", prescription: RUN, minutes: 48, distanceKm: 8.1 });
    expect(f).toEqual({
      sport: "running",
      sessionType: "long",
      title: "Long run",
      distance: "8.1",
      hours: "",
      minutes: "48",
      seconds: "00",
    });
  });

  it("fills a swim in metres, and a session over an hour with an hours figure", () => {
    const f = prescribedEnduranceFields({ id: "s", kind: "easy_run", prescription: SWIM, minutes: 75.5, distanceKm: 0.5 });
    expect(f).toMatchObject({ sport: "swimming", distance: "500", hours: "1", minutes: "15", seconds: "30" });
  });

  it("leaves the distance blank for a session prescribed by time alone", () => {
    const f = prescribedEnduranceFields({ id: "s", kind: "easy_run", prescription: RIDE, minutes: 25, distanceKm: null });
    expect(f).toMatchObject({ sport: "outdoor_cycling", sessionType: "easy", distance: "", minutes: "25" });
  });

  it("maps every kind to a session type the form knows", () => {
    for (const [kind, type] of [
      ["recovery_run", "recovery"],
      ["threshold_run", "threshold"],
      ["interval_run", "interval"],
      ["rep_run", "interval"],
    ] as const) {
      expect(prescribedEnduranceFields({ id: "s", kind, prescription: RUN, minutes: 30, distanceKm: null })?.sessionType).toBe(type);
    }
  });

  it("is null when there is nothing to prefill", () => {
    expect(prescribedEnduranceFields({ id: "s", kind: "easy_run", prescription: RUN, minutes: null, distanceKm: null })).toBeNull();
    expect(prescribedEnduranceFields({ id: "s", kind: "easy_run", prescription: RUN, minutes: 0, distanceKm: 0 })).toBeNull();
  });
});

describe("enduranceMetPrescription", () => {
  it("judges by distance when the prescription had one — nine-tenths is done", () => {
    const rx = { minutes: 48, distanceKm: 8.1 };
    expect(enduranceMetPrescription(rx, { distanceMeters: 8100, durationSeconds: 2880 })).toBe(true);
    expect(enduranceMetPrescription(rx, { distanceMeters: 7400, durationSeconds: 2600 })).toBe(true);
    expect(enduranceMetPrescription(rx, { distanceMeters: 5000, durationSeconds: 2880 })).toBe(false);
  });

  it("says nothing about a distance prescription logged without a distance", () => {
    expect(enduranceMetPrescription({ minutes: 48, distanceKm: 8.1 }, { distanceMeters: null, durationSeconds: 2880 })).toBeNull();
  });

  it("judges by time when there was no distance", () => {
    const rx = { minutes: 25, distanceKm: null };
    expect(enduranceMetPrescription(rx, { distanceMeters: null, durationSeconds: 1500 })).toBe(true);
    expect(enduranceMetPrescription(rx, { distanceMeters: null, durationSeconds: 1200 })).toBe(false);
  });

  it("says nothing when the prescription measured nothing", () => {
    expect(enduranceMetPrescription({ minutes: null, distanceKm: null }, { distanceMeters: 5000, durationSeconds: 1500 })).toBeNull();
  });
});
