"use client";

import { cn } from "@/lib/utils/cn";
import { formatIndex } from "@/lib/utils/format";

/**
 * The second of a session's two scores, everywhere it appears.
 *
 * The first is the population score — this session against the sport's
 * standards for someone of this athlete's sex and age. It is the one the
 * indexes and the leaderboards are built on, and it moves slowly, because an
 * athlete's standing against everyone else genuinely does not swing much from
 * one session to the next.
 *
 * This one is against the athlete themselves: the same session read against
 * the recency-weighted median of their own recent sessions in that sport at a
 * comparable heart rate. 500 — rendered 50.0 — is their normal. It is the
 * number that actually moves when a run is a good or a bad one, which is what
 * makes it worth showing next to the other.
 *
 * Null is a real state, not an error: fewer than three comparable sessions in
 * the trailing 90 days means there is nothing honest to compare against, so
 * it says "calibrating" rather than inventing a middle.
 */

/** 500 is the centre of the personal scale — see PERSONAL_SCORE_CENTER. */
const CENTER = 500;

export type PersonalScoreTone = "cardio" | "gym";

/** Plain-language reading of where the session sits against the athlete's norm. */
export function describePersonalScore(score: number): string {
  const delta = score - CENTER;
  if (delta >= 180) return "One of your best";
  if (delta >= 70) return "Better than your normal";
  if (delta >= 25) return "A bit better than normal";
  if (delta > -25) return "About your normal";
  if (delta > -70) return "A bit below normal";
  if (delta > -180) return "Below your normal";
  return "Well below your normal";
}

function toneClasses(tone: PersonalScoreTone, delta: number) {
  if (delta >= 25) return "text-success";
  if (delta <= -25) return "text-warning";
  return tone === "gym" ? "text-gym-muted" : "text-cardio-muted";
}

/**
 * The compact form: one line, for a list row or under a headline number.
 */
export function PersonalScoreLine({
  score,
  tone = "cardio",
  className,
}: {
  score: number | null;
  tone?: PersonalScoreTone;
  className?: string;
}) {
  if (score === null) {
    return (
      <p className={cn("text-xs text-muted", className)}>
        Personal score calibrating — three comparable sessions needed
      </p>
    );
  }
  const delta = score - CENTER;
  return (
    <p className={cn("text-xs tabular-nums", className)}>
      <span className="text-muted">vs you </span>
      <span className={cn("font-semibold", toneClasses(tone, delta))}>{formatIndex(score)}</span>
      <span className="text-muted"> · {describePersonalScore(score)}</span>
    </p>
  );
}

/**
 * The full form: the two scores side by side, each labelled with what it
 * measures. Used where a session is the subject of the screen rather than a
 * row in a list.
 */
export function TwoScorePanel({
  populationScore,
  personalScore,
  tone = "cardio",
  className,
}: {
  populationScore: number;
  personalScore: number | null;
  tone?: PersonalScoreTone;
  className?: string;
}) {
  const accent = tone === "gym" ? "text-gym-accent" : "text-cardio-accent";
  const delta = personalScore === null ? 0 : personalScore - CENTER;

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div>
        <p className="micro-label text-muted">vs everyone</p>
        <p className={cn("index-display text-4xl font-bold tabular-nums", accent)}>
          {formatIndex(populationScore)}
        </p>
        <p className="mt-1 text-xs text-muted">
          This session against the standards for your sex and age.
        </p>
      </div>
      <div>
        <p className="micro-label text-muted">vs you</p>
        {personalScore === null ? (
          <>
            <p className="index-display text-4xl font-bold tabular-nums text-muted">—</p>
            <p className="mt-1 text-xs text-muted">
              Calibrating. Three comparable sessions in this sport and this starts reading.
            </p>
          </>
        ) : (
          <>
            <p
              className={cn(
                "index-display text-4xl font-bold tabular-nums",
                toneClasses(tone, delta)
              )}
            >
              {formatIndex(personalScore)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {describePersonalScore(personalScore)}. Your normal is {formatIndex(CENTER)}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
