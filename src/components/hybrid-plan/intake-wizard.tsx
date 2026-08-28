"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { DEFAULT_TRAINING_SPLIT, TRAINING_SPLITS, type TrainingSplit } from "@/lib/scoring/hpe/constants";
import {
  CustomSplitEditor,
  DayWindowsEditor,
  DurationField,
  ExercisePicker,
  Field,
  MultiSelect,
  NumberField,
  Prefilled,
  PrefilledOverridable,
  SelectField,
  YesNo,
  type CustomSplitDayValue,
  type DayWindowValue,
  type LoggedExercise,
} from "./intake-fields";
import {
  INTAKE_DAYS,
  MANDATORY_SECTIONS,
  type IntakeRecord,
  type IntakeSection,
  type PrefilledFromSplitIndex,
} from "@/lib/scoring/hpe/intake-record";
import { PLANNING_HORIZONS } from "@/lib/scoring/hpe/constants";

/**
 * WP2 — the athlete intake flow.
 *
 * Structured exactly as HPE-ATHLETE-INTAKE-SPEC.md requires:
 *
 *  - Section A (safety) and Section B (goal) are mandatory and short. "A user
 *    who blocks here should never see a goal-setting screen" — so safety is
 *    first and a hard block short-circuits the rest of the flow.
 *  - Sections C-H are progressively revealed and skippable, each with its
 *    degradation stated on the skip itself rather than buried. An athlete
 *    should be able to see what skipping costs before they skip.
 *  - Nothing is asked twice: pre-filled values are shown for confirmation with
 *    a link to where they're edited.
 *  - Every question carries its "why we ask" — enforced by `Field` requiring
 *    the prop.
 */

interface IntakeResponse {
  intake: IntakeRecord;
  prefilled: PrefilledFromSplitIndex;
}

const SECTION_META: Record<IntakeSection, { title: string; blurb: string; skipCost: string | null }> = {
  health: {
    title: "Health and injuries",
    blurb: "Asked first, before anything else. A coach's first hour with any athlete is screening. Nothing here stops you getting a plan — it sets how hard the plan is allowed to be.",
    skipCost: null,
  },
  fuelling: {
    title: "Fuelling",
    blurb: "Questions about eating, kept apart from the medical screen because it is a different conversation. Training fasted is not counted against you.",
    skipCost: "Skipping leaves bodyweight guidance switched off, which is the only thing these questions control.",
  },
  goal: {
    title: "What you're training for",
    blurb: "The disciplines, how long the block runs, and — only if you have one — the date it counts down to.",
    skipCost: null,
  },
  history: {
    title: "What you have been doing",
    blurb: "Your recent and best training, in numbers. Week 1 of your plan is built directly on these.",
    skipCost:
      "Skipping means your experience is assumed to be under six months in both domains, which halves your volume ramp.",
  },
  body: {
    title: "Your numbers",
    blurb: "What we worked out from your logged sessions and your profile. Every one of these is an estimate, so correct any you know better.",
    skipCost: "Skipping means loads and heart-rate bands stay estimated, and wider than they need to be.",
  },
  training: {
    title: "How you train",
    blurb: "Where you train, how the gym week is carved up, and what you are happy to substitute.",
    skipCost: "Skipping means a gym is assumed, with an upper/lower split and no substitutions.",
  },
  availability: {
    title: "When you can train",
    blurb: "Which days, what time, and how much. This drives the scheduler directly.",
    skipCost: null,
  },
  recovery: {
    title: "Recovery and life load",
    blurb: "The 'how are you doing' questions. Individually weak, collectively the difference between a plan that fits a life and one that fits a spreadsheet.",
    skipCost: "Skipping means sleep is assumed at 7 hours and life stress at average, which nudges your ramp rate.",
  },
};

const ORDER: IntakeSection[] = [
  "health",
  "fuelling",
  "goal",
  "availability",
  "history",
  "body",
  "training",
  "recovery",
];

const DAY_OPTIONS = INTAKE_DAYS.map((d) => ({ value: d, label: d }));

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * `intake.dayWindows` comes back camelCased (parsed server-side by
 * `parseDayWindows`); a draft in progress holds whatever this component last
 * wrote, which is the snake_case wire shape. Both need to land on the same
 * shape before `DayWindowsEditor` can read them.
 */
function normalizeDayWindows(raw: unknown): DayWindowValue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        day: String(e.day ?? ""),
        available: Boolean(e.available),
        start_hour: Number(e.start_hour ?? e.startHour ?? 7),
        end_hour: Number(e.end_hour ?? e.endHour ?? 18),
        two_sessions: Boolean(e.two_sessions ?? e.twoSessions),
      };
    })
    .filter((w) => w.day.length > 0);
}

/**
 * A draft in progress holds the snake_case wire shape; a saved record comes
 * back camelCased. Both have to land on the editor's shape before it can read
 * them — the same problem `normalizeDayWindows` solves for training windows.
 */
function normalizeCustomDays(raw: unknown): CustomSplitDayValue[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const e = entry as Record<string, unknown>;
    const primary = e.primary_lift ?? e.primaryLift;
    return {
      label: String(e.label ?? ""),
      primary_lift: typeof primary === "string" && primary.length > 0 ? primary : null,
      patterns: Array.isArray(e.patterns) ? e.patterns.map(String) : [],
    };
  });
}

