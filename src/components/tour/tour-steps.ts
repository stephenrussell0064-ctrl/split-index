import { LOG_WORKOUT, PRIMARY_NAV } from "@/lib/navigation/app-nav";

/**
 * The tour: five controls along the bottom, one sentence each.
 *
 * Built from the shared nav list — the same source the tab bar, the sidebar,
 * /help and the first-session guide render from — so a renamed tab cannot
 * leave the tour calling it by its old name. The `target` is the value of a
 * `data-tour` attribute the shell puts on the matching control; the overlay
 * finds whichever copy of it is visible (phone tab bar or desktop sidebar).
 *
 * Deliberately short. The brief was "optional and as quick as possible", and
 * an athlete who has just tapped through onboarding has a finite appetite for
 * being told things. Thirty seconds, five taps, and Skip on every step.
 */

export type TourTarget = "home" | "train" | "log" | "plan" | "progress";

export interface TourStep {
  target: TourTarget;
  title: string;
  body: string;
}

const TARGET_BY_HREF: Record<string, TourTarget> = {
  "/dashboard": "home",
  "/train": "train",
  "/hybrid-plan": "plan",
  "/progress": "progress",
};

/** What to say about each tab — more direct than the nav description, which is written for a menu. */
const TOUR_COPY: Record<TourTarget, string> = {
  home: "Your Split Index, today's session and what you could run or lift right now. You're here.",
  train: "Strength and endurance side by side. The toggle at the top switches halves.",
  log: "The fastest way in. Gym session, a run you've done, or live GPS — one tap from anywhere.",
  plan: "A week of training built around both halves, once you've logged a session or two.",
  progress: "Everything retrospective: analytics, recovery, the logbook, and the people you train with.",
};

export function buildTourSteps(): TourStep[] {
  const [home, train, plan, progress] = PRIMARY_NAV;
  const tabs = [home, train, plan, progress].map((item) => {
    const target = TARGET_BY_HREF[item.href];
    if (!target) throw new Error(`No tour target for ${item.href}`);
    return { target, title: item.label, body: TOUR_COPY[target] };
  });
  // The + button sits between Train and Plan on the bar; the tour walks the
  // bar left to right so the spotlight never jumps back on itself.
  return [
    tabs[0]!,
    tabs[1]!,
    { target: "log", title: LOG_WORKOUT.label, body: TOUR_COPY.log },
    tabs[2]!,
    tabs[3]!,
  ];
}

export const TOUR_STEPS: readonly TourStep[] = buildTourSteps();
