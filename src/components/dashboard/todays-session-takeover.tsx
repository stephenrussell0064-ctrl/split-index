"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronRight, Dumbbell, Footprints, Moon, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDialog } from "@/components/ui/use-dialog";
import { cn } from "@/lib/utils/cn";
import type {
  DailyTrainingDayPayload,
  DailyTrainingPayload,
} from "@/lib/native/daily-training";
import {
  seenDateOnServer,
  seenDateSnapshot,
  shouldOpenTakeover,
  subscribeToNothing,
  takeoverDay,
  writeSeenDate,
} from "./todays-session-takeover-state";

/**
 * The whole screen, on opening the app, saying what to do today.
 *
 * Asked for directly: "i want a whole screen displaying what you should be
 * doing today as part of the plan when you load the app up, and then you can
 * click off of it".
 *
 * WHY A TAKEOVER RATHER THAN MOVING THE CARD. This was first built by promoting
 * the Hybrid Plan band above the index on the dashboard, and that was the wrong
 * reading of the request. It was also a regression: the dashboard's block order
 * is measured, not chosen — the note in dashboard/page.tsx works out that a
 * 390x844 phone has 620px of real window, and that moving the band up pushes
 * the lift strip under the tab bar. A takeover gets the plan the whole screen
 * without spending any of the dashboard's budget, so the measured order stands
 * untouched underneath it.
 *
 * WHY IT IS NOT A ROUTE. A `/today` page with a redirect into it would own an
 * entry in the history stack, so the phone's back gesture would land the
 * athlete back on it, and a deep link into any other screen would have to know
 * to suppress it. An overlay on the page they already land on has neither
 * problem: dismissing it is not navigation, and nothing else in the app needs
 * to know it exists.
 *
 * WHAT DISMISSES IT — all three, because "click off of it" is a mouse gesture
 * and this ships to a phone and to a keyboard:
 *
 *   the backdrop   a real <button> behind the card, as merge-activities-modal
 *                  does it, so it is reachable and announced rather than being
 *                  a div with a click handler,
 *   the X          discoverable, and the only one of the three that looks like
 *                  a control,
 *   Escape         via useDialog, which also traps and restores focus.
 *
 * Opening the full plan dismisses it too — following a link out of a screen is
 * an answer to it, and coming back to find it still there would be absurd.
 *
 * IT RENDERS NOTHING ON THE SERVER. `open` starts false and is decided in an
 * effect, because whether it has been seen lives in localStorage and the page
 * is server-rendered. The other order — assume open, hide once localStorage
 * says otherwise — would flash a full-screen takeover at everyone who had
 * already dismissed it, which is much worse than the dashboard being briefly
 * visible underneath for someone about to see it anyway.
 */

const DOMAIN_ICON = {
  endurance: Footprints,
  strength: Dumbbell,
} as const;

export function TodaysSessionTakeover({ payload }: { payload: DailyTrainingPayload | null }) {
  const day = takeoverDay(payload);

  /*
    Whether this has already been seen today lives in localStorage, which does
    not exist on the server — so the two sides have to be free to disagree
    without that counting as a hydration mismatch. `useSyncExternalStore` is the
    API for exactly that, and the alternative (setState in an effect) is what
    the React 19 lint rule forbids. Same shape as `useIsNativeShell`.
  */
  const seenDate = useSyncExternalStore(subscribeToNothing, seenDateSnapshot, seenDateOnServer);
  // Set from the dismiss handler, never from an effect. The store above is not
  // subscribed to, so this is what re-renders the screen away.
  const [dismissed, setDismissed] = useState(false);

  if (!day || dismissed || !shouldOpenTakeover(day, seenDate)) return null;

  const dismiss = () => {
    writeSeenDate(typeof window === "undefined" ? null : window.localStorage, day.date);
    setDismissed(true);
  };

  // A child, so `useDialog` mounts with the dialog actually in the DOM — its
  // focus trap reads `ref.current` once, on mount, and would find nothing if it
  // ran while this was still closed.
  return <TakeoverDialog day={day} onDismiss={dismiss} />;
}

