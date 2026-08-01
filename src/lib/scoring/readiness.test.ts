import { describe, expect, it } from "vitest";
import { computeReadiness } from "./readiness";
import type { TimelineSession } from "./timeline";

function session(
  domain: "strength" | "cardio",
  daysAgo: number,
  loadScore: number
): TimelineSession {
  return {
    activityId: `${domain}-${daysAgo}-${Math.random()}`,
    sport: domain === "strength" ? "gym" : "running",
    domain,
    startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    durationSeconds: 2400,
    sessionType: domain === "cardio" ? "easy" : null,
    avgHeartRate: domain === "cardio" ? 140 : null,
    avgPaceSecondsPerKm: null,
    loadScore,
    enduranceComponent: domain === "cardio" ? 500 : null,
    strengthComponent: domain === "strength" ? 500 : null,
    efficiencyFactor: null,
  };
}

describe("computeReadiness", () => {
  it("returns a fully-ready state with no recent training", () => {
    const result = computeReadiness([]);
    expect(result.readiness).toBeGreaterThanOrEqual(70);
    expect(result.gymAcwr).toBeNull();
    expect(result.cardioAcwr).toBeNull();
    expect(result.reason).toMatch(/fully ready/i);
  });

  it("identifies strength training as the driver when only gym load is elevated", () => {
    // Heavy recent gym load, nothing in the chronic window before it, no cardio at all.
    const sessions: TimelineSession[] = [
      session("strength", 1, 300),
      session("strength", 3, 300),
      session("strength", 5, 300),
    ];
    const result = computeReadiness(sessions);
    expect(result.gymElevated).toBe(true);
    expect(result.cardioElevated).toBe(false);
    if (result.readiness < 70) {
      expect(result.reason).toMatch(/strength training is the main driver/i);
    }
  });

  it("identifies cardio volume as the driver when only cardio load is elevated", () => {
    const sessions: TimelineSession[] = [
      session("cardio", 1, 300),
      session("cardio", 3, 300),
      session("cardio", 5, 300),
    ];
    const result = computeReadiness(sessions);
    expect(result.cardioElevated).toBe(true);
    expect(result.gymElevated).toBe(false);
    if (result.readiness < 70) {
      expect(result.reason).toMatch(/cardio volume is the main driver/i);
    }
  });

  it("describes both domains stacking when both are elevated at once", () => {
    const sessions: TimelineSession[] = [
      session("strength", 1, 300),
      session("strength", 3, 300),
      session("cardio", 2, 300),
      session("cardio", 4, 300),
    ];
    const result = computeReadiness(sessions);
    expect(result.gymElevated).toBe(true);
    expect(result.cardioElevated).toBe(true);
    expect(result.reason).toMatch(/both stacking/i);
  });

  it("readiness score stays within 0-100", () => {
    const sessions: TimelineSession[] = Array.from({ length: 20 }, (_, i) =>
      session(i % 2 === 0 ? "strength" : "cardio", i, 500)
    );
    const result = computeReadiness(sessions);
    expect(result.readiness).toBeGreaterThanOrEqual(0);
    expect(result.readiness).toBeLessThanOrEqual(100);
  });
});
