"use client";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/components/ui/use-dialog";
import { impact, success } from "@/lib/native/haptics";
import { endTour, isTourActive, subscribeTour, tourServerSnapshot } from "@/lib/tour/tour-state";
import { TOUR_STEPS, type TourTarget } from "@/components/tour/tour-steps";
import { cn } from "@/lib/utils/cn";

/**
 * The spotlight tour over the tab bar.
 *
 * Mounted once in the app shell and invisible until `startTour()` is called
 * (the end of onboarding offers it; /help can replay it). Five steps, one per
 * control on the bar, each a sentence. A spotlight cut out of a dimming layer
 * sits over the real control — found by its `data-tour` attribute — so the
 * tour points at the thing itself rather than a picture of it.
 *
 * The dim is a box-shadow on the spotlight, not a backdrop element, so the
 * control stays visible through the hole. `useDialog` gives it the dialog
 * semantics, the focus trap and Escape-to-skip that any full-screen layer
 * owes a keyboard user.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;

/** The visible element carrying this target — the phone bar's or the sidebar's, whichever is laid out. */
function findTarget(target: TourTarget): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)
  );
  return candidates.find((el) => el.offsetParent !== null) ?? candidates[0] ?? null;
}

function measure(target: TourTarget): Rect | null {
  const el = findTarget(target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

export function AppTour() {
  const active = useSyncExternalStore(subscribeTour, isTourActive, tourServerSnapshot);
  return <AnimatePresence>{active && <TourOverlay key="tour" />}</AnimatePresence>;
}

function TourOverlay() {
  const reducedMotion = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = TOUR_STEPS[stepIndex]!;
  const last = stepIndex === TOUR_STEPS.length - 1;

  const close = () => {
    endTour();
  };
  const { dialogRef, dialogProps } = useDialog(close, { label: "Quick tour" });

  // Measure before paint so the spotlight never flashes at the wrong place,
  // and re-measure on resize and scroll (the bar is fixed, but the sidebar
  // is in flow on desktop).
  useLayoutEffect(() => {
    const update = () => setRect(measure(step.target));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  useEffect(() => {
    impact("light");
  }, [stepIndex]);

  function next() {
    if (last) {
      success();
      close();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  // Card above the control when the control is in the lower half (the phone
  // bar), below it otherwise (a sidebar entry near the top on desktop).
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const placeAbove = rect ? rect.top + rect.height / 2 > viewportH / 2 : true;

  return (
    <motion.div
      ref={dialogRef}
      {...dialogProps}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50"
    >
      {/*
        The spotlight: a transparent box whose shadow is the dim. Positioned
        with a plain inline style and a CSS transition rather than a Framer
        animation, so the hole is over the control on the very first paint —
        an animated `top`/`left` starts from nowhere and, when the page is not
        being drawn (a background tab), never arrives.
      */}
      <div
        aria-hidden
        style={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : { opacity: 0 }}
        className={cn(
          "pointer-events-none absolute rounded-2xl ring-2 ring-accent/80 shadow-[0_0_0_200vmax_rgba(0,0,0,0.72)]",
          !reducedMotion && "transition-[top,left,width,height] duration-300 ease-out"
        )}
      />

      <div
        className={cn(
          "absolute left-0 right-0 flex justify-center px-4",
          placeAbove ? "bottom-[calc(7.5rem+env(safe-area-inset-bottom))]" : "top-[max(5rem,calc(env(safe-area-inset-top)+3rem))]"
        )}
      >
        {/* Keyed on the step so each card fades in fresh; no exit animation to wait on. */}
        <motion.div
          key={step.target}
          initial={reducedMotion ? false : { opacity: 0, y: placeAbove ? 8 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="glass-strong w-full max-w-sm rounded-[1.5rem] border border-white/10 p-5 shadow-2xl"
        >
          <p className="micro-label text-accent">
            {stepIndex + 1} of {TOUR_STEPS.length}
          </p>
          <h2 className="headline-tight mt-1 text-lg font-bold">{step.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-xl px-3 text-sm text-muted transition-colors hover:text-foreground"
            >
              Skip
            </button>
            <Button size="sm" className="ml-auto" onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
