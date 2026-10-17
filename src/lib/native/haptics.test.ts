import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    selectionStart: vi.fn(() => Promise.resolve()),
    selectionChanged: vi.fn(() => Promise.resolve()),
    selectionEnd: vi.fn(() => Promise.resolve()),
    impact: vi.fn(() => Promise.resolve()),
    notification: vi.fn(() => Promise.resolve()),
  },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: { Success: "SUCCESS" },
}));
vi.mock("./platform", () => ({ isNativePlatform: () => false }));

import { Haptics } from "@capacitor/haptics";
import { hapticsAvailable, impact, shouldTick, success, tick } from "./haptics";

describe("haptics outside the native shell", () => {
  it("are a no-op — nothing reaches the plugin and nothing throws", () => {
    expect(hapticsAvailable()).toBe(false);
    tick();
    impact("heavy");
    success();
    expect(Haptics.selectionChanged).not.toHaveBeenCalled();
    expect(Haptics.impact).not.toHaveBeenCalled();
    expect(Haptics.notification).not.toHaveBeenCalled();
  });
});

describe("the typing click", () => {
  it("is rate-limited so a fast typewriter cannot outrun the engine", () => {
    expect(shouldTick(1000, 1000)).toBe(false);
    expect(shouldTick(1030, 1000)).toBe(false);
    expect(shouldTick(1036, 1000)).toBe(true);
  });
});
