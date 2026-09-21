import { describe, expect, it } from "vitest";
import {
  buildCalibrationPayload,
  canSkipCalibration,
  canSubmitCalibration,
  completeCardioEntries,
  filledLifts,
  newCardioEntry,
  newSbdState,
  type CardioEntry,
} from "./calibration-input";

describe("a blank calibration form", () => {
  it("claims nothing the athlete did not type", () => {
    // The defect: the cardio row arrived holding 5 km in 25:00. Nobody entered
    // it, and tapping straight through wrote it to personal_records as a real
    // personal best and seeded every race prediction from it.
    const entry = newCardioEntry();
    expect(entry.distanceKm).toBe("");
    expect(entry.minutes).toBe("");
    expect(entry.seconds).toBe("");
  });

  it("has nothing to submit", () => {
    expect(canSubmitCalibration(newSbdState(), [newCardioEntry()])).toBe(false);
    expect(completeCardioEntries([newCardioEntry()])).toHaveLength(0);
    expect(filledLifts(newSbdState())).toHaveLength(0);
  });

  it("can still be left, which is the whole point", () => {
    // "Optional" has to mean there is a way out. Onboarding has already saved
    // the profile and set onboarding_completed before this screen renders.
    expect(canSkipCalibration()).toBe(true);
  });

  it("sends nothing at all if it somehow were submitted", () => {
    const payload = buildCalibrationPayload(newSbdState(), [newCardioEntry()]);
    expect(payload.sbd).toEqual({});
    expect(payload.cardio).toEqual([]);
  });

  it("keeps a default rep count that cannot become data on its own", () => {
    // Reps default to 5 because it is a unit to confirm, not a claim about
    // strength — and a lift only counts once a weight is typed.
    const sbd = newSbdState();
    expect(sbd.squat.reps).toBe("5");
    expect(sbd.squat.weightKg).toBe("");
    expect(filledLifts(sbd)).toHaveLength(0);
  });
});

describe("what counts as entered", () => {
  function cardio(patch: Partial<CardioEntry>): CardioEntry {
    return { ...newCardioEntry(), ...patch };
  }

  it("needs a weight before a lift counts", () => {
    const sbd = newSbdState();
    sbd.bench.weightKg = "80";
    expect(filledLifts(sbd)).toEqual(["bench"]);
    expect(canSubmitCalibration(sbd, [newCardioEntry()])).toBe(true);
  });

  it("ignores a lift whose reps were cleared", () => {
    const sbd = newSbdState();
    sbd.squat.weightKg = "100";
    sbd.squat.reps = "";
    expect(filledLifts(sbd)).toHaveLength(0);
  });

  it("needs both a distance and a time before a cardio row counts", () => {
    expect(completeCardioEntries([cardio({ distanceKm: "5" })])).toHaveLength(0);
    expect(completeCardioEntries([cardio({ minutes: "25" })])).toHaveLength(0);
    expect(completeCardioEntries([cardio({ distanceKm: "5", minutes: "25" })])).toHaveLength(1);
  });

  it("counts a time given only in seconds", () => {
    expect(completeCardioEntries([cardio({ distanceKm: "0.4", seconds: "58" })])).toHaveLength(1);
  });
});

describe("buildCalibrationPayload", () => {
  it("converts to the units the calibrate route expects", () => {
    const sbd = newSbdState();
    sbd.deadlift.weightKg = "180";
    sbd.deadlift.reps = "3";
    const payload = buildCalibrationPayload(sbd, [
      { ...newCardioEntry(), distanceKm: "5", minutes: "22", seconds: "30" },
    ]);

    expect(payload.sbd).toEqual({ deadlift: { weightKg: 180, reps: 3 } });
    expect(payload.cardio).toEqual([
      { sport: "running", distanceMeters: 5000, durationSeconds: 1350 },
    ]);
  });

  it("drops the rows the athlete left blank rather than sending zeroes", () => {
    const sbd = newSbdState();
    sbd.bench.weightKg = "60";
    const payload = buildCalibrationPayload(sbd, [
      newCardioEntry(),
      { ...newCardioEntry(), distanceKm: "10", minutes: "50" },
    ]);

    expect(Object.keys(payload.sbd)).toEqual(["bench"]);
    expect(payload.cardio).toHaveLength(1);
    expect(payload.cardio[0].distanceMeters).toBe(10_000);
  });
});
