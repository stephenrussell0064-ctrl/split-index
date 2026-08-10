"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Target,
  Search,
  Check,
  Plus,
  Trash2,
  Loader2,
  Dumbbell,
  Activity,
  ChevronLeft,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COMMON_EXERCISES } from "@/lib/constants/sports";
import { MAX_PREMIUM_WEEKLY_CAPACITY } from "@/lib/premium/features";
import { cn } from "@/lib/utils/cn";

interface BenchmarkOption {
  value: string;
  label: string;
  distanceMeters: number;
  currentSeconds: number | null;
}

interface RankedGoal {
  id: string;
  goalType: "cardio" | "gym";
  targetKey: string;
  targetValue: number;
  currentValue: number | null;
  label: string;
  gapFraction: number;
  achieved: boolean;
  weight: number;
  weeklySessions: number;
}

interface PlanResponse {
  goals: RankedGoal[];
  lockedGoals: RankedGoal[];
  weeklyCapacity: number;
  maxWeeklyCapacity: number;
  premium: boolean;
  maxFreeGoals: number;
  totalGoalCount: number;
  benchmarkOptions: BenchmarkOption[];
}

type PickItem =
  | { kind: "cardio"; sport: string; label: string; distanceMeters: number; currentSeconds: number | null }
  | { kind: "gym"; exerciseName: string };

function itemKey(item: PickItem): string {
  return item.kind === "cardio" ? `cardio:${item.sport}` : `gym:${item.exerciseName}`;
}

function itemLabel(item: PickItem): string {
  return item.kind === "cardio" ? item.label : item.exerciseName;
}

const POPULAR_GYM_LIFTS = ["Squat", "Bench Press", "Deadlift", "Overhead Press"];
// Surfaced first, unfiltered — the "most standard metrics for measuring
// strength and speed" per user feedback, so there's always something
// obvious to tap before anyone has typed a single search character.
const POPULAR_CARDIO_SPORTS = ["run", "cycle", "swim", "row"];

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function formatValue(goalType: "cardio" | "gym", value: number | null): string {
  if (value === null) return "—";
  return goalType === "cardio" ? formatDuration(value) : `${value.toFixed(1)} kg`;
}

/**
 * Goal-driven hybrid training plan — entirely reworked (user feedback: "I
 * want you to be able to select any activity and any goal... prompt the
 * user to select more than one goal... entirely rework the UI so that each
 * question is asked full screen with options which are interactive to the
 * user, similar to the onboarding UI screens"). Mirrors
 * onboarding-flow.tsx's own visual language on purpose — segmented
 * progress strip, one Card per step, spring-crossfade transitions — rather
 * than inventing a second wizard style for the app to maintain.
 *
 * Now its own page (/training-plan, added to the primary nav) instead of
 * embedded in Interference — "Training plan in interference tab. I want
 * its own tab for training plan as this is a huge thing."
 *
 * Premium: see the doc comment on MAX_FREE_TRAINING_GOALS in
 * lib/premium/features.ts and on the API route itself.
 */
