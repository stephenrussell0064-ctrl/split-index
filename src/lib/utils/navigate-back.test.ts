import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateBack, zoneHomeFor } from "./navigate-back";

function router() {
  return { push: vi.fn(), back: vi.fn() } as unknown as Parameters<typeof navigateBack>[0];
}

/** These tests run in node; only `window.history.length` is read, so that is all that is stubbed. */
function stubHistoryLength(length: number) {
  vi.stubGlobal("window", { history: { length } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("zoneHomeFor", () => {
  it("maps pages inside a training zone to that zone's home", () => {
    expect(zoneHomeFor("/cardio/gps-run")).toBe("/cardio");
    expect(zoneHomeFor("/cardio/log")).toBe("/cardio");
    expect(zoneHomeFor("/gym/log")).toBe("/gym");
  });

  it("treats the zone roots themselves and everything else as outside a zone", () => {
    expect(zoneHomeFor("/cardio")).toBeNull();
    expect(zoneHomeFor("/gym")).toBeNull();
    expect(zoneHomeFor("/activities/123")).toBeNull();
    expect(zoneHomeFor("/dashboard")).toBeNull();
  });
});

describe("navigateBack", () => {
  it("goes to The Engine from the GPS tracking screen regardless of history (user report: Back did not return to the Engine)", () => {
    const r = router();
    navigateBack(r, "/cardio/gps-run");
    expect(r.push).toHaveBeenCalledWith("/cardio");
    expect(r.back).not.toHaveBeenCalled();
  });

  it("goes to The Lab from a Lab sub-page", () => {
    const r = router();
    navigateBack(r, "/gym/log");
    expect(r.push).toHaveBeenCalledWith("/gym");
  });

  it("uses browser history outside the zones when there is somewhere to go back to", () => {
    const r = router();
    stubHistoryLength(3);
    navigateBack(r, "/activities/123");
    expect(r.back).toHaveBeenCalled();
    expect(r.push).not.toHaveBeenCalled();
  });

  it("falls back to the dashboard on a deep link with no history", () => {
    const r = router();
    stubHistoryLength(1);
    navigateBack(r, "/activities/123");
    expect(r.push).toHaveBeenCalledWith("/dashboard");
  });
});
