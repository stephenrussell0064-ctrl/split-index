import Link from "next/link";
import { CalendarDays, ChevronRight, Dumbbell, Footprints, Moon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DailyTrainingPayload } from "@/lib/native/daily-training";

type Zone = "gym" | "cardio";

const TONE = {
  gym: {
    frame: "border-gym-accent/30 bg-gym-accent/[0.06] hover:border-gym-accent/50",
    accent: "text-gym-accent",
    text: "text-gym-text",
    muted: "text-gym-muted",
    tile: "bg-gym-accent/12 text-gym-accent",
    domain: "strength" as const,
    noun: "lifting",
  },
  cardio: {
    frame: "border-cardio-accent/30 bg-cardio-accent/[0.06] hover:border-cardio-accent/50",
    accent: "text-cardio-accent",
    text: "text-cardio-text",
    muted: "text-cardio-muted",
    tile: "bg-cardio-accent/12 text-cardio-accent",
    domain: "endurance" as const,
    noun: "endurance",
  },
} as const;

const DOMAIN_ICON = { endurance: Footprints, strength: Dumbbell } as const;

/**
 * The hybrid plan, on the tab where the athlete is about to train.
 *
 * Until now the plan lived on the home page and behind "More". The Lab and
 * The Engine — the two screens an athlete opens to actually do a session —
 * said nothing about what the plan had prescribed for today, so the plan
 * was something you remembered to check rather than something the app put
 * in front of you (owner: "make the hybrid plan a larger section in the app
 * and more easy to be seen").
 *
 * One card, same `DailyTrainingPayload` the dashboard band and the phone
 * widget are built from, filtered to this zone's half of the day: The Lab
 * shows today's strength work, The Engine today's endurance work. When
 * today's only session is the other half, it says so rather than reading as
 * a rest day. The whole card is the link into the full plan.
 */
export function ZonePlanCard({
  zone,
  payload,
  className,
}: {
  zone: Zone;
  /** Null when the engine has never stored a plan. */
  payload: DailyTrainingPayload | null;
  className?: string;
}) {
  const t = TONE[zone];

  const header = (
    <span className="flex items-center justify-between gap-2">
      <span className={cn("micro-label flex items-center gap-1.5", t.accent)}>
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        Hybrid Plan · Today
      </span>
      <span className={cn("flex shrink-0 items-center gap-0.5 text-[11px] font-semibold", t.accent)}>
        Open plan
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </span>
  );

  let body: React.ReactNode;

  if (!payload) {
    body = (
      <>
        <p className={cn("headline-tight mt-2 text-lg font-bold", t.text)}>No plan yet</p>
        <p className={cn("mt-0.5 text-xs leading-relaxed", t.muted)}>
          Build a block that balances {t.noun} with the rest of your training, and today&apos;s
          session shows up here.
        </p>
      </>
    );
  } else if (payload.status !== "ready" || !payload.days?.length) {
    body = (
      <>
        <p className={cn("headline-tight mt-2 text-lg font-bold", t.text)}>
          {payload.headline ?? "No plan yet"}
        </p>
        {payload.message && (
          <p className={cn("mt-0.5 line-clamp-2 text-xs leading-relaxed", t.muted)}>{payload.message}</p>
        )}
      </>
    );
  } else {
    const today = payload.days[0]!;
    const mine = today.sessions.filter((s) => s.domain === t.domain);
    const theirs = today.sessions.filter((s) => s.domain !== t.domain);

    if (today.isRest) {
      body = (
        <div className="mt-2 flex items-center gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.tile)}>
            <Moon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className={cn("headline-tight text-lg font-bold", t.text)}>Rest day</p>
            <p className={cn("truncate text-xs", t.muted)}>{today.restReason ?? today.weekLabel}</p>
          </div>
        </div>
      );
    } else if (mine.length === 0) {
      body = (
        <div className="mt-2 flex items-center gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.tile)}>
            <Moon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className={cn("headline-tight text-lg font-bold", t.text)}>
              No {t.noun} today
            </p>
            <p className={cn("truncate text-xs", t.muted)}>
              {theirs.length > 0
                ? `Today's plan is ${theirs.map((s) => s.title).join(" + ")} · ${today.weekLabel}`
                : today.weekLabel}
            </p>
          </div>
        </div>
      );
    } else {
      body = (
        <ul className="mt-2 space-y-1.5">
          {mine.map((session, i) => {
            const Icon = DOMAIN_ICON[session.domain];
            return (
              <li key={`${session.title}-${i}`} className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.tile)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("headline-tight truncate text-base font-semibold", t.text)}>
                      {session.title}
                    </p>
                    <p className={cn("shrink-0 text-[11px] tabular-nums", t.muted)}>
                      {session.minutes} min{session.slot ? ` · ${session.slot}` : ""}
                    </p>
                  </div>
                  <p className={cn("line-clamp-1 text-xs leading-relaxed", t.muted)}>{session.detail}</p>
                </div>
              </li>
            );
          })}
          {theirs.length > 0 && (
            <li className={cn("pl-12 text-[11px]", t.muted)}>
              Plus {theirs.map((s) => s.title).join(" + ")} on the other side of the day.
            </li>
          )}
        </ul>
      );
    }
  }

  return (
    <Link
      href="/hybrid-plan"
      className={cn("group block rounded-2xl border p-4 transition-colors", t.frame, className)}
    >
      {header}
      {body}
    </Link>
  );
}
