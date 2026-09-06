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
 *
 * TWO SIZES, ONE SET OF STATES. `variant="band"` is the home page's: the
 * hybrid plan had to be given real prominence there (user feedback: "i also
 * want the hybrid plan to be highlighted more greatly in the homepage") while
 * the home page as a whole had to stop needing a scroll to read. Those pull in
 * opposite directions, and the resolution is position rather than size — the
 * band sits directly under the index, above everything retrospective, and
 * spends its height on today's sessions and nothing else. The states are not
 * duplicated for it; only their layout differs.
 */

const DOMAIN_ICON = {
  endurance: Footprints,
  strength: Dumbbell,
} as const;

type Variant = "full" | "band";

function PlanLink({
  label,
  href = "/hybrid-plan",
  variant,
}: {
  label: string;
  href?: string;
  variant: Variant;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent/10",
        variant === "band" ? "mt-2.5 py-2" : "mt-4 py-3"
      )}
    >
      <span>{label}</span>
      <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

function CardFrame({
  eyebrow,
  meta,
  variant,
  className,
  children,
}: {
  eyebrow: string;
  /** Band only: the one fact worth carrying in the header, so the body needs no meta row of its own. */
  meta?: string;
  variant: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      glow="accent"
      padding={variant === "band" ? "sm" : "lg"}
      className={cn("flex h-full flex-col", variant === "band" && "p-4", className)}
    >
      {/*
        In the band the heading is itself the way into the plan, which is what
        buys back the height the footer button used to take. The band has to
        share one phone screen with the index above it and both prediction
        strips below it, and a second "open the plan" control on a card whose
        title already says Hybrid Plan was the cheapest thing on it to lose.
      */}
      {variant === "band" ? (
        <Link href="/hybrid-plan" className="group mb-2 flex items-center justify-between gap-2">
          <span className="micro-label flex items-center gap-1.5 text-accent">
            <CalendarDays className="h-3.5 w-3.5" />
            {eyebrow}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-accent">
            {meta ?? "Full plan"}
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : (
        <p className="micro-label mb-3 flex items-center gap-1.5 text-muted">
          <CalendarDays className="h-3.5 w-3.5" />
          {eyebrow}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </Card>
  );
}

function RestDay({ day, variant }: { day: DailyTrainingDayPayload; variant: Variant }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted",
            variant === "band" ? "h-9 w-9" : "h-10 w-10"
          )}
        >
          <Moon className={variant === "band" ? "h-4.5 w-4.5" : "h-5 w-5"} />
        </span>
        <div>
          <p className={cn("headline-tight font-bold", variant === "band" ? "text-xl" : "text-2xl")}>
            Rest day
          </p>
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
        <p
          className={cn(
            "leading-relaxed text-foreground/85",
            variant === "band" ? "mt-2 line-clamp-2 text-xs" : "mt-3 text-sm"
          )}
        >
          {day.restReason}
        </p>
      )}
      {variant === "full" && <PlanLink label="See the week" variant={variant} />}
    </>
  );
}

function TrainingDay({ day, variant }: { day: DailyTrainingDayPayload; variant: Variant }) {
  // Two is what fits above the fold and is what a hybrid day almost always
  // holds; a third is named rather than dropped silently.
  const shown = variant === "band" ? day.sessions.slice(0, 2) : day.sessions;
  const hidden = day.sessions.length - shown.length;

  return (
    <>
      {/* In the band this line lives in the header instead — see CardFrame's `meta`. */}
      {variant === "full" && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] text-muted">{day.weekLabel}</p>
          <p className="text-[11px] tabular-nums text-muted">{day.totalMinutes} min total</p>
        </div>
      )}

      <div className={cn(variant === "band" ? "space-y-1.5" : "mt-3 space-y-2.5")}>
        {shown.map((session, i) => {
          const Icon = DOMAIN_ICON[session.domain];
          return (
            <div
              key={`${session.title}-${session.slot ?? "unslotted"}-${i}`}
              className={cn(
                "rounded-xl border border-white/[0.06] bg-white/[0.03]",
                variant === "band" ? "p-2" : "p-3.5"
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex shrink-0 items-center justify-center rounded-lg",
                    variant === "band" ? "h-7 w-7" : "h-8 w-8",
                    session.domain === "strength"
                      ? "bg-strength/10 text-strength"
                      : "bg-endurance/10 text-endurance"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p
                      className={cn(
                        "headline-tight font-semibold",
                        variant === "band" ? "text-base" : "text-lg"
                      )}
                    >
                      {session.title}
                    </p>
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
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
                      {session.minutes} min
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-1 leading-relaxed text-foreground/85",
                      variant === "band" ? "line-clamp-1 text-xs" : "text-sm"
                    )}
                  >
                    {session.detail}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        {hidden > 0 && (
          <p className="text-[11px] text-muted">
            +{hidden} more session{hidden === 1 ? "" : "s"} today
          </p>
        )}
      </div>

      {variant === "full" && <PlanLink label="Open the full plan" variant={variant} />}
    </>
  );
}

export function TodaysSessionCard({
  payload,
  variant = "full",
  className,
}: {
  /** Built by `buildDailyTrainingPayload` from the stored plan. Null when the engine has never stored one. */
  payload: DailyTrainingPayload | null;
  variant?: Variant;
  className?: string;
}) {
  // The band names the feature, not just the day — it is the home page's only
  // mention of the hybrid plan, so "Today's session" alone left the plan
  // itself invisible there.
  const eyebrow = variant === "band" ? "Hybrid Plan · Today" : "Today's session";

  if (!payload) {
    return (
      <CardFrame eyebrow={eyebrow} variant={variant} className={className}>
        <p className={cn("headline-tight font-bold", variant === "band" ? "text-xl" : "text-2xl")}>
          No plan yet
        </p>
        <p
          className={cn(
            "leading-relaxed text-muted",
            variant === "band" ? "mt-1 text-xs" : "mt-2 text-sm"
          )}
        >
          Build a block that arrives at your event date, and today&apos;s session shows up here.
        </p>
        <PlanLink label="Build your plan" variant={variant} />
      </CardFrame>
    );
  }

  // A plan exists but today falls outside its dates. Deliberately NOT collapsed
  // into "no plan": that would send an athlete who has already done the intake
  // back to the intake form.
  if (payload.status !== "ready" || !payload.days?.length) {
    return (
      <CardFrame eyebrow={eyebrow} variant={variant} className={className}>
        <p className={cn("headline-tight font-bold", variant === "band" ? "text-xl" : "text-2xl")}>
          {payload.headline ?? "No plan yet"}
        </p>
        {payload.message && (
          <p
            className={cn(
              "leading-relaxed text-muted",
              variant === "band" ? "mt-1 line-clamp-2 text-xs" : "mt-2 text-sm"
            )}
          >
            {payload.message}
          </p>
        )}
        <PlanLink
          label={payload.status === "betweenBlocks" ? "Open your plan" : "Build your plan"}
          variant={variant}
        />
      </CardFrame>
    );
  }

  // `buildDailyTrainingPayload` slices from today, so days[0] is today.
  const today = payload.days[0]!;

  return (
    <CardFrame
      eyebrow={eyebrow}
      meta={today.isRest ? today.weekLabel : `${today.totalMinutes} min`}
      variant={variant}
      className={className}
    >
      {today.isRest ? (
        <RestDay day={today} variant={variant} />
      ) : (
        <TrainingDay day={today} variant={variant} />
      )}
    </CardFrame>
  );
}
