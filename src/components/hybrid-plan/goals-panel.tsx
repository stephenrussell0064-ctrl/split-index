"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { Field, NumberField, DurationField } from "./intake-fields";
import { PLANNING_HORIZONS } from "@/lib/scoring/hpe/constants";
import { overriddenOneRms } from "@/lib/scoring/hpe/intake";

/**
 * The goals the block is actually built toward, editable on their own.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS SEPARATELY FROM THE INTAKE
 * ---------------------------------------------------------------------------
 * Every field here is already in the intake wizard, and the wizard is the right
 * place to answer them the first time — it explains each one, in order, with
 * the safety and history sections that give them meaning.
 *
 * It is the wrong place to CHANGE one. A goal is the thing an athlete revises
 * most often (the meet moved, the target went up, the priority shifted mid
 * block) and revising it meant re-entering a seven-section form to reach one
 * number. So this is the same fields, in one card, next to what the athlete
 * can currently do — which the wizard cannot show, because at intake time the
 * diagnostic has not run yet.
 *
 * It writes through the SAME endpoint and the same allowlisted section
 * (`PATCH /api/hpe/intake`, section "goal"), so there is no second way for a
 * goal to reach the database and no second set of rules about what is
 * writable.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not offer the multi-goal weekly-balancing model the old Training Plan
 * had. That was a different product answering "balance my goals across this
 * week"; this one answers "build me a block that arrives at an event date", and
 * merging them would have made both worse. Its page was removed at the
 * athlete's request and its API (`/api/training-goals`) has since been retired,
 * so this is now the only place a training goal is set anywhere in the app.
 */

interface IntakeGoalFields {
  eventDate: string | null;
  planTimeframeWeeks: number | null;
  target5kS: number | null;
  targetSquatKg: number | null;
  targetBenchKg: number | null;
  targetDeadliftKg: number | null;
  priority: number;
  priorityUserSet: boolean;
  squat1rmOverride: number | null;
  bench1rmOverride: number | null;
  deadlift1rmOverride: number | null;
}

interface PrefilledFields {
  oneRms: Record<string, number>;
  predicted5kS: number;
}

interface IntakeResponse {
  intake: IntakeGoalFields;
  prefilled: PrefilledFields;
}

/** The three lifts the block can be pointed at, in the order a meet runs them. */
const LIFTS = [
  { key: "squat", label: "Squat", field: "target_squat_kg" },
  { key: "bench", label: "Bench", field: "target_bench_kg" },
  { key: "deadlift", label: "Deadlift", field: "target_deadlift_kg" },
] as const;

/**
 * Every column this panel can write.
 *
 * Exported so a test can pin it against SECTION_FIELDS.goal — the route's
 * allowlist DROPS an unrecognised key rather than rejecting the request, so a
 * single mistyped column name here would show the athlete "Saved" over an edit
 * that never reached the database, and nothing would say so.
 */
export const GOAL_PANEL_FIELDS = [
  "event_date",
  "plan_timeframe_weeks",
  "target_5k_s",
  ...LIFTS.map((l) => l.field),
  "priority",
  "priority_user_set",
] as const;

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatKg(kg: number | null): string {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return "—";
  return `${Math.round(kg)}kg`;
}

/**
 * The distance between here and the target, in the target's own units.
 *
 * Signed deliberately. A target already met is not an error and must not be
 * hidden — an athlete who has passed their squat goal mid-block needs to see
 * that, because it is the moment to raise it.
 */
function GapChip({ gap, met, unit }: { gap: string; met: boolean; unit: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
        met ? "bg-endurance/15 text-endurance" : "bg-white/[0.06] text-muted"
      )}
    >
      {met ? "reached" : `${gap} ${unit} to go`}
    </span>
  );
}

