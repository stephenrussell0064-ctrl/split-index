import { describe, expect, it } from "vitest";
import { buildPrescribedActivityPayload, prescribedStartedAt } from "./log-prescribed-control";
import { createActivitySchema } from "@/lib/validation/schemas/activity";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

describe("buildPrescribedActivityPayload", () => {
  const text =
    "Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3 · Leg press 3x10-15 @ 145-165kg · Pull-up 3x8-12 · Weighted plank 3x45s";

  it("turns the prescription into the activity the form would have built, every set accepted", () => {
    const payload = buildPrescribedActivityPayload({
      sessionId: SESSION_ID,
      prescriptionText: text,
      title: "Legs",
      startedAt: new Date("2026-10-10T07:30:00.000Z"),
      minutes: 55,
    });
    expect(payload).not.toBeNull();
    expect(payload!.sport).toBe("gym");
    expect(payload!.hpe_session_id).toBe(SESSION_ID);
    expect(payload!.duration_seconds).toBe(55 * 60);
    expect(payload!.exercises?.map((e) => e.exercise_name)).toEqual([
      "Back squat",
      "Leg press",
      "Pull-up",
      "Weighted plank",
    ]);
    // 4 + 3 + 3 + 3 sets, none edited: this is the whole point of one tap.
    expect(payload!.prescribed_sets).toEqual({ accepted: 13, edited: 0 });
  });

  it("fills each set from the band's midpoint, the way the form does", () => {
    const payload = buildPrescribedActivityPayload({
      sessionId: SESSION_ID,
      prescriptionText: text,
      title: "Legs",
      startedAt: new Date(),
      minutes: 55,
    })!;
    const squat = payload.exercises![0];
    expect(squat.sets).toHaveLength(4);
    expect(squat.sets[0]).toMatchObject({ weight_kg: 127.5, reps: 4, rpe: null, reps_in_reserve: null });
    const pullUp = payload.exercises![2];
    expect(pullUp.weight_entry_mode).toBe("added");
    expect(pullUp.sets[0]).toMatchObject({ weight_kg: 0, reps: 10 });
    const plank = payload.exercises![3];
    expect(plank.sets[0]).toMatchObject({ weight_kg: 0, reps: 1, duration_seconds: 45 });
  });

  it("is a body the activities route would accept", () => {
    // The route's schema is .strict(): one key the form never sends and the
    // whole one-tap path 400s. Held here so a schema change surfaces as a test.
    const payload = buildPrescribedActivityPayload({
      sessionId: SESSION_ID,
      prescriptionText: text,
      title: "Legs",
      startedAt: new Date(),
      minutes: 55,
    })!;
    const parsed = createActivitySchema.safeParse(payload);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it("refuses to build when any line has no load to log", () => {
    // "Lateral raise 3x12-15" has no number; logging it at 0 kg would be invented data.
    expect(
      buildPrescribedActivityPayload({
        sessionId: SESSION_ID,
        prescriptionText: "Bench 4x3-5 @ 80-90kg (80-90% 1RM), RIR 2-3 · Lateral raise 3x12-15",
        title: "Push",
        startedAt: new Date(),
        minutes: 40,
      })
    ).toBeNull();
  });

  it("never sends a zero duration", () => {
    const payload = buildPrescribedActivityPayload({
      sessionId: SESSION_ID,
      prescriptionText: "Pull-up 3x8-12",
      title: "Pull",
      startedAt: new Date(),
      minutes: 0,
    })!;
    expect(payload.duration_seconds).toBe(60);
  });
});

describe("prescribedStartedAt", () => {
  it("is now for today's session", () => {
    const before = Date.now();
    const at = prescribedStartedAt(new Date("2026-10-10T00:00:00"), 0).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it("is midday on the scheduled day for a past session", () => {
    const at = prescribedStartedAt(new Date(2026, 9, 7), -3);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(7);
    expect(at.getHours()).toBe(12);
  });
});