export function IntakeWizard() {
  const router = useRouter();
  const [data, setData] = useState<IntakeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // The athlete's own logged exercises, for the per-day picker. Fetched lazily
  // and failing silently: the picker degrades to "nothing logged yet", which is
  // the same message an athlete with no gym history sees, and the plan is
  // unaffected either way because picking nothing is a complete answer.
  const [loggedExercises, setLoggedExercises] = useState<LoggedExercise[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        const res = await fetch("/api/hpe/intake");
        if (res.ok && !cancelled) setData((await res.json()) as IntakeResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/hpe/intake/exercises");
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { exercises?: LoggedExercise[] };
        if (!cancelled) setLoggedExercises(json.exercises ?? []);
      } catch {
        // The picker is an enhancement. Losing it must not cost the athlete
        // the rest of the intake.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const section = ORDER[step];
  const intake = data?.intake;
  const prefilled = data?.prefilled;

  /**
   * The day names to offer exercise picks for — the athlete's own days when
   * they laid some out, otherwise the days of whichever split is in force.
   * De-duplicated, because an upper/lower rotation names "Upper" twice and
   * asking the same question twice is how a form loses somebody.
   */
  const exerciseDayLabels = useMemo(() => {
    if (!intake) return [] as string[];
    const custom = normalizeCustomDays(
      "custom_split_days" in draft ? draft.custom_split_days : intake.customSplitDays
    ).filter((d) => d.label.trim().length > 0);
    if (custom.length > 0) return [...new Set(custom.map((d) => d.label.trim()))];
    const chosen = ("training_split" in draft ? draft.training_split : intake.trainingSplit) as
      | TrainingSplit
      | null;
    const spec = TRAINING_SPLITS[chosen ?? DEFAULT_TRAINING_SPLIT];
    return [...new Set(spec.days.map((d) => d.label))];
  }, [draft, intake]);

  // Unsaved edits are dropped when the step changes — `get` falls back to the
  // stored value, so revisiting a section shows the athlete's own saved
  // answers rather than a stale draft from a section they backed out of.
  const clearDraft = useCallback(() => setDraft({}), []);
  const goToStep = useCallback(
    (next: number) => {
      clearDraft();
      setStep(next);
    },
    [clearDraft]
  );

  const get = useCallback(
    <T,>(key: string, stored: T): T => (key in draft ? (draft[key] as T) : stored),
    [draft]
  );
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  const save = useCallback(
    async (advance: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/hpe/intake", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, values: draft }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Could not save.");
          return;
        }
        setData((d) => (d ? { ...d, intake: json.intake as IntakeRecord } : d));
        if (advance) {
          if (step < ORDER.length - 1) goToStep(step + 1);
          else router.push("/hybrid-plan");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      } finally {
        setSaving(false);
      }
    },
    [draft, goToStep, router, section, step]
  );

  const leaCount = useMemo(() => {
    if (!intake) return 0;
    const answers = [
      get("lea_restricted_food", intake.leaRestrictedFood),
      get("lea_trains_fasted", intake.leaTrainsFasted),
      get("lea_unintended_weight_loss", intake.leaUnintendedWeightLoss),
      get("lea_bone_stress_injury", intake.leaBoneStressInjury),
      ...(prefilled?.sex === "female" ? [get("lea_amenorrhoea", intake.leaAmenorrhoea)] : []),
    ];
    return answers.filter((a) => a === true).length;
  }, [get, intake, prefilled?.sex]);

  // Advisory, not a gate.
  //
  // This was `hardBlock`, and it hid every section after the screen — so an
  // athlete who reported a limiting injury never reached the goal screen at
  // all, and the Save button was disabled so they could not even record their
  // answers. The engine stopped refusing these people; the form had not, which
  // meant the refusal simply moved up a layer where it was harder to see. The
  // text is unchanged in substance and now sits at the top of the section it
  // belongs to while the athlete carries on filling the form in.
  const healthAdvisory = useMemo(() => {
    if (!intake || !prefilled) return null;
    if (prefilled.age < 18) return "Under 18: this plan is built for development rather than for peaking a maximal total, so loads are capped.";
    if (get("parq_positive", intake.parqPositive) === true || get("chest_pain_on_exertion", intake.chestPainOnExertion) === true) {
      return "Please see a GP or sports physician about this before you train hard. Your plan is still built, and it stays at easy, conversational effort until you have been seen.";
    }
    if (get("pregnant_or_postpartum_12wk", intake.pregnantOrPostpartum12wk) === true) {
      return "Pregnant or within 12 weeks postpartum: a pelvic health physiotherapist is the right person to plan with. What follows is held well below maximal and is a starting point for that conversation.";
    }
    if (get("current_injury_limiting", intake.currentInjuryLimiting) === true) {
      return "Currently limited by an injury: your block is capped below maximal and the ramp is halved. Rehabilitating the injury itself is a physiotherapist\u2019s job rather than this engine\u2019s.";
    }
    if (leaCount >= 2) {
      return "Your fuelling answers suggest you may be training on less energy than you are using. No bodyweight guidance will be shown. A registered sports dietitian is the right next step, and the National Alliance for Eating Disorders helpline is there if you want support.";
    }
    return null;
  }, [get, intake, leaCount, prefilled]);

  if (loading) return <Skeleton className="h-96 w-full rounded-[1.75rem]" />;
  if (!data || !intake || !prefilled) {
    return (
      <Card>
        <p className="text-sm text-muted">Could not load your intake.</p>
      </Card>
    );
  }

  const meta = SECTION_META[section];
  const isMandatory = MANDATORY_SECTIONS.includes(section);
  const completed = new Set(intake.sectionsCompleted);

  return (
    <div className="space-y-5">
      {/* Progress. Mandatory sections are visually distinct from skippable
          ones so the athlete can see how short the required part is. */}
      <div className="flex gap-1.5">
        {ORDER.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => goToStep(i)}
            aria-label={`Go to ${SECTION_META[s].title}`}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i === step
                ? "bg-accent"
                : completed.has(s)
                  ? "bg-endurance/60"
                  : MANDATORY_SECTIONS.includes(s)
                    ? "bg-white/25"
                    : "bg-white/10"
            )}
          />
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{meta.title}</h2>
          <span className="text-xs uppercase tracking-wider text-muted">
            {isMandatory ? "Required" : "Optional"} · {step + 1} of {ORDER.length}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted">{meta.blurb}</p>

        {healthAdvisory && (section === "health" || section === "fuelling") && (
          <p className="mt-4 rounded-2xl border border-warning/30 bg-warning/[0.06] p-4 text-sm leading-relaxed text-warning/90">
            {healthAdvisory}
          </p>
        )}

        <div className="mt-4">
          {section === "health" && (
            <>
              <Prefilled
                label="Age"
                value={`${prefilled.age}`}
                source="From your profile"
              />
              <Field label="Has a doctor ever said you should only do physical activity supervised by a medical professional?" why="This is the PAR-Q+, the standard pre-exercise screen. A yes means clearance before a plan, not instead of one." required>
                <YesNo value={get("parq_positive", intake.parqPositive)} onChange={(v) => set("parq_positive", v)} />
              </Field>
              <Field label="Do you get chest pain, dizziness or unusual breathlessness during exercise?" why="These are the symptoms that need investigating before load goes up, not after." required>
                <YesNo value={get("chest_pain_on_exertion", intake.chestPainOnExertion)} onChange={(v) => set("chest_pain_on_exertion", v)} />
              </Field>
              <Field label="Do you currently have an injury or pain that changes how you train?" why="Rehabilitation is a different job from performance programming, and doing the second on top of the first is how people get hurt." required>
                <YesNo value={get("current_injury_limiting", intake.currentInjuryLimiting)} onChange={(v) => set("current_injury_limiting", v)} />
              </Field>
              <Field label="Any injury in the last 12 weeks that stopped you training for more than a week?" why="A recent injury halves your volume ramp. Left unanswered we assume yes, so answering no is what unlocks the full ramp." required>
                <YesNo value={get("injury_last_12_weeks", intake.injuryLast12Weeks)} onChange={(v) => set("injury_last_12_weeks", v)} />
              </Field>
              <Field label="Any surgery in the last 6 months?" why="Adds a clearance prompt before loading. Assumed yes until answered." required>
                <YesNo value={get("surgery_last_6_months", intake.surgeryLast6Months)} onChange={(v) => set("surgery_last_6_months", v)} />
              </Field>
              {prefilled.sex === "female" && (
                <Field label="Are you pregnant or within 12 weeks of giving birth?" why="Out of scope for this engine, and a pelvic health physiotherapist is the right first call." required>
                  <YesNo value={get("pregnant_or_postpartum_12wk", intake.pregnantOrPostpartum12wk)} onChange={(v) => set("pregnant_or_postpartum_12wk", v)} />
                </Field>
              )}
              <Field label="Do you take any medication that affects your heart rate (e.g. beta blockers)?" why="If so, every session is prescribed by pace and RPE instead. Prescribing heart-rate zones on beta blockers produces a useless plan." required>
                <YesNo value={get("medication_affecting_hr", intake.medicationAffectingHr)} onChange={(v) => set("medication_affecting_hr", v)} />
              </Field>

            </>
          )}

          {section === "fuelling" && (
            <>
                <p className="text-xs leading-relaxed text-muted">
                  Hybrid athletes chasing a weight class and a run time are a higher-risk group for low energy
                  availability. These answers never stop you getting a plan — all they decide is whether
                  bodyweight guidance is shown, and whether you are pointed at a dietitian.
                </p>
                <Field label="In the last 3 months, have you deliberately restricted food to change your weight or performance?" why="One of three. Assumed yes until answered.">
                  <YesNo value={get("lea_restricted_food", intake.leaRestrictedFood)} onChange={(v) => set("lea_restricted_food", v)} />
                </Field>
                <Field label="Do you often train fasted or under-fuelled?" why="Context for a dietitian if you ever see one. Not scored — training fasted is ordinary and does not count against you here.">
                  <YesNo value={get("lea_trains_fasted", intake.leaTrainsFasted)} onChange={(v) => set("lea_trains_fasted", v)} />
                </Field>
                <Field label="Have you lost more than 5% of your bodyweight in the last 3 months without intending to?" why="Two of three.">
                  <YesNo value={get("lea_unintended_weight_loss", intake.leaUnintendedWeightLoss)} onChange={(v) => set("lea_unintended_weight_loss", v)} />
                </Field>
                <Field label="Have you had a stress fracture or bone stress injury in the last 2 years?" why="Three of three.">
                  <YesNo value={get("lea_bone_stress_injury", intake.leaBoneStressInjury)} onChange={(v) => set("lea_bone_stress_injury", v)} />
                </Field>
                {prefilled.sex === "female" && (
                  <Field label="Have your periods been absent or irregular for 3+ months, other than from contraception?" why="Asked only where it applies, and scored alongside the three above.">
                    <YesNo value={get("lea_amenorrhoea", intake.leaAmenorrhoea)} onChange={(v) => set("lea_amenorrhoea", v)} />
                  </Field>
                )}
            </>
          )}

          {section === "goal" && (
            <>
              <Field label="What do you want to train for?" why="Decides which engines load. You can pick more than one, and none of them has to be a race." required>
                <MultiSelect
                  options={[
                    { value: "5k", label: "5k" },
                    { value: "10k", label: "10k" },
                    { value: "half", label: "Half" },
                    { value: "marathon", label: "Marathon" },
                    { value: "2k_row", label: "2k row" },
                    { value: "powerlifting", label: "Powerlifting meet" },
                    { value: "hyrox", label: "HYROX" },
                  ]}
                  selected={get("events", intake.events) as string[]}
                  onChange={(v) => set("events", v)}
                  ariaLabel="Events"
                />
              </Field>

              {/* Which cardio, and whether the plan may mix it.
                  Sits with the goal because it decides what the endurance half
                  of the plan IS, not merely how it is scheduled. Skippable
                  like everything else here: no answer means running, which is
                  what the engine did before the question existed. */}
              <Field
                label="Which kinds of cardio do you actually want to do?"
                why="Nothing outside what you pick here is ever prescribed. Pick rowing alone and every endurance session is a row, with paces in /500m rather than minutes per kilometre. Leave it blank and the plan is written as running."
              >
                <MultiSelect
                  options={[
                    { value: "run", label: "Running" },
                    { value: "walk", label: "Walking" },
                    { value: "row", label: "Rowing" },
                    { value: "cycle", label: "Cycling" },
                    { value: "swim", label: "Swimming" },
                  ]}
                  selected={get("cardio_modalities", intake.cardioModalities) as string[]}
                  onChange={(v) => set("cardio_modalities", v)}
                  ariaLabel="Cardio modalities"
                />
                {(() => {
                  const chosen = get("cardio_modalities", intake.cardioModalities) as string[];
                  if (chosen.length === 0) {
                    return (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Left blank you get a running plan. If you never run, this is the one question on this
                        screen worth answering — it is the difference between a plan in your sport and a running
                        plan with your sport&rsquo;s name on it.
                      </p>
                    );
                  }
                  if (chosen.length === 1 && chosen[0] === "walk") {
                    return (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Walking only means steady volume and no hard sessions — walking cannot carry an interval,
                        and inventing one would be dishonest. Adding anything else, even a bike, changes that.
                      </p>
                    );
                  }
                  return (
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      Hard sessions stay in one of these so they progress against a single benchmark; easy volume
                      is spread across the rest.
                    </p>
                  );
                })()}
              </Field>
              <Field
                label="Do you want to cross-train?"
                why="Say no and every endurance session stays in what you picked above — with one modality chosen, nothing in the plan will ever ask you to run. Say yes and easy volume is spread across your choices."
              >
                <YesNo
                  value={get("cross_train_ok", intake.crossTrainOk) as boolean}
                  onChange={(v) => set("cross_train_ok", v)}
                />
              </Field>

              {/* Always shown. Training without a date is the ordinary case, not the
                  fallback — an event date simply overrides this when there is one. */}
              <>
                <Field label="How long should this plan run?" why="Most people are training rather than counting down to a date, so this is the normal way to answer. Leave it on 'let the engine choose' for a standard 12-week block.">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Planning horizon">
                    {PLANNING_HORIZONS.map((h) => (
                      <button
                        key={h.weeks}
                        type="button"
                        onClick={() => set("plan_timeframe_weeks", h.weeks)}
                        aria-pressed={(get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null) === h.weeks}
                        className={cn(
                          "min-h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                          (get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null) === h.weeks
                            ? "border-accent/40 bg-accent/15 text-accent"
                            : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
                        )}
                      >
                        {h.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => set("plan_timeframe_weeks", null)}
                      aria-pressed={(get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null) == null}
                      className={cn(
                        "min-h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                        (get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null) == null
                          ? "border-accent/40 bg-accent/15 text-accent"
                          : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
                      )}
                    >
                      Let the engine choose
                    </button>
                  </div>
                  {(() => {
                    const chosen = PLANNING_HORIZONS.find(
                      (h) => h.weeks === (get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null)
                    );
                    return chosen ? <p className="mt-2 text-xs leading-relaxed text-muted">{chosen.blurb}</p> : null;
                  })()}
                </Field>
              </>
              <Field label="Do you have an event? When is it?" why="Optional, and most people do not. Given a date, phase lengths, the taper and the peak all measure back from it and it overrides the block length above.">
                <input
                  type="date"
                  value={(get("event_date", intake.eventDate) as string | null) ?? ""}
                  onChange={(e) => set("event_date", e.target.value || null)}
                  aria-label="Event date"
                  className="min-h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground focus:border-accent focus:outline-none"
                />
              </Field>              {((get("events", intake.events) as string[]).length >= 2) && (
                <>
                  <Field label="Are these on the same day?" why="Same-day events need an order, and one of the two orders is a safety block rather than a preference.">
                    <YesNo value={get("same_day", intake.sameDay) as boolean} onChange={(v) => set("same_day", v)} />
                  </Field>
                  {(get("same_day", intake.sameDay) as boolean) && (
                    <Field label="Roughly how many hours between them?" why="Drives how much of the first event's fatigue has cleared before the second.">
                      <NumberField
                        value={get("inter_event_gap_h", intake.interEventGapH) as number}
                        onChange={(v) => set("inter_event_gap_h", v ?? 4)}
                        min={0.5}
                        max={14}
                        step={0.5}
                        suffix="hours"
                        ariaLabel="Hours between events"
                      />
                    </Field>
                  )}
                </>
              )}
              <Field label="Target 5k time" why="Optional. Without it the endurance side is set to maintain rather than develop, and interval paces stop progressing toward anything.">
                <DurationField
                  seconds={get("target_5k_s", intake.target5kS) as number | null}
                  onChange={(v) => set("target_5k_s", v)}
                  ariaLabel="Target 5k time"
                />
              </Field>
              {/* Per-lift, not a total: asking for a total makes the athlete do arithmetic on three numbers they may not all know, and loses the whole answer if one is missing. Each is independently skippable. */}
              <Field label="Target squat" why="Optional and independent of bench and deadlift below — any one of the three is still useful. Without at least one the strength side is set to maintain rather than develop.">
                <NumberField
                  value={get("target_squat_kg", intake.targetSquatKg) as number | null}
                  onChange={(v) => set("target_squat_kg", v)}
                  min={0}
                  suffix="kg"
                  ariaLabel="Target squat"
                />
              </Field>
              <Field label="Target bench" why="Optional and independent of the other two.">
                <NumberField
                  value={get("target_bench_kg", intake.targetBenchKg) as number | null}
                  onChange={(v) => set("target_bench_kg", v)}
                  min={0}
                  suffix="kg"
                  ariaLabel="Target bench"
                />
              </Field>
              <Field label="Target deadlift" why="Optional and independent of the other two.">
                <NumberField
                  value={get("target_deadlift_kg", intake.targetDeadliftKg) as number | null}
                  onChange={(v) => set("target_deadlift_kg", v)}
                  min={0}
                  suffix="kg"
                  ariaLabel="Target deadlift"
                />
              </Field>
              <Field label="If you could only hit one, which matters more?" why="Pre-set from your goals. Move it if it is wrong — it decides how the week splits between running and lifting.">
                <div className="space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.25}
                    value={get("priority", intake.priority) as number}
                    onChange={(e) => {
                      set("priority", Number(e.target.value));
                      set("priority_user_set", true);
                    }}
                    aria-label="Goal priority: endurance to strength"
                    className="w-full accent-[var(--accent)]"
                  />
                  <div className="flex justify-between text-xs text-muted">
                    <span>Endurance</span>
                    <span>Even</span>
                    <span>Strength</span>
                  </div>
                </div>
              </Field>
              <Field label="Are you lifting in a weight class?" why="Only used to frame the bodyweight discussion honestly, and to refuse a water cut alongside a same-day race.">
                <NumberField
                  value={get("weight_class_kg", intake.weightClassKg) as number | null}
                  onChange={(v) => set("weight_class_kg", v)}
                  min={0}
                  suffix="kg"
                  ariaLabel="Weight class"
                />
              </Field>
              {get("weight_class_kg", intake.weightClassKg) != null && (
                <Field label="Are you planning to cut weight for weigh-in?" why="Declared alongside a same-day endurance race, this is refused outright — dehydration is incompatible with a 5k and with recovering between events.">
                  <YesNo value={get("intends_weight_cut", intake.intendsWeightCut)} onChange={(v) => set("intends_weight_cut", v)} />
                </Field>
              )}
            </>
          )}

          {section === "availability" && (
            <>
              <Field label="Which days can you train?" why="A hard scheduler constraint — at least three. Sessions are never placed on a day you have not picked." required>
                <MultiSelect
                  options={DAY_OPTIONS}
                  selected={get("days_available", intake.daysAvailable) as string[]}
                  onChange={(v) => set("days_available", v)}
                  ariaLabel="Days available"
                />
              </Field>
              <Field label="Can you train twice on some days?" why="Enables same-day pairs, which is the only way to fit a big week into few days.">
                <YesNo value={get("two_a_days_possible", intake.twoADaysPossible) as boolean} onChange={(v) => set("two_a_days_possible", v)} />
              </Field>
              <Field label="Roughly what times do you train?" why="The six-hour separation rule between a hard lift and a hard run is computed from these, not assumed. Training at 06:00 and 12:00 clears it; 12:00 and 17:00 does not.">
                <div className="flex items-center gap-3">
                  <NumberField
                    value={get("am_hour", intake.amHour) as number}
                    onChange={(v) => set("am_hour", v ?? 7)}
                    min={0}
                    max={23}
                    suffix="morning"
                    ariaLabel="Morning training hour"
                  />
                  <NumberField
                    value={get("pm_hour", intake.pmHour) as number}
                    onChange={(v) => set("pm_hour", v ?? 18)}
                    min={0}
                    max={23}
                    suffix="evening"
                    ariaLabel="Evening training hour"
                  />
                </div>
              </Field>
              <Field label="Most sessions you would realistically do in a week" why="A cap, not a target. The engine fits the plan inside it rather than assuming you will find extra time." required>
                <NumberField
                  value={get("max_sessions_per_week", intake.maxSessionsPerWeek) as number}
                  onChange={(v) => set("max_sessions_per_week", v ?? 6)}
                  min={3}
                  max={12}
                  ariaLabel="Max sessions per week"
                />
              </Field>
              <Field label="Longest single session you can fit" why="Caps the long run and the volume days. A plan with a 2-hour session you cannot do is a plan you abandon.">
                <NumberField
                  value={get("max_session_min", intake.maxSessionMin) as number}
                  onChange={(v) => set("max_session_min", v ?? 90)}
                  min={20}
                  max={240}
                  suffix="min"
                  ariaLabel="Max session minutes"
                />
              </Field>
              <Field label="Days you can get to a gym" why="Strength sessions are only ever placed on these. Defaults to every day you train.">
                <MultiSelect
                  options={DAY_OPTIONS}
                  selected={get("gym_access_days", intake.gymAccessDays) as string[]}
                  onChange={(v) => set("gym_access_days", v)}
                  ariaLabel="Gym access days"
                />
              </Field>
              <Field label="Does your week vary too much to fix to set days?" why="When on, the plan stops trying to fix sessions to specific days and gives you an ordered list instead — the order is what matters, and the spacing rules apply as you place the sessions yourself.">
                <YesNo
                  value={get("availability_varies", intake.availabilityVaries) as boolean}
                  onChange={(v) => set("availability_varies", v)}
                />
              </Field>
              {!(get("availability_varies", intake.availabilityVaries) as boolean) && (
                <Field label="Exact training windows, per day" why="Optional and more precise than the morning/evening hours above. Real clock times differ by day, and the six-hour separation rule between a hard lift and a hard run is computed from these — a day left as a rest day here just falls back to the flat hours.">
                  <DayWindowsEditor
                    days={INTAKE_DAYS}
                    value={normalizeDayWindows(get("day_windows", intake.dayWindows))}
                    onChange={(v) => set("day_windows", v)}
                  />
                </Field>
              )}
              <Field label="Best day for your longest session" why="A soft preference. The scheduler honours it unless a hard constraint says otherwise.">
                <SelectField
                  value={get("preferred_long_day", intake.preferredLongDay) as string | null}
                  onChange={(v) => set("preferred_long_day", v)}
                  options={DAY_OPTIONS}
                  ariaLabel="Preferred long day"
                />
              </Field>
              <Field label="Preferred rest day" why="Also soft. Every week gets at least one rest day regardless.">
                <SelectField
                  value={get("preferred_rest_day", intake.preferredRestDay) as string | null}
                  onChange={(v) => set("preferred_rest_day", v)}
                  options={DAY_OPTIONS}
                  ariaLabel="Preferred rest day"
                />
              </Field>
            </>
          )}

          {section === "history" && (
            <>
              <Field label="How many minutes of running are you doing in a typical week right now?" why="The single most important field here. Week 1 of your plan is exactly this number. If it disagrees with your logs, the lower of the two is used unless you say below that some training goes unrecorded.">
                <NumberField
                  value={get("current_run_min_per_week", intake.currentRunMinPerWeek) as number | null}
                  onChange={(v) => set("current_run_min_per_week", v)}
                  min={0}
                  max={800}
                  suffix="min/week"
                  ariaLabel="Current weekly running minutes"
                />
              </Field>
              <Field
                label="Is some of your training not recorded in Split Index?"
                why="If yes, the number above is used as-is. If no, the lower of your figure and your logs is used, because starting a plan above where you actually are is the most common way generated plans cause injury."
              >
                <YesNo
                  value={get("trains_outside_app", intake.trainsOutsideApp) as boolean}
                  onChange={(v) => set("trains_outside_app", v)}
                />
              </Field>
              <Field label="How long have you been running consistently?" why="Under six months halves your ramp rate and caps endurance targets.">
                <NumberField
                  value={get("endurance_training_years", intake.enduranceTrainingYears) as number | null}
                  onChange={(v) => set("endurance_training_years", v)}
                  min={0}
                  max={40}
                  step={0.5}
                  suffix="years"
                  ariaLabel="Years running"
                />
              </Field>
              <Field label="Longest single run in the last month" why="Sets where your long run starts, so it does not begin above what you have recently done.">
                <NumberField
                  value={get("longest_recent_run_min", intake.longestRecentRunMin) as number | null}
                  onChange={(v) => set("longest_recent_run_min", v)}
                  min={0}
                  max={300}
                  suffix="min"
                  ariaLabel="Longest recent run"
                />
              </Field>
              <Field label="Highest weekly running volume you have ever sustained for a month" why="A ceiling on the ramp. If you have held 300 min/week before, getting back there is a different problem from reaching it the first time.">
                <NumberField
                  value={get("previous_max_volume", intake.previousMaxVolume) as number | null}
                  onChange={(v) => set("previous_max_volume", v)}
                  min={0}
                  max={800}
                  suffix="min/week"
                  ariaLabel="Previous max weekly volume"
                />
              </Field>
              <Field label="How many lifting sessions are you doing now?" why="Part of the on-ramp: the plan starts from what you are doing, not from what it would like you to do.">
                <NumberField
                  value={get("current_strength_sessions_per_week", intake.currentStrengthSessionsPerWeek) as number | null}
                  onChange={(v) => set("current_strength_sessions_per_week", v)}
                  min={0}
                  max={10}
                  suffix="per week"
                  ariaLabel="Current lifting sessions per week"
                />
              </Field>
              <Field label="How long have you trained the barbell lifts consistently?" why="Under 12 months means a competition peaking block is not appropriate, and a general preparation plan is offered instead. That is a gate, not a judgement — a novice does not need peaking, they need consistent exposure.">
                <NumberField
                  value={get("strength_training_years", intake.strengthTrainingYears) as number | null}
                  onChange={(v) => set("strength_training_years", v)}
                  min={0}
                  max={40}
                  step={0.5}
                  suffix="years"
                  ariaLabel="Years lifting"
                />
              </Field>

            </>
          )}

          {section === "training" && (
            <>
              {/* First, because it decides whether anything below is even
                  performable. "Do you have a barbell" was the old question and
                  it had the order backwards — a barbell is a detail inside gym
                  access, not a substitute for asking about it. */}
              <Field
                label="Can you get to a gym?"
                why="If not, the barbell lifts are substituted for movements you can actually perform. Prescribing a back squat to someone training in a bedroom produces a plan that cannot be followed."
              >
                <YesNo
                  value={get("has_gym_access", intake.hasGymAccess) as boolean}
                  onChange={(v) => set("has_gym_access", v)}
                />
              </Field>

              {!(get("has_gym_access", intake.hasGymAccess) as boolean) && (
                <p className="rounded-2xl border border-warning/25 bg-warning/[0.06] p-4 text-sm leading-relaxed text-warning/90">
                  Without a gym your strength work becomes goblet squats, push-up progressions and single-leg
                  hinges. Those train the same patterns and they are not the same lifts — the load is lower and
                  progress will be slower than a barbell block would give you. Full home and dumbbell programming
                  is not built yet, so this is thinner than it should be.
                </p>
              )}

              {(get("has_gym_access", intake.hasGymAccess) as boolean) && (
                <Field
                  label="How do you want your gym week split?"
                  why="This decides how the week is carved up, not how hard it is — your diagnostic still sets the intensity and which lift leads each day."
                >
                  <SelectField
                    value={(get("training_split", intake.trainingSplit) as string | null) ?? ""}
                    onChange={(v) => set("training_split", v === "" ? null : v)}
                    ariaLabel="Training split"
                    options={[
                      { value: "", label: "No preference — pick for me" },
                      ...Object.entries(TRAINING_SPLITS).map(([value, spec]) => ({
                        value,
                        label: spec.label,
                      })),
                    ]}
                  />
                  {(() => {
                    const chosen = get("training_split", intake.trainingSplit) as TrainingSplit | null;
                    const spec = chosen ? TRAINING_SPLITS[chosen] : null;
                    return (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {spec
                          ? spec.blurb
                          : `Left blank, you get ${TRAINING_SPLITS[DEFAULT_TRAINING_SPLIT].label.toLowerCase()} — ` +
                            `the most time-efficient split and the easiest to fit around running.`}
                      </p>
                    );
                  })()}
                </Field>
              )}

              {(get("has_gym_access", intake.hasGymAccess) as boolean) && (
                <>
                  <Field
                    label="Prefer to lay out your own gym days?"
                    why="Optional, and only worth it if none of the splits above describes your week. Each day needs at least one movement pattern — that is what the day gets filled with. Leave this empty and the split above is used."
                  >
                    <CustomSplitEditor
                      value={normalizeCustomDays(get("custom_split_days", intake.customSplitDays))}
                      onChange={(v) => set("custom_split_days", v)}
                    />
                  </Field>

                  <Field
                    label="Pick your own exercises for each day"
                    why="Seeded from what you have actually logged, not from the full catalogue. Pick nothing and the engine chooses for you, which is what it does today — this only ever adds."
                  >
                    {exerciseDayLabels.length === 0 ? (
                      <p className="text-xs leading-relaxed text-muted">
                        Choose a split above, or lay out your own days, and each day appears here to pick for.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {exerciseDayLabels.map((dayLabel) => (
                          <div key={dayLabel}>
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                              {dayLabel}
                            </p>
                            <ExercisePicker
                              dayLabel={dayLabel}
                              available={loggedExercises}
                              selected={
                                (get("exercises_by_day", intake.exercisesByDay) as Record<string, string[]>)[
                                  dayLabel
                                ] ?? []
                              }
                              onChange={(names) => {
                                const current = {
                                  ...(get("exercises_by_day", intake.exercisesByDay) as Record<string, string[]>),
                                };
                                if (names.length === 0) delete current[dayLabel];
                                else current[dayLabel] = names;
                                set("exercises_by_day", current);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </Field>
                </>
              )}

              <Field label="Happy to do some easy volume on a bike or rower?" why="Lets the engine swap some easy running for low-impact work, which limits interference with heavy lifting.">
                <YesNo value={get("substitution_ok", intake.substitutionOk) as boolean} onChange={(v) => set("substitution_ok", v)} />
              </Field>
            </>
          )}

          {section === "body" && (
            <>
              <Prefilled
                label="Weekly running from your logs"
                value={prefilled.loggedWeeklyRunMinutes != null ? `${Math.round(prefilled.loggedWeeklyRunMinutes)} min` : null}
                source="8-week average from your logged sessions"
                missing="no logged runs yet"
              />
              <Prefilled
                label="Predicted 5k"
                value={fmtDuration(prefilled.predicted5kS)}
                source="From the prediction engine"
              />
              {(["squat", "bench", "deadlift"] as const).map((lift) => {
                const key = `${lift}_1rm_override` as const;
                const current = {
                  squat: intake.squat1rmOverride,
                  bench: intake.bench1rmOverride,
                  deadlift: intake.deadlift1rmOverride,
                }[lift];
                return (
                  <PrefilledOverridable
                    key={lift}
                    label={lift.charAt(0).toUpperCase() + lift.slice(1)}
                    value={prefilled.oneRms[lift] ? `${Math.round(prefilled.oneRms[lift])} kg` : null}
                    source="Adaptive 1RM from your logged sets"
                    missing="not enough logged sets yet"
                    override={get(key, current) as number | null}
                    onOverride={(v) => set(key, v)}
                    unit="kg"
                    min={1}
                    max={600}
                    step={2.5}
                  />
                );
              })}
              <PrefilledOverridable
                label="Resting heart rate"
                value={prefilled.restingHr != null ? `${prefilled.restingHr} bpm` : null}
                source="From your profile"
                missing="assumed 60"
                override={get("resting_hr_override", intake.restingHrOverride) as number | null}
                onOverride={(v) => set("resting_hr_override", v)}
                unit="bpm"
                min={25}
                max={120}
              />
              <PrefilledOverridable
                label="Maximum heart rate"
                value={prefilled.maxHr != null ? `${prefilled.maxHr} bpm` : null}
                source="From your profile or your logged maximal efforts"
                missing="age-estimated"
                override={get("max_hr_override", intake.maxHrOverride) as number | null}
                onOverride={(v) => set("max_hr_override", v)}
                unit="bpm"
                min={100}
                max={230}
              />
              <Field label="Do you know your max heart rate from a race or hard effort?" why="A measured max narrows every heart-rate band in your plan. An age-estimated one is a population average wearing your name.">
                <YesNo value={get("max_hr_known", intake.maxHrKnown) as boolean} onChange={(v) => set("max_hr_known", v)} />
              </Field>
              <Field label="Does your heart rate tend to run high compared to others at the same effort?" why="Shifts the engine toward your own logged HR-vs-pace data sooner, rather than population zones.">
                <YesNo value={get("hr_runs_high", intake.hrRunsHigh) as boolean} onChange={(v) => set("hr_runs_high", v)} />
              </Field>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Heart rate is edited in{" "}
                <Link href="/profile" className="text-accent hover:underline">
                  your profile
                </Link>{" "}
                — it is used by the rest of Split Index too, so it lives in one place.
              </p>
            </>
          )}

          {section === "recovery" && (
            <>
              <Field label="Typical nightly sleep" why="Modifies how fast volume is allowed to ramp. Assumed 7 hours if you skip.">
                <NumberField
                  value={get("sleep_hours_typical", intake.sleepHoursTypical) as number | null}
                  onChange={(v) => set("sleep_hours_typical", v)}
                  min={3}
                  max={12}
                  step={0.5}
                  suffix="hours"
                  ariaLabel="Typical sleep"
                />
              </Field>
              <Field label="Do you work shifts or nights?" why="Disables the fixed morning/evening assumptions in the scheduler.">
                <YesNo value={get("shift_work", intake.shiftWork) as boolean} onChange={(v) => set("shift_work", v)} />
              </Field>
              <Field label="Is your job sedentary, on your feet, or physical?" why="Adjusts the chronic-load seed — a day on your feet is training load your watch never sees.">
                <SelectField
                  value={get("job_physicality", intake.jobPhysicality) as string}
                  onChange={(v) => set("job_physicality", v)}
                  options={[
                    { value: "sedentary", label: "Sedentary" },
                    { value: "on_feet", label: "On my feet" },
                    { value: "physical", label: "Physical" },
                  ]}
                  ariaLabel="Job physicality"
                />
              </Field>            </>
          )}

        </div>

        {error && (
          <p className="mt-4 rounded-2xl border border-danger/25 bg-danger/[0.06] p-3 text-sm text-danger">{error}</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
          {step > 0 && (
            <Button variant="ghost" size="sm" onClick={() => goToStep(step - 1)} disabled={saving}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={() => void save(true)} loading={saving}>
            {step === ORDER.length - 1 ? "Finish" : "Save and continue"}
          </Button>
          {!isMandatory && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (step < ORDER.length - 1 ? goToStep(step + 1) : router.push("/hybrid-plan"))}
              disabled={saving}
            >
              Skip
            </Button>
          )}
        </div>

        {/* The cost of skipping, stated before the skip rather than after. */}
        {!isMandatory && meta.skipCost && (
          <p className="mt-3 text-xs leading-relaxed text-muted">{meta.skipCost}</p>
        )}
      </Card>
    </div>
  );
}
