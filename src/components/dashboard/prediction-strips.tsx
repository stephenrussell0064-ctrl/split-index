import Link from "next/link";
import { ChevronRight, Dumbbell, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatRiegelPrediction } from "@/lib/scoring/presentation";

/**
 * The two things an athlete opens a hybrid app to look at, at the density
 * they deserve.
 *
 * Both of these were single big squares on the old home page — one 5K time,
 * one SBD total — which spent a quarter of the first screen each to say one
 * number (user feedback: "rather than showing 5km prediction as a large
 * square, show 1500m, 5km, 10km, half and full predictions which take up less
 * space. Do the same for the SBD field — give the actual lift predictions vs
 * the best you've recorded but condense the information").
 *
 * So: five race distances in the footprint the 5K alone used to take, and all
 * three lifts with what the engine predicts against what the athlete has
 * actually put on the bar. Each strip carries a heading saying what its
 * numbers are, since the squares they replace did not.
 */

function StripFrame({
  icon: Icon,
  title,
  subtitle,
  href,
  children,
  className,
}: {
  icon: typeof Timer;
  title: string;
  subtitle: string;
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card padding="sm" className={cn("flex flex-col p-4", className)}>
      <Link href={href} className="group flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="micro-label flex items-center gap-1.5 text-muted">
            <Icon className="h-3 w-3" />
            {title}
          </p>
          <p className="mt-0.5 truncate text-[10px] leading-tight text-muted/70">{subtitle}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
      </Link>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function EmptyStrip({ message, cta, href }: { message: string; cta: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-white/10 px-3 py-3 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
    >
      <span className="text-xs leading-tight text-muted">{message}</span>
      <span className="shrink-0 text-xs font-semibold text-accent">{cta}</span>
    </Link>
  );
}

export interface RacePrediction {
  /** Short enough for a five-across strip on a phone: "1500m", "5K", "10K", "Half", "Full". */
  label: string;
  seconds: number;
}

export function RacePredictionStrip({
  predictions,
  note,
}: {
  predictions: RacePrediction[];
  /** Replaces the default subtitle when a training gap has moved the numbers — see `explainStoredPrediction`. */
  note?: string | null;
}) {
  return (
    <StripFrame
      icon={Timer}
      title="Predicted race times"
      subtitle={note ?? "Projected from the runs you have logged"}
      href="/analytics"
    >
      {predictions.length === 0 ? (
        <EmptyStrip
          message="A few more runs and your times across every distance appear here."
          cta="Log a run"
          href="/cardio/log"
        />
      ) : (
        <div className="grid grid-cols-5 gap-1">
          {predictions.map((p) => (
            <div
              key={p.label}
              className="rounded-lg bg-white/[0.03] px-1 py-1.5 text-center"
            >
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                {p.label}
              </p>
              <p className="index-display mt-0.5 text-[13px] font-bold tabular-nums text-endurance sm:text-sm">
                {formatRiegelPrediction(p.seconds)}
              </p>
            </div>
          ))}
        </div>
      )}
    </StripFrame>
  );
}

export interface LiftPrediction {
  label: string;
  /** Engine-estimated 1RM, kg. Null when this lift has never been logged. */
  predictedKg: number | null;
  /** The heaviest set actually performed, as logged. Null when unknown. */
  bestKg: number | null;
  bestReps: number | null;
}

export function LiftPredictionStrip({
  lifts,
  totalKg,
}: {
  lifts: LiftPrediction[];
  /** Predicted squat + bench + deadlift, kg. Null until at least one is logged. */
  totalKg: number | null;
}) {
  const anyLogged = lifts.some((l) => l.predictedKg !== null);

  return (
    <StripFrame
      icon={Dumbbell}
      title="Predicted 1RM"
      subtitle={
        totalKg !== null
          ? `${Math.round(totalKg)} kg predicted SBD total · vs your heaviest set`
          : "Squat, bench and deadlift vs your heaviest set"
      }
      href="/gym"
    >
      {!anyLogged ? (
        <EmptyStrip
          message="Log a squat, bench or deadlift to see your predicted maxes."
          cta="Log a lift"
          href="/gym/log"
        />
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {lifts.map((lift) => (
            <div key={lift.label} className="rounded-lg bg-white/[0.03] px-1 py-1.5 text-center">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                {lift.label}
              </p>
              <p
                className={cn(
                  "index-display mt-0.5 text-[15px] font-bold tabular-nums sm:text-base",
                  lift.predictedKg !== null ? "text-strength" : "text-muted"
                )}
              >
                {lift.predictedKg !== null ? `${Math.round(lift.predictedKg)} kg` : "—"}
              </p>
              {/*
                What they have actually done, under what the engine thinks they
                could do. Absent rather than zeroed when the top set is unknown —
                a lift can be scored from a session whose raw sets predate this
                column, and "0 × 0" would read as a failed lift.
              */}
              <p className="mt-0.5 truncate text-[9px] leading-tight text-muted">
                {lift.bestKg !== null && lift.bestReps !== null
                  ? `best ${Math.round(lift.bestKg)}×${lift.bestReps}`
                  : lift.predictedKg !== null
                    ? "no set recorded"
                    : "not logged"}
              </p>
            </div>
          ))}
        </div>
      )}
    </StripFrame>
  );
}
