import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIMARY_NAV } from "@/lib/navigation/app-nav";
import { TOUR_STEPS } from "./tour-steps";

const SHELL = readFileSync(resolve(__dirname, "../layout/app-shell.tsx"), "utf8");

describe("the tour", () => {
  it("walks the bar left to right: Home, Train, +, Plan, Progress", () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual(["home", "train", "log", "plan", "progress"]);
  });

  it("calls each tab what the tab bar calls it", () => {
    const labels = new Map(PRIMARY_NAV.map((item) => [item.href, item.label]));
    expect(TOUR_STEPS[0]!.title).toBe(labels.get("/dashboard"));
    expect(TOUR_STEPS[1]!.title).toBe(labels.get("/train"));
    expect(TOUR_STEPS[3]!.title).toBe(labels.get("/hybrid-plan"));
    expect(TOUR_STEPS[4]!.title).toBe(labels.get("/progress"));
  });

  it("has a control in the shell to point at for every step", () => {
    // The shell derives the tab attributes from a map keyed by href and sets
    // the + button's by hand; both the phone bar and the sidebar carry them.
    for (const href of ["/dashboard", "/train", "/hybrid-plan", "/progress"]) {
      expect(SHELL).toContain(`"${href}":`);
    }
    expect(SHELL.match(/data-tour="log"/g)?.length).toBe(2);
    expect(SHELL.match(/data-tour=\{TOUR_TARGET_BY_HREF\[item\.href\]\}/g)?.length).toBe(2);
  });

  it("stays short — one sentence or two per step, five steps", () => {
    expect(TOUR_STEPS).toHaveLength(5);
    for (const step of TOUR_STEPS) expect(step.body.length, step.body).toBeLessThanOrEqual(120);
  });
});
