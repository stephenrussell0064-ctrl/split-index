import Link from "next/link";
import { CalendarDays, ChevronRight, Dumbbell, Footprints, Moon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { DailyTrainingDayPayload, DailyTrainingPayload } from "@/lib/native/daily-training";

/**
 * Today's prescribed session, on the home page.
 *
 * The hybrid plan shipped as its own route and was reachable only from the
 * nav — an athlete opening the app to the dashboard had no way to see the one
 * thing the plan exists to tell them, which is what to do today.
 *
 * WHY THIS TAKES A WIDGET PAYLOAD RATHER THAN THE PLAN ITSELF: the three
 * non-session states here are the same three the iOS home-screen widget
 * already has to distinguish, and `buildDailyTrainingPayload` is the tested
 * module that distinguishes them. Driving this card from the same function
 * means the phone's home screen, the plan screen and the dashboard cannot
 * word today differently or disagree about which state the athlete is in.
 * Nothing below derives, rounds or fills in anything — every string rendered
 * here was produced by that module from the plan the engine stored.
 *
 * The four states are genuinely different situations:
 *
 *   ready + sessions — train. The sessions, at a size that says so.
 *   ready + isRest   — A REST DAY IS A PRESCRIPTION. It renders as a rest day,
 *                      with the plan's own reason, never as an absence and
 *                      never as "no plan".
 *   betweenBlocks    — a plan exists, today is outside its dates. Sending this
 *                      athlete to an intake form they already filled in would
 *                      be the wrong answer.
 *   no stored plan   — `payload` is null. The only state where "set one up" is
 *                      the right next step.
 */

const DOMAIN_ICON = {
  endurance: Footprints,
  strength: Dumbbell,
} as const;

function PlanLink({ label, href = "/hybrid-plan" }: { label: string; href?: string }) {
  return (
    <Link
      href={href}
      className="group mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent/10"
    >
      <span>{label}</span>
      <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

function CardFrame({
  eyebrow,
  className,
  children,
}: {
  eyebrow: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card glow="accent" padding="lg" className={cn("flex h-full flex-col", className)}>
      <p className="micro-label mb-3 flex items-center gap-1.5 text-muted">
        <CalendarDays className="h-3.5 w-3.5" />
        {eyebrow}
      </p>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </Card>
  );
}

function RestDay({ day }: { day: DailyTrainingDayPayload }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted">
          <Moon className="h-5 w-5" />
        </span>
        <div>
          <p className="headline-tight text-2xl font-bold">Rest day</p>
          <p className="text-[11px] text-muted">{day.weekLabel}</p>
        </div>
      </div>
      {/*
        The plan's own sentence for why this day is clear. `restReason` is
        derived from the week around it and nothing else — a rest day with an
        invented reason is worse than a blank one, so if the plan did not say
        why, nothing is said here either.
      */}
      {day.restReason && (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{day.restReason}</p>
      )}
      <PlanLink label="See the week" />
    </>
  );
}

function TrainingDay({ day }: { day: DailyTrainingDayPayload }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] text-muted">{day.weekLabel}</p>
        <p className="text-[11px] tabular-nums text-muted">{day.totalMinutes} min total</p>
      </div>

      <div className="mt-3 space-y-2.5">
        {day.sessions.map((session, i) => {
          const Icon = DOMAIN_ICON[session.domain];
          return (
            <div
              key={`${session.title}-${session.slot ?? "unslotted"}-${i}`}
              className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3.5"
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    session.domain === "strength"
                      ? "bg-strength/10 text-strength"
                      : "bg-endurance/10 text-endurance"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="headline-tight text-lg font-semibold">{session.title}</p>
                    {/* Only when the plan actually slotted it. An absent slot is not "AM". */}
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
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-foreground/85">{session.detail}</p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted">{session.minutes} min</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PlanLink label="Open the full plan" />
    </>
  );
}

export function TodaysSessionCard({
  payload,
  className,
}: {
  /** Built by `buildDailyTrainingPayload` from the stored plan. Null when the engine has never stored one. */
  payload: DailyTrainingPayload | null;
  className?: string;
}) {
  if (!payload) {
    return (
      <CardFrame eyebrow="Today's session" className={className}>
        <p className="headline-tight text-2xl font-bold">No plan yet</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Build a block that arrives at your event date, and today&apos;s session shows up here.
        </p>
        <PlanLink label="Build your plan" />
      </CardFrame>
    );
  }

  // A plan exists but today falls outside its dates. Deliberately NOT collapsed
  // into "no plan": that would send an athlete who has already done the intake
  // back to the intake form.
  if (payload.status !== "ready" || !payload.days?.length) {
    return (
      <CardFrame eyebrow="Today's session" className={className}>
        <p className="headline-tight text-2xl font-bold">{payload.headline ?? "No plan yet"}</p>
        {payload.message && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{payload.message}</p>
        )}
        <PlanLink label={payload.status === "betweenBlocks" ? "Open your plan" : "Build your plan"} />
      </CardFrame>
    );
  }

  // `buildDailyTrainingPayload` slices from today, so days[0] is today.
  const today = payload.days[0]!;

  return (
    <CardFrame eyebrow="Today's session" className={className}>
      {today.isRest ? <RestDay day={today} /> : <TrainingDay day={today} />}
    </CardFrame>
  );
}
