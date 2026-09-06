"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Bookmark, History, RotateCcw } from "lucide-react";
import { SESSION_TYPES } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { SportType } from "@/types";
import { formatClock, SPORT_FIELDS, totalDurationSeconds, type WorkoutFormState } from "./form-state";

interface TemplateRow {
  id: string;
  name: string;
  sport: SportType;
  template_data: WorkoutFormState;
}

interface PastWorkoutRow {
  activityId: string;
  startedAt: string;
  title: string | null;
  exerciseNames: string[];
  formState: WorkoutFormState;
}

const sessionTypeLabel = (value: string) =>
  SESSION_TYPES.find((t) => t.value === value)?.label ?? null;

/** Cards shown in the "Start from" grid — two rows of two. See the slot split below. */
const QUICK_START_SLOTS = 4;

/**
 * What a past session WAS, in the words the athlete would use — "10 km ·
 * 48:20" or "Squat · Bench · Barbell Row". A row of identical dates tells you
 * nothing about which one to repeat.
 */
function describeWorkout(
  sport: SportType,
  workout: PastWorkoutRow
): { title: string; meta: string } {
  const state = workout.formState;
  const when = format(new Date(workout.startedAt), "EEE d MMM");

  if (sport === "gym") {
    const names = workout.exerciseNames.filter((n) => n.trim());
    const sets = state.exercises?.reduce((sum, ex) => sum + (ex.sets?.length ?? 0), 0) ?? 0;
    return {
      title: names.slice(0, 3).join(" · ") || workout.title || "Gym session",
      meta: [
        names.length > 0 ? `${names.length} exercise${names.length === 1 ? "" : "s"}` : null,
        sets > 0 ? `${sets} sets` : null,
        when,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  const unit = SPORT_FIELDS[sport].distance;
  const seconds = totalDurationSeconds(state);
  const headline = [
    state.distance && unit ? `${state.distance} ${unit}` : null,
    seconds > 0 ? formatClock(seconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: headline || workout.title || "Session",
    meta: [sessionTypeLabel(state.sessionType), when].filter(Boolean).join(" · "),
  };
}

/**
 * Start from something instead of from nothing.
 *
 * User complaint: "too many taps / too slow — getting from 'I finished a
 * workout' to 'it's saved' takes too long."
 *
 * What was here before was three secondary buttons of identical weight
 * ("Start from a past workout", "Templates", "Save as template"), none of
 * which looked like the fast path, all of which needed a tap before they would
 * even fetch anything, and two of which then needed a second tap to choose —
 * three taps and two round trips before a single number was on screen. The
 * past-workout list was also gated to gym, so an athlete logging their fourth
 * identical 10k this month got no help at all.
 *
 * Now: the athlete's real recent sessions are fetched as soon as the sport is
 * known and shown as cards that say what they contain, for every sport. One
 * tap loads one.
 *
 * This is not silent prefill — the blank-start rule (see createSetRow) is
 * about numbers appearing in a form nobody asked to be filled. Nothing here
 * happens without a deliberate tap on a card that states exactly what it is
 * about to put in the form.
 */
export function LogQuickActions({
  sport,
  onApplyState,
  onSaveTemplate,
  savingTemplate = false,
  dirty = false,
}: {
  sport: SportType | null;
  onApplyState: (state: WorkoutFormState) => void;
  onSaveTemplate?: (name: string) => void;
  savingTemplate?: boolean;
  /**
   * Has the athlete already typed something? Applying a past session replaces
   * the whole form, so once there is work to lose the rail stands down rather
   * than sitting there one mis-tap away from wiping it. "Start from" is a
   * thing you do at the start.
   */
  dirty?: boolean;
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [pastWorkouts, setPastWorkouts] = useState<PastWorkoutRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Every list below is per-sport, but this component stays mounted across a
  // sport change: activity-form.tsx renders it above the sport switcher strip,
  // so switching from (say) Running to Rowing re-renders it with a new `sport`
  // prop rather than remounting it. Without this reset the previous sport's
  // sessions stayed on screen, and tapping one applied a running form state
  // into the rowing form: distance "8" read as 8 km on screen but 8 metres by
  // the rowing field config, with no split, leaving a session that can't be
  // submitted. Adjusted during render on a prop change rather than in an
  // effect — the pattern this project already prefers (see app-shell.tsx).
  const [cachedSport, setCachedSport] = useState<SportType | null>(sport);
  if (sport !== cachedSport) {
    setCachedSport(sport);
    setTemplates([]);
    setPastWorkouts([]);
    // Set here rather than at the top of the effect below: this project lints
    // setState-in-effect, and a render-time adjustment is also strictly more
    // correct — it means there is never a frame that shows "no sessions" for
    // the new sport before the fetch has started.
    setLoading(true);
  }

  useEffect(() => {
    if (!sport) return;
    let cancelled = false;
    // Best-effort and in parallel: a slow or failed history fetch must never
    // stand between the athlete and a blank form they can already type into.
    void Promise.all([
      fetch(`/api/activities/recent?sport=${sport}&limit=6`)
        .then((res) => (res.ok ? res.json() : { workouts: [] }))
        .catch(() => ({ workouts: [] })),
      fetch(`/api/session-templates?sport=${sport}`)
        .then((res) => (res.ok ? res.json() : { templates: [] }))
        .catch(() => ({ templates: [] })),
    ]).then(([recent, tpl]) => {
      if (cancelled) return;
      setPastWorkouts(recent.workouts ?? []);
      setTemplates(tpl.templates ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  if (!sport) return null;

  const isGym = sport === "gym";
  const accentText = isGym ? "text-gym-accent" : "text-cardio-accent";
  const cardBase =
    "flex min-h-[74px] w-full min-w-0 flex-col justify-center gap-0.5 rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-200";

  /*
    FOUR SLOTS, TWO ROWS. The rail could hold six recent sessions plus every
    saved template because only two were ever on screen at once; a grid shows
    all of them, which would push the fields the athlete actually came for
    below the fold — trading one scroll for another. Four is two rows of the
    same 74px card.

    Templates keep two of the four when there are any: they are the sessions
    the athlete deliberately saved, and burying them under an automatic
    recent-history list is what a template is for avoiding.
  */
  const templateSlots = Math.min(templates.length, 2);
  const shownWorkouts = pastWorkouts.slice(0, QUICK_START_SLOTS - templateSlots);
  const shownTemplates = templates.slice(0, QUICK_START_SLOTS - shownWorkouts.length);

  // Nothing to offer, or the athlete is already mid-session — either way the
  // rail is dead weight above the fields they came for.
  if (dirty || (!loading && pastWorkouts.length === 0 && templates.length === 0)) {
    return onSaveTemplate && dirty ? (
      <div className="mb-5">
        <button
          type="button"
          disabled={savingTemplate}
          onClick={() => {
            const name = window.prompt("Template name");
            if (name?.trim()) onSaveTemplate(name.trim());
          }}
          className="flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Bookmark className="h-3.5 w-3.5" />
          {savingTemplate ? "Saving…" : "Save this as a template"}
        </button>
      </div>
    ) : null;
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <p className={cn("micro-label", accentText)}>Start from</p>
        <p className="text-[11px] text-muted/70">One tap, then adjust</p>
      </div>

      {/*
        A GRID, NOT A HIDDEN SCROLLER. This was a snap rail with the scrollbar
        explicitly suppressed, so nothing on screen said there was anything to
        the right of the second card — the same pattern the social tab strip
        was rewritten to escape. Two columns show four in the space one row of
        the rail took, and a card the athlete cannot see is a card they will
        never tap.
      */}
      <div className="grid grid-cols-2 gap-2">
        {loading && pastWorkouts.length === 0 && (
          <>
            <div className={cn(cardBase, "shimmer border-white/[0.06]")} aria-hidden />
            <div className={cn(cardBase, "shimmer border-white/[0.06]")} aria-hidden />
          </>
        )}

        {shownWorkouts.map((workout, index) => {
          const { title, meta } = describeWorkout(sport, workout);
          const isLatest = index === 0;
          return (
            <button
              key={workout.activityId}
              type="button"
              onClick={() => onApplyState(workout.formState)}
              className={cn(
                cardBase,
                isLatest
                  ? isGym
                    ? "border-gym-accent/35 bg-gym-accent/[0.07] hover:bg-gym-accent/[0.12]"
                    : "border-cardio-accent/35 bg-cardio-accent/[0.07] hover:bg-cardio-accent/[0.12]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
                  isLatest ? accentText : "text-muted/60"
                )}
              >
                {isLatest ? (
                  <>
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    Repeat last
                  </>
                ) : (
                  <>
                    <History className="h-3 w-3" aria-hidden />
                    Earlier
                  </>
                )}
              </span>
              {/*
                Two lines, not an ellipsis. The card is 109px wide at 320px
                rather than the rail's fixed 190, so "Squat · Bench · Barbell
                Row" truncated to "Squat · Benc…" — and which exercises are in
                it is the only thing that tells one past session from another.
                The card has the height for a second line; the meta below it
                stays one line because a date does not need wrapping.
              */}
              <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
                {title}
              </span>
              <span className="truncate text-[11px] text-muted">{meta}</span>
            </button>
          );
        })}

        {shownTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onApplyState(template.template_data)}
            className={cn(
              cardBase,
              "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
            )}
          >
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted/60">
              <Bookmark className="h-3 w-3" aria-hidden />
              Template
            </span>
            <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{template.name}</span>
            <span className="truncate text-[11px] text-muted">Saved session</span>
          </button>
        ))}
      </div>
    </div>
  );
}
