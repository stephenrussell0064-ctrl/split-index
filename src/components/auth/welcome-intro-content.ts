/**
 * The three screens before sign-up, and the rule for when they show.
 *
 * Kept out of the component so the words and the rule can be tested without a
 * React renderer — the same split as `sanitizeOtpInput` in auth-form.tsx.
 *
 * WHY THREE SCREENS AND NOT A FORM
 * --------------------------------
 * The native app opens on /login. A first-time user tapped Download, opened
 * the app, and the first thing they saw was an email field: no idea what the
 * app does, what the score is, or why they would give it a password. So the
 * first screen is a hook, the second says what the app does — typed out, with
 * a haptic click per letter, so it is read rather than skimmed — and the third
 * is Sign in with Apple, which needs nothing filled in at all.
 *
 * Every screen advances on one tap. Skip is always visible.
 */

export const INTRO_SEEN_KEY = "split-index-intro-seen";

export interface IntroScreen {
  id: "hook" | "how" | "start";
  eyebrow: string;
  headline: string;
  /** Typed one after another. Keep each under ~80 characters: this is a phone. */
  lines: readonly string[];
}

export const INTRO_SCREENS: readonly IntroScreen[] = [
  {
    id: "hook",
    eyebrow: "Split Index",
    headline: "You lift. You run.\nNobody scores both.",
    lines: ["Until now. One number for the whole athlete, out of 100."],
  },
  {
    id: "how",
    eyebrow: "How it works",
    headline: "Log a session.\nGet a score.",
    lines: [
      "A lift, a run, a ride — typed in, or pulled from Apple Health.",
      "Strength and endurance scored separately, then together.",
      "See when one side is costing you the other, and get a week planned around it.",
    ],
  },
  {
    id: "start",
    eyebrow: "Ready",
    headline: "Nothing to fill in.",
    lines: ["Continue with Apple and you're in. Your details can wait."],
  },
];

export const LAST_INTRO_SCREEN = INTRO_SCREENS.length - 1;

/**
 * Whether to put the intro in front of the auth form.
 *
 * Sign-up: yes, once, on any platform — someone on /signup has not seen the
 * product yet. Login: only inside the native shell, because /login is the
 * app's launch URL and therefore a first-time user's first screen; on the web,
 * /login is where returning users go and the intro would be in their way.
 */
export function shouldShowIntro({
  mode,
  native,
  seen,
}: {
  mode: "login" | "signup";
  native: boolean;
  seen: boolean;
}): boolean {
  if (seen) return false;
  if (mode === "signup") return true;
  return native;
}

/** Which screen a tap moves to; `null` means the intro is over. */
export function nextIntroScreen(current: number): number | null {
  return current >= LAST_INTRO_SCREEN ? null : current + 1;
}
