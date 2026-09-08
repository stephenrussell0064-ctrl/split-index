import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "@/lib/validation/boundary";
import { activityFieldsSchema, createActivitySchema, updateActivitySchema } from "./activity";
import type { ActivityFormData } from "@/types";

/**
 * The drift check `activity.ts` says is here.
 *
 * Its docblock: "Mirrors ActivityFormData in src/types/index.ts. Where the two
 * could drift, activity-schema.test.ts holds them together: a field added to
 * the type and not to the schema would be silently dropped on save, which is a
 * worse bug than a rejection because the athlete is told it worked."
 *
 * That file did not exist. This is it.
 *
 * Read from the SOURCE rather than from the type, because a TypeScript
 * interface leaves nothing behind at runtime to enumerate — and the whole
 * failure being guarded against is a field that exists in one place and not
 * the other, which a runtime check against an erased type cannot see. The
 * compile-time assertion at the bottom covers the same ground from the other
 * side, so an editor flags it before the suite does.
 */

const TYPES_FILE = fileURLToPath(new URL("../../../types/index.ts", import.meta.url));

function activityFormDataKeys(): string[] {
  const src = readFileSync(TYPES_FILE, "utf8");
  const start = src.indexOf("export interface ActivityFormData {");
  if (start === -1) {
    throw new Error("ActivityFormData is not in src/types/index.ts under that name any more.");
  }
  const body = src.slice(start, src.indexOf("\n}", start));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(([, key]) => key);
}

function schemaKeys(): string[] {
  return Object.keys(activityFieldsSchema.shape);
}

/**
 * Schema fields with no counterpart in ActivityFormData, each deliberate.
 *
 * Listed rather than tolerated as a class: the reverse direction catches a
 * misspelled schema key, which is the same silent drop wearing the other
 * costume — `.strict()` would then reject the correctly-spelled field the
 * client sends.
 */
const NOT_IN_THE_FORM_TYPE: Record<string, string> = {
  route: "The GPS polyline. The handler reaches it through a cast, which is how .strict() found it.",
  bodyweight_kg: "Sits in a denominator in relative_strength; sent alongside the form data.",
  exercise_notes: "Per-exercise notes, keyed by exercise.",
  client_request_id: "The offline queue's idempotency key, added by submitActivityRequest.",
};

describe("the schema and ActivityFormData do not drift", () => {
  it("has a schema field for every field on the type", () => {
    const missing = activityFormDataKeys().filter((k) => !schemaKeys().includes(k));
    // Named, because the name is what tells you which field is being dropped
    // on save while the athlete is told the session was recorded.
    expect(missing).toEqual([]);
  });

  it("has a stated reason for every schema field the type does not have", () => {
    const unexplained = schemaKeys().filter(
      (k) => !activityFormDataKeys().includes(k) && !NOT_IN_THE_FORM_TYPE[k]
    );
    expect(unexplained).toEqual([]);
  });

  it("reads a type that is still there to read", () => {
    // A rename turns the parser above into a silent pass, which would be this
    // file failing in exactly the way it was written to prevent.
    expect(activityFormDataKeys().length).toBeGreaterThan(25);
    expect(activityFormDataKeys()).toContain("sport");
    expect(activityFormDataKeys()).toContain("duration_seconds");
  });
});

