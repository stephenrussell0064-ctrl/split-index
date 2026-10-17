"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { startTicks, stopTicks, tick } from "@/lib/native/haptics";
import { cn } from "@/lib/utils/cn";

/**
 * Text that types itself, with a haptic click per character on the phone.
 *
 * Used by the welcome intro and the onboarding greeting — the two screens
 * whose job is to say what the app does before asking for anything. A line
 * that appears one letter at a time is read; a paragraph that appears at once
 * is skipped. The click under each letter is what makes it feel like the app
 * is talking rather than loading.
 *
 * Reduced motion: the whole string renders at once and `onDone` fires
 * immediately. No clicks either — the preference is about sensory load.
 *
 * `instant` lets a parent cut the animation short (a tap on the screen) so
 * nobody is held hostage by a slow reveal. Once instant, it stays instant.
 */
export function Typewriter({
  text,
  speedMs = 26,
  startDelayMs = 0,
  haptics = true,
  instant = false,
  onDone,
  className,
  cursor = true,
}: {
  text: string;
  /** Milliseconds per character. */
  speedMs?: number;
  startDelayMs?: number;
  haptics?: boolean;
  /** Render the whole string now and skip the animation. */
  instant?: boolean;
  onDone?: () => void;
  className?: string;
  /** Draw a blinking caret while typing. */
  cursor?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const skip = instant || reducedMotion === true;
  const [count, setCount] = useState(skip ? text.length : 0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (doneRef.current) return;
    if (skip) {
      doneRef.current = true;
      onDoneRef.current?.();
      return;
    }

    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (haptics) void startTicks();
      interval = setInterval(() => {
        i += 1;
        setCount(i);
        // No click on a space: the rhythm of the words is what the hand feels.
        if (haptics && text[i - 1] !== " ") tick();
        if (i >= text.length) {
          clearInterval(interval);
          if (haptics) void stopTicks();
          doneRef.current = true;
          onDoneRef.current?.();
        }
      }, speedMs);
    }, startDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      if (haptics) void stopTicks();
    };
    // The string is fixed for the life of the element: a new string is a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  const shown = skip ? text.length : count;
  const typing = shown < text.length;

  return (
    <span className={cn("whitespace-pre-line", className)} aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {cursor && typing && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] animate-pulse bg-accent align-baseline"
        />
      )}
    </span>
  );
}
