import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTourForTests, endTour, isTourActive, startTour, subscribeTour, tourServerSnapshot } from "./tour-state";

describe("tour state", () => {
  beforeEach(() => _resetTourForTests());

  it("is off on the server and off until asked", () => {
    expect(tourServerSnapshot()).toBe(false);
    expect(isTourActive()).toBe(false);
  });

  it("notifies subscribers on start and end, once each", () => {
    const listener = vi.fn();
    subscribeTour(listener);
    startTour();
    startTour();
    expect(isTourActive()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    endTour();
    endTour();
    expect(isTourActive()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("survives a missing localStorage", () => {
    startTour();
    expect(() => endTour()).not.toThrow();
  });
});
