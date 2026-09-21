import { describe, expect, it } from "vitest";
import {
  MAX_TARGET_INDEX,
  MIN_TARGET_INDEX,
  article9ConsentSchema,
  createGoalSchema,
  createRaceSchema,
  draftSchema,
  duelActionSchema,
  friendActionSchema,
  friendRequestSchema,
  mergeSchema,
  reactionSchema,
  rolloutSchema,
  sessionTemplateSchema,
  updateGoalSchema,
} from "./routes";

/**
 * THE FIRST BLOCK IS THE POINT OF THIS FILE.
 *
 * These schemas replaced hand-rolled checks on eleven routes, and every one of
 * them is `.strict()`. Strict is the right default — an unknown key is either a
 * typo or an attempt — but it converts a mistake in the schema into a 400 on a
 * request that worked yesterday, and the athlete's half of that is a button
 * that has simply stopped doing anything.
 *
 * Two such mistakes were caught before the commit by reading the callers:
 * `dryRun` on the merge dialog, and `targetDate` where the client sends
 * `deadline`. A third was not, and is fixed in the same change as this file:
 * the goal editor posts `targetSplitIndex: null` when the target field is
 * cleared, `validateTarget` reads that as "no target" and writes null, and
 * `z.number().optional()` rejected it.
 *
 * So the bodies below are copied from the real callers, named by file, rather
 * than invented here. A schema that parses an invented body proves nothing.
 */