describe("what .strict() is load-bearing for", () => {
  const valid = {
    sport: "running",
    started_at: "2026-09-01T07:30:00.000Z",
    duration_seconds: 1800,
    distance_meters: 5000,
  };

  it("takes a plain session", () => {
    expect(createActivitySchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a key nobody validated", () => {
    // The handler spreads parts of this straight into a Supabase insert, so an
    // unknown key is an attempt to write a column no schema checked.
    expect(createActivitySchema.safeParse({ ...valid, user_id: "someone-else" }).success).toBe(
      false
    );
    expect(createActivitySchema.safeParse({ ...valid, split_index: 999 }).success).toBe(false);
  });

  it("keeps the offline queue's idempotency key, which strict would otherwise reject", () => {
    // Leaving this undeclared would turn every replayed submission into a 400
    // and break offline sync outright — silently, for anyone logging on a bad
    // connection.
    expect(
      createActivitySchema.safeParse({ ...valid, client_request_id: "run-2026-09-01-abc" }).success
    ).toBe(true);
  });

  it("keeps the GPS route, which is not on the form type at all", () => {
    const body = { ...valid, source: "gps", route: [[51.5, -0.12], [51.51, -0.13]] };
    expect(createActivitySchema.safeParse(body).success).toBe(true);
  });

  it("drops a malformed route rather than refusing the run", () => {
    /*
      The one field with `.catch(undefined)`, and the route's own rule for why:
      "a bad route should cost the athlete their map, not their run."
    */
    const parsed = createActivitySchema.safeParse({ ...valid, route: "not a polyline" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.route).toBeUndefined();
  });

  it("still refuses a route far past what sanitizeRoute would trim", () => {
    const huge = Array.from({ length: 20_001 }, (_, i) => [51.5 + i * 1e-6, -0.12]);
    const parsed = createActivitySchema.safeParse({ ...valid, route: huge });
    // Caught by the cap, then dropped rather than rejected — same rule.
    expect(parsed.success && parsed.data.route).toBeUndefined();
  });
});

describe("the cross-field rules, and where they deliberately do not apply", () => {
  const gym = {
    sport: "gym",
    started_at: "2026-09-01T07:30:00.000Z",
    duration_seconds: 3600,
  };

  it("refuses a gym session with no exercises", () => {
    // Caught here rather than downstream so the athlete is told, instead of
    // getting an activity with a null index.
    expect(createActivitySchema.safeParse(gym).success).toBe(false);
    expect(createActivitySchema.safeParse({ ...gym, exercises: [] }).success).toBe(false);
  });

  it("takes a gym session that has one", () => {
    const body = {
      ...gym,
      exercises: [
        {
          exercise_name: "Back squat",
          muscle_group: "legs",
          order_index: 0,
          sets: [{ weight_kg: 100, reps: 5 }],
        },
      ],
    };
    expect(createActivitySchema.safeParse(body).success).toBe(true);
  });

  it("does not apply that rule to a partial update", () => {
    /*
      A PATCH touching only `notes` carries no exercises and would fail the
      "a gym session needs an exercise" refinement despite changing nothing
      about them. The handler re-scores from the stored row, which is where
      that invariant actually holds.
    */
    expect(updateActivitySchema.safeParse({ notes: "Felt strong." }).success).toBe(true);
    expect(updateActivitySchema.safeParse({ sport: "gym" }).success).toBe(true);
  });

  it("keeps refusing unknown keys on a partial update", () => {
    // `.partial()` relaxes which fields are required, not which are allowed.
    expect(updateActivitySchema.safeParse({ notes: "ok", user_id: "someone" }).success).toBe(false);
  });

  it("refuses a bodyweight that would wreck a strength score", () => {
    // It sits in a denominator in relative_strength: a 0 divides, and a 1
    // produces a score two orders of magnitude wrong — stored, and read back
    // as history by every later estimate.
    expect(updateActivitySchema.safeParse({ bodyweight_kg: 0 }).success).toBe(false);
    expect(updateActivitySchema.safeParse({ bodyweight_kg: 1 }).success).toBe(false);
    expect(updateActivitySchema.safeParse({ bodyweight_kg: 82.5 }).success).toBe(true);
  });
});

/*
 * The same drift, caught by the compiler.
 *
 * If a field is added to ActivityFormData and not to the schema, `Missing`
 * stops being `never` and this assignment stops type-checking — which surfaces
 * in the editor, on the line, before the suite is ever run.
 */
type SchemaKeys = keyof z.infer<typeof activityFieldsSchema>;
type Missing = Exclude<keyof ActivityFormData, SchemaKeys>;
const NO_FIELD_IS_MISSING: Missing extends never ? true : ["missing from the schema:", Missing] =
  true;

describe("the compiler agrees", () => {
  it("has nothing missing", () => {
    expect(NO_FIELD_IS_MISSING).toBe(true);
  });
});
