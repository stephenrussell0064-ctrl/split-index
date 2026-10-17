import { describe, expect, it } from "vitest";
import {
  INTRO_SCREENS,
  LAST_INTRO_SCREEN,
  nextIntroScreen,
  shouldShowIntro,
} from "./welcome-intro-content";

describe("when the intro shows", () => {
  it("shows on sign-up, once, everywhere", () => {
    expect(shouldShowIntro({ mode: "signup", native: false, seen: false })).toBe(true);
    expect(shouldShowIntro({ mode: "signup", native: true, seen: false })).toBe(true);
    expect(shouldShowIntro({ mode: "signup", native: true, seen: true })).toBe(false);
  });

  it("shows on login only inside the native shell, where /login is the launch screen", () => {
    expect(shouldShowIntro({ mode: "login", native: true, seen: false })).toBe(true);
    expect(shouldShowIntro({ mode: "login", native: false, seen: false })).toBe(false);
    expect(shouldShowIntro({ mode: "login", native: true, seen: true })).toBe(false);
  });
});

describe("the screens", () => {
  it("are three: a hook, the pitch, and the way in", () => {
    expect(INTRO_SCREENS.map((s) => s.id)).toEqual(["hook", "how", "start"]);
  });

  it("keep every typed line short enough for a phone", () => {
    for (const screen of INTRO_SCREENS) {
      for (const line of screen.lines) expect(line.length, line).toBeLessThanOrEqual(90);
      expect(screen.headline.length, screen.headline).toBeLessThanOrEqual(40);
    }
  });

  it("advance one at a time and end", () => {
    expect(nextIntroScreen(0)).toBe(1);
    expect(nextIntroScreen(LAST_INTRO_SCREEN)).toBeNull();
  });
});
