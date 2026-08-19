import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The point of these tests is the one distinction the shipped code got
 * wrong: "the widget didn't update" is not one outcome, it is four, and
 * exactly one of them ("disconnected" — the App Group isn't live on the
 * build) is permanent and invisible from the widget's side. Collapsing them
 * into a bare `false` is what let an athlete with a full training history
 * read "Log a run to see predictions" on their home screen.
 */

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  clear: vi.fn(),
  status: vi.fn(),
  platform: { native: true, name: "ios" as "ios" | "android" | "web" },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    set: mocks.set,
    clear: mocks.clear,
    status: mocks.status,
  }),
}));

vi.mock("./platform", () => ({
  isNativePlatform: () => mocks.platform.native,
  getNativePlatform: () => mocks.platform.name,
}));

import {
  publishRacePredictions,
  getRacePredictionWidgetStatus,
} from "./race-predictions";

const payload = {
  status: "ready" as const,
  headline: { label: "5K", seconds: 1089 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.native = true;
  mocks.platform.name = "ios";
});

describe("publishRacePredictions", () => {
  it("reports success when the payload reached the shared container", async () => {
    mocks.set.mockResolvedValue({ stored: true, containerReachable: true });
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: true,
    });
  });

  it("names the App Group as the cause when the container is unreachable", async () => {
    mocks.set.mockResolvedValue({ stored: false, containerReachable: false });
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "disconnected",
    });
  });

  it("distinguishes a failed write from an unreachable container", async () => {
    mocks.set.mockResolvedValue({ stored: false, containerReachable: true });
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "writeFailed",
    });
  });

  it("does not claim 'disconnected' on a native build that can't report reachability", async () => {
    // An older install answers `set` without the field. Diagnosing a
    // permanent signing fault from a missing key would send the athlete to
    // reinstall for no reason.
    mocks.set.mockResolvedValue({ stored: false });
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "writeFailed",
    });
  });

  it("reports a rejecting bridge as its own outcome", async () => {
    mocks.set.mockRejectedValue(new Error("not implemented on ios"));
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "bridgeUnavailable",
    });
  });

  it("is a no-op off iOS and never touches the bridge", async () => {
    mocks.platform.name = "android";
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "unsupported",
    });

    mocks.platform.native = false;
    mocks.platform.name = "web";
    await expect(publishRacePredictions(payload)).resolves.toEqual({
      published: false,
      reason: "unsupported",
    });

    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("getRacePredictionWidgetStatus", () => {
  it("passes the native container report through", async () => {
    const report = {
      containerReachable: true,
      state: "published" as const,
      status: "ready" as const,
      sampleCount: 12,
      headlineSeconds: 1089,
    };
    mocks.status.mockResolvedValue(report);
    await expect(getRacePredictionWidgetStatus()).resolves.toEqual(report);
  });

  it("returns null rather than throwing when the native build has no status method", async () => {
    mocks.status.mockRejectedValue(new Error("not implemented"));
    await expect(getRacePredictionWidgetStatus()).resolves.toBeNull();
  });

  it("returns null off iOS so the settings card stays hidden", async () => {
    mocks.platform.native = false;
    mocks.platform.name = "web";
    await expect(getRacePredictionWidgetStatus()).resolves.toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