describe("the body each caller actually sends", () => {
  it("feed-panel scores a session", () => {
    expect(reactionSchema.safeParse({ score: 7 }).success).toBe(true);
  });

  it("use-autosave saves a draft", () => {
    const body = { sport: "gym", formData: { notes: "", sets: [{ reps: 5 }] } };
    expect(draftSchema.safeParse(body).success).toBe(true);
  });

  it("merge-activities-modal previews, then merges", () => {
    // Version-4 uuids, checked digit by digit: zod validates the version and
    // variant nibbles, so the familiar "6f9619ff-8b86-d011-..." example GUID —
    // version 'd' — is refused. Which is the same lesson the merge fixtures
    // taught, arriving again in this file's own test data.
    const ids = [
      "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    ];
    // The preview carries dryRun; the merge itself does not.
    expect(mergeSchema.safeParse({ activityIds: ids, dryRun: true }).success).toBe(true);
    expect(mergeSchema.safeParse({ activityIds: ids }).success).toBe(true);
  });

  it("article9-consent-card echoes the version on screen", () => {
    expect(article9ConsentSchema.safeParse({ acknowledgedVersion: "2026-01" }).success).toBe(true);
  });

  it("duels-panel answers a challenge three ways", () => {
    for (const action of ["accept", "decline", "cancel"]) {
      expect(duelActionSchema.safeParse({ action }).success, action).toBe(true);
    }
  });

  it("friends-panel sends and answers a request", () => {
    expect(friendRequestSchema.safeParse({ username: "rachel" }).success).toBe(true);
    // Pasting the handle with its @ is not a validation error; the handler
    // strips it before the lookup.
    expect(friendRequestSchema.safeParse({ username: "@rachel" }).success).toBe(true);
    const body = { id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff", action: "accept" };
    expect(friendActionSchema.safeParse(body).success).toBe(true);
  });

  it("goals-card creates a goal, with and without the optional fields", () => {
    expect(
      createGoalSchema.safeParse({
        title: "Sub-40 10k",
        targetSplitIndex: 820,
        deadline: "2026-12-01",
      }).success
    ).toBe(true);
    // setSuggestedGoal sends the target alone.
    expect(createGoalSchema.safeParse({ targetSplitIndex: 820 }).success).toBe(true);
  });

  it("goals-card clears a target by sending null", () => {
    /*
      THE ONE THAT BROKE. `targetSplitIndex: target === "" ? null : ...` in the
      editor, and `validateTarget` treats null as "no target" and writes null
      to the column — a supported edit that started answering 400.
    */
    const body = {
      id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
      title: "Sub-40 10k",
      targetSplitIndex: null,
      deadline: null,
    };
    expect(updateGoalSchema.safeParse(body).success).toBe(true);
  });

  it("goals-card ticks a goal off with two fields", () => {
    const body = { id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff", completed: true };
    expect(updateGoalSchema.safeParse(body).success).toBe(true);
  });

  it("fleet-dashboard changes the rollout one control at a time", () => {
    const reason = "Widening to 25% after a clean week.";
    expect(rolloutSchema.safeParse({ enabled: true, reason }).success).toBe(true);
    expect(rolloutSchema.safeParse({ percentage: 25, reason }).success).toBe(true);
  });

  it("upcoming-races-panel saves a race, including the empty optional fields", () => {
    /*
      `distanceMeters` and `elevationGainMeters` come straight off form state,
      so an untouched optional field posts "". The handler does the conversion
      and reads "" as "not given" — which is why these stay loose. A tighter
      schema here would be a regression, not an improvement.
    */
    const body = {
      eventName: "Snowdonia Trail Marathon",
      locationName: "",
      raceDate: "2026-07-18",
      distanceMeters: "",
      elevationGainMeters: null,
      elevationSource: null,
    };
    expect(createRaceSchema.safeParse(body).success).toBe(true);
  });

  it("activity-form saves a session as a template", () => {
    const body = { name: "Threshold 4x8", sport: "running", template_data: { blocks: [] } };
    expect(sessionTemplateSchema.safeParse(body).success).toBe(true);
  });
});

/**
 * The gaps the schemas exist to close. Each of these was reachable before:
 * `body.action as "accept" | "decline"` is a promise to the compiler and
 * nothing to the runtime, and `const body: ActivityBody = await request.json()`
 * is the same thing across seventeen fields.
 */
describe("what the schemas refuse", () => {
  it("refuses a string that is not one of the actions", () => {
    expect(duelActionSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(friendActionSchema.safeParse({
      id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
      action: "cancel", // a duel action, not a friend-request one
    }).success).toBe(false);
  });

  it("refuses an id the database could not have produced", () => {
    // activities.id is UUID PRIMARY KEY. A non-uuid in a WHERE clause is a
    // Postgres cast error, not a miss — which is how fifteen merge fixtures
    // were found to be describing a request that cannot happen.
    expect(mergeSchema.safeParse({ activityIds: ["leg-a", "leg-b"] }).success).toBe(false);
  });

  it("refuses a merge of fewer than two sessions", () => {
    expect(
      mergeSchema.safeParse({ activityIds: ["6f9619ff-8b86-4011-b42d-00cf4fc964ff"] }).success
    ).toBe(false);
  });

  it("refuses a score outside 1 to 10, and a fractional one", () => {
    expect(reactionSchema.safeParse({ score: 0 }).success).toBe(false);
    expect(reactionSchema.safeParse({ score: 11 }).success).toBe(false);
    expect(reactionSchema.safeParse({ score: 7.5 }).success).toBe(false);
  });

  it("refuses a target outside the range, on both verbs", () => {
    expect(createGoalSchema.safeParse({ targetSplitIndex: MIN_TARGET_INDEX - 1 }).success).toBe(false);
    expect(createGoalSchema.safeParse({ targetSplitIndex: MAX_TARGET_INDEX + 1 }).success).toBe(false);
    const id = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
    expect(updateGoalSchema.safeParse({ id, targetSplitIndex: 10 }).success).toBe(false);
  });

  it("refuses a rollout change with no reason worth reading", () => {
    // The audit row is the only thing that will explain this change to whoever
    // reads it in three months, including the person making it.
    expect(rolloutSchema.safeParse({ enabled: true, reason: "because" }).success).toBe(false);
    expect(rolloutSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(rolloutSchema.safeParse({ percentage: 101, reason: "a good long reason" }).success).toBe(
      false
    );
  });

  it("refuses a consent version that is not text", () => {
    // A null here would reach an equality check against the shipped version
    // and quietly answer false, recording nothing and reporting success.
    expect(article9ConsentSchema.safeParse({ acknowledgedVersion: null }).success).toBe(false);
  });

  it("refuses a sport the app does not have", () => {
    expect(draftSchema.safeParse({ sport: "quidditch", formData: {} }).success).toBe(false);
  });

  it("refuses an unknown key on every one of them", () => {
    // `.strict()` is what makes the list above worth keeping accurate: a key
    // the schema does not know is a 400, not an ignored field.
    expect(reactionSchema.safeParse({ score: 7, admin: true }).success).toBe(false);
    expect(duelActionSchema.safeParse({ action: "accept", userId: "someone" }).success).toBe(false);
    expect(
      sessionTemplateSchema.safeParse({
        name: "Threshold",
        sport: "running",
        template_data: {},
        user_id: "someone-else",
      }).success
    ).toBe(false);
  });

  it("refuses free text longer than the column will hold", () => {
    expect(
      createRaceSchema.safeParse({
        eventName: "x".repeat(121),
        raceDate: "2026-07-18",
      }).success
    ).toBe(false);
    expect(friendRequestSchema.safeParse({ username: "x".repeat(22) }).success).toBe(false);
  });
});