/** Current beside target, so the gap is a fact on the screen rather than arithmetic. */
function TargetRow({
  label,
  current,
  target,
  children,
  gap,
}: {
  label: string;
  current: string;
  target: string;
  children: React.ReactNode;
  gap: React.ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.05] py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {gap}
      </div>
      <div className="mt-1 flex items-baseline gap-2 text-xs text-muted">
        <span className="tabular-nums">now {current}</span>
        <span aria-hidden>→</span>
        <span className="tabular-nums">target {target}</span>
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export function GoalsPanel({ onSaved }: { onSaved: () => void }) {
  const [data, setData] = useState<IntakeResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/hpe/intake");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as IntakeResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your goals.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Draft value if the athlete has touched this field, stored value otherwise. */
  const get = useCallback(
    <T,>(field: string, stored: T): T => (field in draft ? (draft[field] as T) : stored),
    [draft]
  );
  const set = (field: (typeof GOAL_PANEL_FIELDS)[number], value: unknown) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setSavedAt(null);
  };

  /**
   * What the athlete can do today, on the same footing the plan uses.
   *
   * `overriddenOneRms` rather than the logged estimates alone, because a
   * tested single the athlete typed into the intake is what the plan is both
   * promised against AND programmed from — showing a lower logged inference
   * here would put a third number in front of them.
   */
  const currentOneRms = useMemo(() => {
    if (!data) return {};
    return overriddenOneRms(data.prefilled.oneRms, {
      squat: data.intake.squat1rmOverride,
      bench: data.intake.bench1rmOverride,
      deadlift: data.intake.deadlift1rmOverride,
    });
  }, [data]);

  const dirty = Object.keys(draft).length > 0;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/hpe/intake", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // The same section allowlist the wizard writes through. A PATCH from
        // this card cannot reach a safety answer even if it tried.
        body: JSON.stringify({ section: "goal", values: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Could not save your goals.");
      setData((d) => (d ? { ...d, intake: { ...d.intake, ...json.intake } } : d));
      setDraft({});
      setSavedAt(Date.now());
      // The plan is built FROM these answers, so leaving the old block on
      // screen beside a changed target would show the athlete a plan that no
      // longer follows from what it says it follows from.
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your goals.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-48 w-full rounded-[1.75rem]" />
        <Skeleton className="h-64 w-full rounded-[1.75rem]" />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <h2 className="text-base font-semibold tracking-tight">Your goals could not be loaded</h2>
        <p className="mt-1 text-sm text-muted">{error ?? "Something went wrong reading them."}</p>
      </Card>
    );
  }

  const { intake } = data;
  const eventDate = get("event_date", intake.eventDate) as string | null;
  const timeframeWeeks = get("plan_timeframe_weeks", intake.planTimeframeWeeks) as number | null;
  const target5kS = get("target_5k_s", intake.target5kS) as number | null;
  const priority = get("priority", intake.priority) as number;

  const current5kS = data.prefilled.predicted5kS;
  const has5kTarget = target5kS != null && target5kS > 0;
  const fiveKMet = has5kTarget && current5kS <= target5kS;

  const anyLiftTarget = LIFTS.some(
    (l) => (get(l.field, intake[`target${l.label}Kg` as keyof IntakeGoalFields] as number | null) ?? 0) > 0
  );

  return (
    <div className="space-y-5">
      {/* The horizon first: every phase length, the taper and the peak measure
          back from it, so it is the answer that shapes the most. */}
      <Card>
        <h2 className="text-base font-semibold tracking-tight">What you are training for</h2>
        <p className="mt-1 text-sm text-muted">
          Change any of these and the block rebuilds around them. Everything here is optional — a goal you leave
          blank is set to maintain rather than develop, which is a real answer, not a gap.
        </p>

        <div className="mt-3">
          <Field
            label="Event date"
            why="Given a date, phase lengths, the taper and the peak all measure back from it, and it overrides the block length below."
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={eventDate ?? ""}
                onChange={(e) => set("event_date", e.target.value || null)}
                aria-label="Event date"
                className="min-h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground focus:border-accent focus:outline-none"
              />
              {eventDate && (
                <button
                  type="button"
                  onClick={() => set("event_date", null)}
                  className="min-h-11 rounded-xl border border-white/10 px-3 text-sm text-muted transition-colors hover:border-white/20 hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </Field>

          {!eventDate && (
            <Field
              label="Block length"
              why="Used when there is no event date. Without a deadline the block ends in a test week rather than a taper."
            >
              <div className="flex flex-wrap gap-2">
                {PLANNING_HORIZONS.map((h) => (
                  <button
                    key={h.weeks}
                    type="button"
                    onClick={() => set("plan_timeframe_weeks", h.weeks)}
                    aria-pressed={timeframeWeeks === h.weeks}
                    className={cn(
                      "min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors",
                      timeframeWeeks === h.weeks
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
                  aria-pressed={timeframeWeeks == null}
                  className={cn(
                    "min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors",
                    timeframeWeeks == null
                      ? "border-accent/40 bg-accent/15 text-accent"
                      : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
                  )}
                >
                  Let the engine choose
                </button>
              </div>
              {(() => {
                const chosen = PLANNING_HORIZONS.find((h) => h.weeks === timeframeWeeks);
                return chosen ? <p className="mt-2 text-xs leading-relaxed text-muted">{chosen.blurb}</p> : null;
              })()}
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Targets</h2>
        <p className="mt-1 text-sm text-muted">
          Each is shown against what you can do now, so the gap is on the screen rather than in your head.
        </p>

        <div className="mt-3">
          <TargetRow
            label="5k time"
            current={formatDuration(current5kS)}
            target={formatDuration(target5kS)}
            gap={
              has5kTarget ? (
                <GapChip
                  met={fiveKMet}
                  unit="faster"
                  gap={formatDuration(Math.max(0, current5kS - target5kS))}
                />
              ) : null
            }
          >
            <DurationField
              seconds={target5kS}
              onChange={(v) => set("target_5k_s", v)}
              ariaLabel="Target 5k time"
            />
          </TargetRow>

          {/* Per-lift rather than a total: asking for a total makes the athlete
              do arithmetic on three numbers they may not all know, and loses the
              whole answer if one is missing. */}
          {LIFTS.map((lift) => {
            const storedTarget = intake[
              `target${lift.label}Kg` as "targetSquatKg" | "targetBenchKg" | "targetDeadliftKg"
            ];
            const target = get(lift.field, storedTarget) as number | null;
            const current = currentOneRms[lift.key] ?? null;
            const hasTarget = target != null && target > 0;
            const met = hasTarget && current != null && current >= target;

            return (
              <TargetRow
                key={lift.key}
                label={lift.label}
                current={formatKg(current)}
                target={formatKg(target)}
                gap={
                  hasTarget ? (
                    <GapChip
                      met={met}
                      unit="more"
                      gap={formatKg(Math.max(0, target - (current ?? 0)))}
                    />
                  ) : null
                }
              >
                <NumberField
                  value={target}
                  onChange={(v) => set(lift.field, v)}
                  min={0}
                  suffix="kg"
                  ariaLabel={`Target ${lift.label.toLowerCase()}`}
                />
              </TargetRow>
            );
          })}
        </div>

        {!has5kTarget && !anyLiftTarget && (
          <p className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-muted">
            With no target on either side, the block maintains what you have rather than developing anything.
            That is a legitimate way to train — but if you came here for a number, give it one above.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Which matters more</h2>
        <p className="mt-1 text-sm text-muted">
          This decides how the week splits between running and lifting. It is pre-set from your goals; move it if
          that is wrong.
        </p>
        <div className="mt-4 space-y-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.25}
            value={priority}
            onChange={(e) => {
              set("priority", Number(e.target.value));
              // Marks the value as the athlete's own, so a later goal change
              // cannot silently move a slider they deliberately positioned.
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
          {!get("priority_user_set", intake.priorityUserSet) && (
            <p className="text-xs italic text-muted/70">
              Currently pre-set from the mix of goals you have set, not chosen by you.
            </p>
          )}
        </div>
      </Card>

      {error && (
        <p role="alert" className="px-1 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save and rebuild the block"}
        </Button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setDraft({});
              setError(null);
            }}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Discard changes
          </button>
        )}
        {!dirty && savedAt && <span className="text-sm text-endurance">Saved — your block is rebuilding.</span>}
      </div>

      <p className="px-1 text-xs text-muted/60">
        These are the goal answers from your intake. Everything else it asked —{" "}
        <Link href="/hybrid-plan/intake" className="text-accent hover:underline">
          health, history, availability
        </Link>{" "}
        — is edited there.
      </p>
    </div>
  );
}