export function TrainingPlanWizard() {
  const reducedMotion = useReducedMotion();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // "picker" | "frequency" | "targets" | null (null = show the plan view,
  // once goals exist and no wizard flow is in progress).
  const [phase, setPhase] = useState<"picker" | "frequency" | "targets" | null>(null);
  const [addOnly, setAddOnly] = useState(false);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickItem[]>([]);
  const [frequency, setFrequency] = useState(5);
  const [targetIndex, setTargetIndex] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState("");
  const [targetSeconds, setTargetSeconds] = useState("");
  const [targetKg, setTargetKg] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load(capacity?: number) {
    try {
      const url = capacity ? `/api/training-goals?capacity=${capacity}` : "/api/training-goals";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load your training plan");
      setPlan(data as PlanResponse);
      setFrequency(data.weeklyCapacity);
      setLoadError(null);
      return data as PlanResponse;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your training plan");
      return null;
    }
  }

  useEffect(() => {
    void (async () => {
      const data = await load();
      // Fresh accounts land straight in the wizard; returning ones land on
      // their plan (user feedback pattern already established elsewhere in
      // this app: don't re-ask what's already answered).
      if (data && data.totalGoalCount === 0) {
        setPhase("picker");
        setAddOnly(false);
      }
    })();
  }, []);

  const existingKeys = useMemo(
    () => new Set((plan?.goals ?? []).concat(plan?.lockedGoals ?? []).map((g) => `${g.goalType}:${g.targetKey}`)),
    [plan]
  );

  const cardioOptions: Extract<PickItem, { kind: "cardio" }>[] = useMemo(
    () =>
      (plan?.benchmarkOptions ?? []).map((b) => ({
        kind: "cardio" as const,
        sport: b.value,
        label: b.label,
        distanceMeters: b.distanceMeters,
        currentSeconds: b.currentSeconds,
      })),
    [plan]
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cardioMatches = cardioOptions.filter(
      (c) => (q === "" ? false : c.label.toLowerCase().includes(q)) && !existingKeys.has(itemKey(c))
    );
    const gymMatches =
      q === ""
        ? []
        : COMMON_EXERCISES.filter((e) => e.name.toLowerCase().includes(q))
            .slice(0, 30)
            .map((e): PickItem => ({ kind: "gym", exerciseName: e.name }))
            .filter((item) => !existingKeys.has(itemKey(item)));
    return [...cardioMatches, ...gymMatches];
  }, [query, cardioOptions, existingKeys]);

  const popularItems: PickItem[] = useMemo(() => {
    const cardio = POPULAR_CARDIO_SPORTS.map((sport) => cardioOptions.find((c) => c.sport === sport)).filter(
      (c): c is Extract<PickItem, { kind: "cardio" }> => !!c
    );
    const gym: PickItem[] = POPULAR_GYM_LIFTS.map((name) => ({ kind: "gym", exerciseName: name }));
    return [...cardio, ...gym].filter((item) => !existingKeys.has(itemKey(item)));
  }, [cardioOptions, existingKeys]);

  function toggleItem(item: PickItem) {
    setSelected((prev) => {
      const key = itemKey(item);
      const exists = prev.some((p) => itemKey(p) === key);
      return exists ? prev.filter((p) => itemKey(p) !== key) : [...prev, item];
    });
  }

  function startAddGoal() {
    setSelected([]);
    setQuery("");
    setAddOnly(true);
    setPhase("picker");
  }

  function handlePickerContinue() {
    if (selected.length === 0) return;
    setPhase(addOnly ? "targets" : "frequency");
    setTargetIndex(0);
    primeTargetInputs(selected[0]);
  }

  function primeTargetInputs(item: PickItem) {
    if (item.kind === "cardio") {
      const seconds = item.currentSeconds;
      setTargetMinutes(seconds ? String(Math.floor(seconds / 60)) : "");
      setTargetSeconds(seconds ? String(Math.round(seconds % 60)) : "");
    } else {
      setTargetKg("");
    }
  }

  async function handleFrequencyContinue() {
    setPhase("targets");
    setTargetIndex(0);
    primeTargetInputs(selected[0]);
  }

  async function saveCurrentTarget() {
    const item = selected[targetIndex];
    if (!item) return;
    setActionError(null);

    const payload =
      item.kind === "cardio"
        ? {
            goalType: "cardio",
            targetKey: item.sport,
            targetValue: Number(targetMinutes || 0) * 60 + Number(targetSeconds || 0),
          }
        : { goalType: "gym", targetKey: item.exerciseName, targetValue: Number(targetKg) };

    if (payload.targetValue <= 0) {
      setActionError(
        item.kind === "cardio" ? "Enter a target time" : "Enter a target weight"
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/training-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save this goal");

      if (targetIndex + 1 < selected.length) {
        const nextItem = selected[targetIndex + 1];
        setTargetIndex(targetIndex + 1);
        primeTargetInputs(nextItem);
      } else {
        // Last goal saved — refresh the plan, set the desired weekly
        // capacity if this was the first-time setup, then land on the plan
        // view (phase = null).
        const data2 = await load(addOnly ? undefined : frequency);
        if (data2 && !addOnly && frequency !== data2.weeklyCapacity) await load(frequency);
        setPhase(null);
        setSelected([]);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save this goal");
    } finally {
      setSaving(false);
    }
  }

  async function handleCapacityChange(next: number) {
    if (!plan) return;
    const clamped = Math.max(1, Math.min(plan.maxWeeklyCapacity, next));
    setFrequency(clamped);
    await load(clamped);
  }

  async function removeGoal(id: string) {
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            goals: prev.goals.filter((g) => g.id !== id),
            lockedGoals: prev.lockedGoals.filter((g) => g.id !== id),
          }
        : prev
    );
    await fetch(`/api/training-goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void load(frequency);
  }

  const currentTargetItem = phase === "targets" ? selected[targetIndex] : null;

  // ---------- Loading ----------
  if (!plan && !loadError) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (loadError && !plan) {
    return <p className="py-8 text-center text-sm text-danger">{loadError}</p>;
  }

  if (!plan) return null;

  const stepMeta =
    phase === "picker"
      ? { title: addOnly ? "Add a goal" : "What do you want to get better at?", index: 0, total: addOnly ? 1 : 3 }
      : phase === "frequency"
        ? { title: "How many sessions per week?", index: 1, total: 3 }
        : phase === "targets"
          ? { title: currentTargetItem ? itemLabel(currentTargetItem) : "Set your target", index: 2, total: 3 }
          : null;

  return (
    <div className="mx-auto max-w-lg">
      {phase !== null && !addOnly && stepMeta && (
        <div className="mb-8">
          <div className="mb-4 flex gap-2">
            {Array.from({ length: stepMeta.total }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= stepMeta.index ? "bg-accent shadow-[0_0_8px_var(--accent-glow)]" : "bg-white/[0.08]"
                )}
              />
            ))}
          </div>
          <p className="mb-1.5 micro-label text-muted">Training Plan</p>
          <h1 className="headline-tight text-2xl font-semibold md:text-3xl">{stepMeta.title}</h1>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "picker" && (
          <motion.div
            key="picker"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {addOnly && (
              <div className="mb-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPhase(null)}
                  aria-label="Back to your plan"
                  className="flex h-9 w-9 items-center justify-center rounded-full glass hover:bg-white/5"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h1 className="headline-tight text-xl font-semibold">Add a goal</h1>
              </div>
            )}

            <Card className="space-y-4">
              <p className="text-sm text-muted">
                Any cardio sport or gym lift — search for it, or tap a popular one below. Pick as
                many as you want; the plan prioritizes whichever you&apos;re furthest from.
              </p>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search any activity or lift…"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-accent/50 focus:outline-none"
                />
              </div>

              {selected.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selected.map((item) => (
                    <button
                      key={itemKey(item)}
                      type="button"
                      onClick={() => toggleItem(item)}
                      className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent"
                    >
                      {itemLabel(item)}
                      <span className="text-accent/60">×</span>
                    </button>
                  ))}
                </div>
              )}

              {query.trim() === "" ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted/70">
                    Popular goals
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {popularItems.map((item) => {
                      const isSelected = selected.some((s) => itemKey(s) === itemKey(item));
                      return (
                        <button
                          key={itemKey(item)}
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                            isSelected
                              ? item.kind === "gym"
                                ? "border-gym-accent/50 bg-gym-accent/15 text-foreground"
                                : "border-cardio-accent/50 bg-cardio-accent/15 text-foreground"
                              : "border-white/10 text-muted hover:bg-white/5"
                          )}
                        >
                          {item.kind === "gym" ? (
                            <Dumbbell className="h-4 w-4 shrink-0" />
                          ) : (
                            <Activity className="h-4 w-4 shrink-0" />
                          )}
                          <span className="min-w-0 truncate">{itemLabel(item)}</span>
                          {isSelected && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="max-h-80 space-y-1.5 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">No matches — try a different search.</p>
                  ) : (
                    searchResults.map((item) => {
                      const isSelected = selected.some((s) => itemKey(s) === itemKey(item));
                      return (
                        <button
                          key={itemKey(item)}
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
                            isSelected
                              ? item.kind === "gym"
                                ? "border-gym-accent/50 bg-gym-accent/15 text-foreground"
                                : "border-cardio-accent/50 bg-cardio-accent/15 text-foreground"
                              : "border-white/10 text-muted hover:bg-white/5"
                          )}
                        >
                          {item.kind === "gym" ? (
                            <Dumbbell className="h-4 w-4 shrink-0" />
                          ) : (
                            <Activity className="h-4 w-4 shrink-0" />
                          )}
                          <span className="min-w-0 truncate">{itemLabel(item)}</span>
                          {isSelected && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </Card>

            <Button className="mt-6 w-full" disabled={selected.length === 0} onClick={handlePickerContinue}>
              Continue{selected.length > 0 ? ` (${selected.length})` : ""}
            </Button>
          </motion.div>
        )}

        {phase === "frequency" && (
          <motion.div
            key="frequency"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Card className="flex flex-col items-center py-10 text-center">
              <p className="mb-6 max-w-xs text-sm text-muted">
                How many training sessions can you realistically fit in a week? The plan spreads
                your goals across this many.
              </p>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setFrequency((f) => Math.max(1, f - 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-xl hover:bg-white/10"
                  aria-label="Fewer sessions"
                >
                  −
                </button>
                <span className="index-display w-20 text-5xl font-bold tabular-nums">{frequency}</span>
                <button
                  type="button"
                  onClick={() => setFrequency((f) => Math.min(plan.maxWeeklyCapacity, f + 1))}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-xl hover:bg-white/10"
                  aria-label="More sessions"
                >
                  +
                </button>
              </div>
              <p className="mt-3 text-xs text-muted">sessions / week</p>
              {!plan.premium && (
                <p className="mt-4 flex items-center gap-1.5 text-xs text-warning">
                  <Lock className="h-3 w-3" />
                  Free accounts are capped at {plan.maxWeeklyCapacity}/week —{" "}
                  <Link href="/settings/billing" className="underline">
                    Premium
                  </Link>{" "}
                  goes up to {MAX_PREMIUM_WEEKLY_CAPACITY}.
                </p>
              )}
            </Card>
            <Button className="mt-6 w-full" onClick={handleFrequencyContinue}>
              Continue
            </Button>
          </motion.div>
        )}

        {phase === "targets" && currentTargetItem && (
          <motion.div
            key={`target-${targetIndex}`}
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Card className="space-y-4">
              <p className="text-sm text-muted">
                Goal {targetIndex + 1} of {selected.length}
                {currentTargetItem.kind === "cardio" && currentTargetItem.currentSeconds !== null && (
                  <> — your current predicted time is {formatDuration(currentTargetItem.currentSeconds)}</>
                )}
              </p>
              {currentTargetItem.kind === "cardio" ? (
                <div className="flex gap-2">
                  <Input
                    label="Target minutes"
                    type="number"
                    min={0}
                    value={targetMinutes}
                    onChange={(e) => setTargetMinutes(e.target.value)}
                  />
                  <Input
                    label="Seconds"
                    type="number"
                    min={0}
                    max={59}
                    value={targetSeconds}
                    onChange={(e) => setTargetSeconds(e.target.value)}
                  />
                </div>
              ) : (
                <Input
                  label="Target weight (kg)"
                  type="number"
                  min={0}
                  value={targetKg}
                  onChange={(e) => setTargetKg(e.target.value)}
                  hint={`Your best 1-rep-max estimate for ${currentTargetItem.exerciseName}`}
                />
              )}
              {actionError && <p className="text-sm text-danger">{actionError}</p>}
            </Card>
            <Button className="mt-6 w-full" loading={saving} onClick={saveCurrentTarget}>
              {targetIndex + 1 < selected.length ? "Next goal" : "Build my plan"}
            </Button>
          </motion.div>
        )}

        {phase === null && (
          <motion.div
            key="plan"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PlanView
              plan={plan}
              onAddGoal={startAddGoal}
              onRemoveGoal={removeGoal}
              onCapacityChange={handleCapacityChange}
              frequency={frequency}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GoalRow({ goal, onRemove }: { goal: RankedGoal; onRemove?: (id: string) => void }) {
  return (
    <li
      className={cn(
        "rounded-xl border p-3",
        goal.achieved ? "border-success/30 bg-success/5" : "border-white/8 bg-white/[0.02]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {goal.achieved && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
            {goal.label}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatValue(goal.goalType, goal.currentValue)} → {formatValue(goal.goalType, goal.targetValue)}
            {!goal.achieved && ` · ${Math.round(goal.gapFraction * 100)}% to go`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!goal.achieved && goal.weeklySessions > 0 && (
            <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
              {goal.weeklySessions}x this week
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${goal.label} goal`}
              onClick={() => onRemove(goal.id)}
              className="text-muted/60 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {!goal.achieved && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.max(4, 100 - Math.min(100, goal.gapFraction * 100))}%` }}
          />
        </div>
      )}
    </li>
  );
}

