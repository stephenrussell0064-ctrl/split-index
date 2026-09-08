import { describe, expect, it } from "vitest";
import {
  INTAKE_FIELD_SCHEMAS,
  TIER_2_FULLY_TYPED,
  validateIntakeValues,
} from "./intake";
import { SECTION_FIELDS } from "@/lib/scoring/hpe/intake-record";

/**
 * THIS FILE WAS CITED BEFORE IT EXISTED.
 *
 * `intake.ts` says, in the docblock stating its coverage: "TIER_2_FULLY_TYPED
 * below is asserted in intake-schema.test.ts so it stays complete as fields are
 * added." It was not. The constant was exported and referenced nowhere, so the
 * only thing keeping the health and fuelling screens fully typed was that
 * nobody had added a field since — and a claim of coverage that nothing checks
 * is worse than no claim, because the next person reads it and believes it.
 *
 * The completeness assertion below is the one the docblock promises. The rest
 * cover the behaviours the module is careful about in prose and nowhere else.
 */

describe("the coverage the docblock claims", () => {
  it("types every field on the sections it says are fully typed", () => {
    const untyped: string[] = [];
    for (const section of TIER_2_FULLY_TYPED) {
      for (const field of SECTION_FIELDS[section]) {
        if (!INTAKE_FIELD_SCHEMAS[field]) untyped.push(`${section}.${field}`);
      }
    }
    // Named rather than counted: adding a health question and forgetting its
    // type is exactly the miss this is here to report, and the name is what
    // tells you which screen just lost its guarantee.
    expect(untyped).toEqual([]);
  });

  it("names sections that exist", () => {
    for (const section of TIER_2_FULLY_TYPED) {
      expect(SECTION_FIELDS[section], `${section} is not a section`).toBeDefined();
    }
  });
});

describe("the health screen does not interpret an answer", () => {
  /*
    `parq_positive: "no"` is a truthy string. A coercing reader treats it as
    YES and refers a healthy athlete to a doctor; a different reader treats it
    as a failed parse and silently drops a real YES. Neither is acceptable for
    a question about chest pain, so the answer must be a boolean or an error.
  */
  const REFUSED = ["no", "yes", "", 0, 1, null, undefined, [], {}];

  it("refuses anything that is not a boolean", () => {
    for (const value of REFUSED) {
      const { errors, values } = validateIntakeValues("health", { parq_positive: value });
      expect(errors, `${JSON.stringify(value)} was accepted`).toHaveLength(1);
      expect(errors[0]!.path).toBe("parq_positive");
      // And it is an ERROR, not a silent drop: dropping it would tell the
      // athlete their answer saved when it did not.
      expect(values).not.toHaveProperty("parq_positive");
    }
  });

  it("takes both real answers", () => {
    expect(validateIntakeValues("health", { parq_positive: true })).toEqual({
      values: { parq_positive: true },
      errors: [],
    });
    expect(validateIntakeValues("health", { parq_positive: false })).toEqual({
      values: { parq_positive: false },
      errors: [],
    });
  });

  it("holds every other health and fuelling boolean to the same rule", () => {
    const accepted: string[] = [];
    for (const section of TIER_2_FULLY_TYPED) {
      for (const field of SECTION_FIELDS[section]) {
        if (field === "injury_sites") continue; // the one list in the set
        const { errors } = validateIntakeValues(section, { [field]: "no" });
        if (errors.length === 0) accepted.push(`${section}.${field}`);
      }
    }
    expect(accepted).toEqual([]);
  });

  it("takes a list of injury sites, and refuses one that is not a list", () => {
    const ok = validateIntakeValues("health", { injury_sites: ["left knee", "lower back"] });
    expect(ok.errors).toEqual([]);
    expect(ok.values.injury_sites).toEqual(["left knee", "lower back"]);

    // An array of objects where a list of sites belongs — stored verbatim
    // before this module existed, and read back by the safety screen.
    expect(
      validateIntakeValues("health", { injury_sites: [{ site: "knee" }] }).errors
    ).toHaveLength(1);
    expect(validateIntakeValues("health", { injury_sites: "left knee" }).errors).toHaveLength(1);
  });
});

describe("what the route allowlist and the schemas each decide", () => {
  it("drops a field that does not belong to the section, without an error", () => {
    /*
      The section allowlist is what stops a PATCH claiming to be the
      preferences screen from rewriting the safety answers. A field from
      another section is not an athlete's mistake to be told about — it is
      silently not written, which is the existing behaviour and the right one.
    */
    const { values, errors } = validateIntakeValues("fuelling", {
      lea_trains_fasted: true,
      parq_positive: true, // a health answer, sent to the fuelling section
    });
    expect(values).toEqual({ lea_trains_fasted: true });
    expect(errors).toEqual([]);
  });

  it("passes an allowed field with no schema through untouched", () => {
    // The known gap, stated honestly in the module: rejecting the untyped
    // Tier 1 preference fields would break the screens that write them.
    const field = SECTION_FIELDS.goal.find((f) => !INTAKE_FIELD_SCHEMAS[f]);
    expect(field, "every goal field is typed now — this test needs rewriting").toBeDefined();
    const { values, errors } = validateIntakeValues("goal", { [field!]: { anything: true } });
    expect(errors).toEqual([]);
    expect(values[field!]).toEqual({ anything: true });
  });

  it("bounds a number that reaches the engine", () => {
    // A 1e9 where a target lift belongs was stored and read back later by the
    // plan generator.
    expect(validateIntakeValues("goal", { target_squat_kg: 1e9 }).errors).toHaveLength(1);
    expect(validateIntakeValues("goal", { target_squat_kg: 180 }).errors).toEqual([]);
    // Nullish on purpose: clearing a target is an answer.
    expect(validateIntakeValues("goal", { target_squat_kg: null }).errors).toEqual([]);
  });

  it("reports every bad field, not just the first", () => {
    const { errors } = validateIntakeValues("health", {
      parq_positive: "no",
      chest_pain_on_exertion: 1,
    });
    expect(errors.map((e) => e.path).sort()).toEqual([
      "chest_pain_on_exertion",
      "parq_positive",
    ]);
  });
});
