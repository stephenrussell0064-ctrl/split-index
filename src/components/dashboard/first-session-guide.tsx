import Link from "next/link";
import { Activity, ChevronRight, Dumbbell, Lock, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LOG_WORKOUT, PRIMARY_NAV } from "@/lib/navigation/app-nav";
import { cn } from "@/lib/utils/cn";

/**
 * The whole home page, for an account that has logged nothing.
 *
 * WHY THIS EXISTS
 * ---------------
 * User feedback, and it is the first thing anyone said about the app: new
 * users cannot work out what it is for or what to do first. What they landed
 * on was a greeting, a dismissable "Getting around" card, a marketing hero
 * headed "Your index is unwritten" with four bullets off a spec sheet, and
 * then NINE EMPTY CARDS — a plan band with no plan, an AI coach with nothing
 * to say, a trend chart with no trend, upcoming races, a "Your data" header
 * over a week-over-week card with no weeks and a recent-workouts list with no
 * workouts. Every one of those is correct and every one of them is empty, and
 * a screen of empty containers reads as a broken app rather than a new one.
 *
 * So the first run is not the dashboard with the data missing. It is this: one
 * thing to do, two ways to do it, and a map of where everything is. The
 * dashboard returns in full the moment there is a single session behind it —
 * see `isFirstRun` in dashboard/page.tsx.
 *
 * It replaces BOTH of the cards it sits in place of. GettingAroundCard said
 * where things were but not what to do, EmptyDashboardHero sold features
 * rather than naming an action, and neither could be the only thing on the
 * screen. This is one card that does both jobs, so it can be.
 *
 * No localStorage and no client state, deliberately. "Have they logged
 * anything" is a fact the server already knows from the same query the
 * dashboard runs, so this needs no dismissal flag that could strand someone
 * on an empty page — it stops rendering because they logged a session.
 */

/**
 * The two ways in, carrying their own zone colours.
 *
 * Same split as the + button's launcher: The Lab's black-and-green, The
 * Engine's white-and-blue. Which half is which is legible before a word is
 * read, and it matches what the athlete will see when they land there.
 */
const CHOICES = [
  {
    href: "/gym/log",
    label: "Gym session",
    line: "Exercises, sets and reps.",
    icon: Dumbbell,
    className: "border-gym-border bg-gym-bg-elevated text-gym-text hover:border-gym-accent/45",
    iconClassName: "bg-gym-accent/12 text-gym-accent",
    lineClassName: "text-gym-muted",
  },
  {
    href: "/cardio/log",
    label: "Run, ride, row or swim",
    line: "Distance and time.",
    icon: Activity,
    className: "border-cardio-border bg-cardio-bg text-cardio-text hover:border-cardio-accent/45",
    /*
      --cardio-accent-strong, not --cardio-accent, for the icon. The brand blue
      measures 2.50:1 on the Engine's near-white ground, which fails even the
      3:1 floor for a graphic that carries meaning; accent-strong is the same
      hue at 3.5:1 and is what globals.css specifies for icons on this ground.
      The fill (bg-cardio-accent/12) is decorative and keeps the brand value.
    */
    iconClassName: "bg-cardio-accent/12 text-cardio-accent-strong",
    lineClassName: "text-cardio-muted",
  },
] as const;

/**
 * What a first session actually unlocks, in the order it unlocks it.
 *
 * Two of the three are locked, and shown locked rather than hidden. The point
 * is not the checklist — it is that the empty cards this screen replaces were
 * not broken, they were waiting, and saying so is what makes one tap feel
 * worth it.
 */
const STEPS = [
  { text: "Log a session", done: false, current: true },
  { text: "See your Split Index, strength and endurance scores on Home", current: false },
  { text: "Get a week planned for you on the Plan tab", current: false },
] as const;

/** Train, Plan and Progress — Home is where they already are. */
const ELSEWHERE = [
  ...PRIMARY_NAV.filter((item) => item.href !== "/dashboard"),
  {
    href: LOG_WORKOUT.href,
    label: "The + button",
    brandName: undefined,
    description: LOG_WORKOUT.description,
    icon: LOG_WORKOUT.icon,
  },
];

export function FirstSessionGuide() {
  return (
    <div className="space-y-3">
      <Card glow="accent" padding="md">
        <p className="micro-label text-accent">Your first session</p>
        <h2 className="headline-tight mt-1 text-xl font-bold sm:text-2xl">
          Log one session to get your Split Index
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your score out of 100 is worked out from what you actually do, so it starts the moment you
          log something.
        </p>

        {/*
          Two halves, side by side on a phone as well as a desktop. Stacking
          them would put The Engine below the fold on the one screen whose
          entire job is to offer a choice between the two.
        */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {CHOICES.map((choice) => {
            const Icon = choice.icon;
            return (
              <Link
                key={choice.href}
                href={choice.href}
                className={cn(
                  "group flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center transition-colors",
                  choice.className
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    choice.iconClassName
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {/* text-balance, so "Run, ride, row or swim" breaks evenly
                    rather than leaving one word on its own line. */}
                <span className="text-pretty text-sm font-semibold leading-tight">
                  {choice.label}
                </span>
                <span className={cn("text-[11px] leading-tight", choice.lineClassName)}>
                  {choice.line}
                </span>
              </Link>
            );
          })}
        </div>

        <Link
          href="/cardio/gps-run?sport=running"
          className="group mt-2.5 flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Or record a run live with GPS
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Card>

      <section
        aria-labelledby="first-session-next"
        className="glass rounded-2xl border border-white/[0.06] p-4"
      >
        <h2 id="first-session-next" className="micro-label text-muted">
          What happens next
        </h2>
        <ol className="mt-3 space-y-2.5">
          {STEPS.map((step, i) => (
            <li key={step.text} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                  step.current
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "bg-white/[0.04] text-muted"
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "flex min-w-0 items-start gap-1.5 text-xs leading-snug",
                  step.current ? "font-semibold text-foreground" : "text-muted"
                )}
              >
                {!step.current && (
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-label="Locked until you log a session" />
                )}
                {step.text}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/*
        WHERE EVERYTHING IS. This is what the dismissable "Getting around" card
        used to say, built from the same shared nav list so a tab cannot be
        renamed without this following it — and as four tappable tiles rather
        than six rows of prose nobody read before dismissing them.
      */}
      <section aria-labelledby="first-session-map" className="space-y-2">
        <h2 id="first-session-map" className="micro-label text-muted">
          Where everything is
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {ELSEWHERE.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="glass flex min-h-24 flex-col gap-1 rounded-2xl border border-white/[0.06] p-3 transition-colors hover:border-white/[0.12]"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 text-xs font-semibold leading-tight">
                  {item.label}
                  {item.brandName && (
                    <span className="font-normal text-muted"> · {item.brandName}</span>
                  )}
                </span>
                <span className="text-[11px] leading-tight text-muted">{item.description}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