function PlanView({
  plan,
  onAddGoal,
  onRemoveGoal,
  onCapacityChange,
  frequency,
}: {
  plan: PlanResponse;
  onAddGoal: () => void;
  onRemoveGoal: (id: string) => void;
  onCapacityChange: (next: number) => void;
  frequency: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-accent" />
          <h1 className="headline-tight text-xl font-semibold">Your Training Plan</h1>
        </div>
        <button
          type="button"
          onClick={onAddGoal}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
        >
          <Plus className="h-3.5 w-3.5" />
          Add goal
        </button>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Sessions per week</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onCapacityChange(frequency - 1)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
            >
              −
            </button>
            <span className="w-5 text-center tabular-nums text-foreground">{frequency}</span>
            <button
              type="button"
              onClick={() => onCapacityChange(frequency + 1)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
            >
              +
            </button>
          </div>
        </div>

        {plan.goals.length === 0 && plan.lockedGoals.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No goals yet — add a cardio time or a lift target to get your first plan.
          </p>
        ) : (
          <ul className="space-y-2">
            {plan.goals.map((goal) => (
              <GoalRow key={goal.id} goal={goal} onRemove={onRemoveGoal} />
            ))}
          </ul>
        )}
      </Card>

      {plan.lockedGoals.length > 0 && (
        <div className="relative">
          <div className="pointer-events-none select-none space-y-2 blur-[2px] opacity-40">
            <ul className="space-y-2">
              {plan.lockedGoals.map((goal) => (
                <GoalRow key={goal.id} goal={goal} />
              ))}
            </ul>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-gradient-to-b from-transparent via-background/60 to-background/90 px-6 text-center backdrop-blur-[2px]">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
              <Lock className="h-4 w-4 text-accent" />
            </div>
            <p className="text-sm font-medium">
              {plan.lockedGoals.length} more goal{plan.lockedGoals.length === 1 ? "" : "s"} saved
            </p>
            <p className="mt-1 max-w-[260px] text-xs text-muted">
              Free accounts balance {plan.maxFreeGoals} goal at a time. Upgrade to Premium to
              prioritize across all of them together, with more weekly sessions to work with.
            </p>
            <Link
              href="/settings/billing"
              className="mt-4 text-sm font-medium text-accent transition-colors hover:text-accent/80"
            >
              Upgrade to Premium →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
