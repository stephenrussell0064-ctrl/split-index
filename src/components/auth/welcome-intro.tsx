"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AppleIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { Typewriter } from "@/components/ui/typewriter";
import { impact } from "@/lib/native/haptics";
import { cn } from "@/lib/utils/cn";
import {
  INTRO_SCREENS,
  INTRO_SEEN_KEY,
  LAST_INTRO_SCREEN,
  nextIntroScreen,
} from "@/components/auth/welcome-intro-content";

/**
 * Remember that the intro has been seen — for THIS app session only.
 *
 * It was once-per-device (localStorage) at first, and the first thing
 * reported was "I don't see the onboarding messages any more": every launch
 * of the app without an account went straight to the login form after the
 * first. sessionStorage clears when the app is quit, so each cold launch
 * gets the intro, while signing out and back in during one session does not.
 */
function markSeen() {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: shown again next launch, which is harmless */
  }
}

/**
 * The hook, the pitch, and the one-tap way in — before any form.
 *
 * Three screens (welcome-intro-content.ts has the words and the reasons).
 * Each headline and line types itself with a haptic click per letter; a tap
 * anywhere on the screen finishes the typing, and the next tap advances. The
 * last screen carries the provider buttons directly so Sign in with Apple is
 * two taps from a cold launch, with nothing typed.
 *
 * The OAuth handlers are the auth form's own — passed in, not duplicated —
 * so there is still exactly one `signInWithOAuth` call in the codebase, which
 * privacy-manifest.test.ts pins.
 */
export function WelcomeIntro({
  onApple,
  onGoogle,
  onEmail,
}: {
  onApple: () => void;
  onGoogle: () => void;
  /** Dismisses the intro and shows the email form. */
  onEmail: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  // Lines typed so far on the current screen; the next starts when the
  // previous finishes, so the paragraph reads in order.
  const [typedLines, setTypedLines] = useState(0);
  const [revealAll, setRevealAll] = useState(false);

  const screen = INTRO_SCREENS[index]!;
  const isLast = index === LAST_INTRO_SCREEN;
  const fullyTyped = revealAll || typedLines >= screen.lines.length + 1;

  function goTo(next: number) {
    setIndex(next);
    setTypedLines(0);
    setRevealAll(false);
  }

  /** The one gesture: finish the typing if it is still going, else move on. */
  function advance() {
    impact("light");
    if (!fullyTyped) {
      setRevealAll(true);
      return;
    }
    const next = nextIntroScreen(index);
    if (next === null) {
      markSeen();
      onEmail();
      return;
    }
    if (next === LAST_INTRO_SCREEN) markSeen();
    goTo(next);
  }

  function skip() {
    impact("light");
    markSeen();
    goTo(LAST_INTRO_SCREEN);
  }

  function withSeen(action: () => void) {
    return () => {
      impact("medium");
      markSeen();
      action();
    };
  }

  const lineDone = () => setTypedLines((n) => n + 1);

  return (
    <div className="flex min-h-[70dvh] w-full max-w-md flex-col">
      <div className="mb-6 flex items-center justify-between">
        <BrandMark variant="full" href="/" logoHeight={28} priority />
        {!isLast && (
          <button
            type="button"
            onClick={skip}
            className="min-h-11 rounded-full px-3 text-sm text-muted transition-colors hover:text-foreground"
          >
            Skip
          </button>
        )}
      </div>

      {/*
        The whole screen is the tap target — a reader finishes a sentence by
        tapping where they are looking. The same `advance` sits on the Continue
        button below, which is the keyboard route (keyboard-operability.test.ts
        allows a container click when a real button does the same thing).
      */}
      <div className="flex flex-1 flex-col" onClick={advance}>
        <AnimatePresence mode="wait">
          <motion.div
            key={screen.id}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col justify-center py-6"
          >
            <p className="micro-label mb-4 text-accent">{screen.eyebrow}</p>
            <h1 className="headline-tight font-display text-[2rem] font-black leading-[1.05] sm:text-4xl">
              <Typewriter
                key={`${screen.id}-headline`}
                text={screen.headline}
                speedMs={34}
                instant={revealAll}
                onDone={lineDone}
              />
            </h1>
            <div className="mt-6 space-y-3 text-base leading-relaxed text-foreground/85">
              {screen.lines.map((line, i) => {
                const started = revealAll || typedLines >= i + 1;
                return (
                  <p key={line} className={cn("min-h-[1.6em]", !started && "invisible")}>
                    {started && (
                      <Typewriter
                        key={`${screen.id}-${i}`}
                        text={line}
                        speedMs={22}
                        startDelayMs={revealAll ? 0 : 180}
                        instant={revealAll}
                        onDone={lineDone}
                      />
                    )}
                  </p>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-6 space-y-3">
        <div className="mb-4 flex justify-center gap-1.5" aria-hidden>
          {INTRO_SCREENS.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === index ? "w-6 bg-accent" : "w-1.5 bg-white/20"
              )}
            />
          ))}
        </div>

        {isLast ? (
          <>
            {/*
              `outline`, not `secondary`: secondary carries the `.glass` class,
              whose stylesheet background beats the `bg-white` utility, which
              left a black-on-near-black Apple button. Apple's guidance is a
              white or black button; white reads best on this ground.
            */}
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2 border-white bg-white text-black hover:border-white hover:bg-white/90"
              onClick={withSeen(onApple)}
            >
              <AppleIcon className="h-5 w-5" />
              Continue with Apple
            </Button>
            <Button variant="secondary" size="lg" className="w-full gap-2" onClick={withSeen(onGoogle)}>
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </Button>
            <button
              type="button"
              onClick={withSeen(onEmail)}
              className="mx-auto block min-h-11 text-sm text-muted underline underline-offset-4 transition-colors hover:text-foreground"
            >
              Use email instead
            </button>
          </>
        ) : (
          <button type="button" className={buttonVariants({ size: "lg", className: "w-full" })} onClick={advance}>
            {fullyTyped ? "Continue" : "Tap to continue"}
          </button>
        )}
      </div>
    </div>
  );
}