/**
 * Exported for the test, which cannot open the real thing: the repo has no
 * jsdom, so `TodaysSessionTakeover`'s effect never runs and it renders nothing.
 * Rendering this directly is the only way to assert on the screen itself.
 * Nothing else should import it — the open/closed decision belongs upstairs.
 */
export function TakeoverDialog({
  day,
  onDismiss,
}: {
  day: DailyTrainingDayPayload;
  onDismiss: () => void;
}) {
  const { dialogRef, dialogProps } = useDialog(onDismiss, { label: "Today's training" });

  /*
    The page behind must not scroll while this is up — on a phone a swipe that
    starts on the backdrop otherwise drags the dashboard around underneath a
    screen that is supposed to be the only thing there.
  */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/*
        The backdrop, and the "click off of it" gesture. A button rather than a
        div, so it is focusable and announced — same pattern as
        merge-activities-modal.
      */}
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-background/95 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div
        ref={dialogRef}
        {...dialogProps}
        className={cn(
          "relative flex max-h-[100dvh] w-full max-w-md flex-col overflow-y-auto",
          // The insets are written with max() rather than a bare env(): iPad
          // compatibility mode reports every safe-area inset as 0, and a bare
          // env() there collapses to nothing behind the notch and the home bar.
          "px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="micro-label flex items-center gap-1.5 text-accent">
              <CalendarDays className="h-3.5 w-3.5" />
              Hybrid Plan · Today
            </p>
            <h2 className="headline-tight mt-2 text-2xl font-bold">
              {format(parseISO(day.date), "EEEE d MMMM")}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {day.weekLabel}
              {!day.isRest && day.totalMinutes > 0 && (
                <span className="tabular-nums"> · {day.totalMinutes} min total</span>
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 flex-1">
          {day.isRest ? <RestDay day={day} /> : <Sessions day={day} />}
        </div>

        <div className="mt-8 space-y-3">
          <Button className="w-full" onClick={onDismiss}>
            Got it
          </Button>
          {/*
            Dismisses on the way out. `onClick` fires before the navigation, so
            the day is recorded and coming back to the dashboard does not put
            this straight back up.
          */}
          <Link
            href="/hybrid-plan"
            onClick={onDismiss}
            className={cn(buttonVariants({ variant: "ghost" }), "w-full")}
          >
            Open the full plan
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * A rest day, rendered as the prescription it is. `restReason` is the plan's
 * own sentence and is shown only when the plan gave one — a rest day with an
 * invented reason is worse than a bare one.
 */
function RestDay({ day }: { day: DailyTrainingDayPayload }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted">
          <Moon className="h-6 w-6" />
        </span>
        <p className="headline-tight text-2xl font-bold">Rest day</p>
      </div>
      {day.restReason && (
        <p className="mt-4 text-sm leading-relaxed text-foreground/85">{day.restReason}</p>
      )}
    </div>
  );
}

/**
 * Every session, in full. The band on the dashboard shows two and clamps each
 * detail to a line because it is sharing a screen; this one is not, so nothing
 * is truncated and nothing is hidden behind a "+1 more".
 */
function Sessions({ day }: { day: DailyTrainingDayPayload }) {
  return (
    <div className="space-y-3">
      {day.sessions.map((session, i) => {
        const Icon = DOMAIN_ICON[session.domain];
        return (
          <div
            key={`${session.title}-${session.slot ?? "unslotted"}-${i}`}
            className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4"
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  session.domain === "strength"
                    ? "bg-strength/10 text-strength"
                    : "bg-endurance/10 text-endurance"
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="headline-tight text-lg font-semibold">{session.title}</p>
                  {session.slot && (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                      {session.slot}
                    </span>
                  )}
                  {session.isQuality && (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                      Quality
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
                    {session.minutes} min
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
                  {session.detail}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
