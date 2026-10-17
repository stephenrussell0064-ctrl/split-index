import { describe, expect, it } from "vitest";
import { applyHealthProfile, describePrefill, type HealthProfileCharacteristics } from "./profile-prefill";

const blank = { date_of_birth: "", gender: "", height_cm: "", weight_kg: "", resting_hr: "" };

const full: HealthProfileCharacteristics = {
  dateOfBirth: "1996-10-17",
  biologicalSex: "male",
  heightCm: 180.34,
  weightKg: 76.26,
  restingHr: 51.8,
};

describe("applyHealthProfile", () => {
  it("fills every blank field and says which", () => {
    const { form, filled } = applyHealthProfile(blank, full);
    expect(form).toEqual({
      date_of_birth: "1996-10-17",
      gender: "male",
      height_cm: "180.3",
      weight_kg: "76.3",
      resting_hr: "52",
    });
    expect(filled).toEqual(["date_of_birth", "gender", "height_cm", "weight_kg", "resting_hr"]);
  });

  it("never overwrites something the athlete already typed", () => {
    const { form, filled } = applyHealthProfile({ ...blank, weight_kg: "80" }, full);
    expect(form.weight_kg).toBe("80");
    expect(filled).not.toContain("weight_kg");
  });

  it("drops implausible values rather than clamping them", () => {
    const { form, filled } = applyHealthProfile(blank, {
      ...full,
      heightCm: 9,
      weightKg: 9,
      restingHr: 300,
    });
    expect(form.height_cm).toBe("");
    expect(form.weight_kg).toBe("");
    expect(form.resting_hr).toBe("");
    expect(filled).toEqual(["date_of_birth", "gender"]);
  });

  it("leaves gender blank for 'other' and 'not set' — the form offers its own answers", () => {
    expect(applyHealthProfile(blank, { ...full, biologicalSex: "other" }).form.gender).toBe("");
    expect(applyHealthProfile(blank, { ...full, biologicalSex: null }).form.gender).toBe("");
  });

  it("is a no-op for an older app binary that cannot answer", () => {
    expect(applyHealthProfile(blank, null)).toEqual({ form: blank, filled: [] });
  });
});

describe("describePrefill", () => {
  it("lists what was filled in plain words", () => {
    expect(describePrefill(["height_cm"])).toBe("Filled height from Apple Health.");
    expect(describePrefill(["height_cm", "weight_kg", "date_of_birth"])).toBe(
      "Filled height, weight and date of birth from Apple Health."
    );
    expect(describePrefill([])).toBeNull();
  });
});
