import { describe, expect, it } from "vitest";
import { resolveCardioPlan } from "./modality";

/**
 * Two notes that said the wrong thing, both found by rebuilding a real block
 * and reading it rather than by a failing assertion.
 */

describe("modality note", () => {
  it("does not promise a runner they will never be asked to run", () => {
    // The reassurance is aimed at someone who picked rowing or the bike. It was
    // appended unconditionally, so a runner read: "Every endurance session here
    // is running... Nothing in this plan will ask you to run."
    const plan = resolveCardioPlan(["run"], false, "run");
    const note = plan.notes.find((n) => n.includes("Every endurance session here is"));

    expect(note).toBeDefined();
    expect(note).toContain("running");
    expect(note).not.toContain("Nothing in this plan will ask you to run");
  });

  it("still reassures an athlete whose chosen modality is not running", () => {
    const plan = resolveCardioPlan(["row"], false, "row");
    const note = plan.notes.find((n) => n.includes("Every endurance session here is"));

    expect(note).toContain("rowing");
    expect(note).toContain("Nothing in this plan will ask you to run");
  });
});
