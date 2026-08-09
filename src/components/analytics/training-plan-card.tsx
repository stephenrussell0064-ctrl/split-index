"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Plus, Trash2, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { COMMON_EXERCISES } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";

type GoalType = "cardio" | "gym";

interface RankedGoal {
  id: string;
  goalType: GoalType;
  targetKey: string;
  targetValue: number;
  currentValue: number | null;
  label: string;
  gapFraction: number;
  achieved: boolean;
  weight: number;
  weeklySessions: number;
}

interface BenchmarkOption {
  value: string;
  label: string;
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatValue(goal: Pick<RankedGoal, "goalType" | "currentValue">, value: number | null): string {
  if (value === null) return "—";
  return goal.goalType === "cardio" ? formatDuration(value) : `${value.toFixed(1)} kg`;
}

const GYM_EXERCISE_OPTIONS = COMMON_EXERCISES.map((e) => ({ value: e.name, label: e.name }));

/**
 * Goal-driven hybrid training plan (user feedback): "I now want... a
 * recommendation of what to train. I want generated plans for users to
 * build the most effective route to their goal... prioritise the exercise
 * or activity which they are furthest away from, whilst still maintaining
 * the hybrid balance between all exercises." Sits alongside the
 * Interference Radar on /interference — the two features are natural
 * neighbors (one explains how your training interacts, this says what to
 * actually do about it).
 */
export function TrainingPlanCard() {
  const [goals, setGoals] = useState<RankedGoal[] | null>(null);
  const [benchmarkOptions, setBenchmarkOptions] = useState<BenchmarkOption[]>([]);
  const [weeklyCapacity, setWeeklyCapacity] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [goalType, setGoalType] = useState<GoalType>("cardio");
  const [cardioSport, setCardioSport] = useState("");
  const [exerciseName, setExerciseName] = useState(GYM_EXERCISE_OPTIONS[0]?.value ?? "");
  const [minutes, setMinutes] = useState("25");
  const [seconds, setSeconds] = useState("0");
  const [targetKg, setTargetKg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadPlan(capacity = weeklyCapacity) {
    try {
      const res = await fetch(`/api/training-goals?capacity=${capacity}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load your training plan");
      setGoals(data.goals ?? []);
      setBenchmarkOptions(data.benchmarkOptions ?? []);
      if (!cardioSport && data.benchmarkOptions?.length) setCardioSport(data.benchmarkOptions[0].value);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your training plan");
    }
  }

  useEffect(() => {
    // Inlined rather than calling loadPlan() from here — this project's own
    // lint rule flags a named-function call inside an effect body that
    // itself calls setState (react-hooks/set-state-in-effect); an inline
    // async IIFE is the established pattern elsewhere in this codebase.
    void (async () => {
      try {
        const res = await fetch(`/api/training-goals?capacity=${weeklyCapacity}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load your training plan");
        setGoals(data.goals ?? []);
        setBenchmarkOptions(data.benchmarkOptions ?? []);
        if (data.benchmarkOptions?.length) setCardioSport(data.benchmarkOptions[0].value);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your training plan");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount; capacity changes are handled by handleCapacityChange below
  }, []);

  async function handleCapacityChange(next: number) {
    setWeeklyCapacity(next);
    await loadPlan(next);
  }

  async function addGoal() {
    setSubmitting(true);
    setError(null);
    try {
      const payload =
        goalType === "cardio"
          ? { goalType, targetKey: cardioSport, targetValue: Number(minutes) * 60 + Number(seconds) }
          : { goalType, targetKey: exerciseName, targetValue: Number(targetKg) };

      const res = await fetch("/api/training-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save this goal");
      setShowForm(false);
      setTargetKg("");
      await loadPlan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this goal");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeGoal(id: string) {
    setGoals((prev) => prev?.filter((g) => g.id !== id) ?? null);
    await fetch(`/api/training-goals?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void loadPlan();
  }

  const canSubmit =
    goalType === "cardio"
      ? cardioSport !== "" && Number(minutes) * 60 + Number(seconds) > 0
      : exerciseName !== "" && Number(targetKg) > 0;

  return (
    <Card glow="accent">
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-accent" />
            <CardTitle>Training Plan</CardTitle>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Add goal
          </button>
        </div>
        <p className="text-xs text-muted">
          Set a target for any cardio sport or gym lift — the plan below prioritizes whichever
          you&apos;re furthest from, while keeping every other goal in the mix.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="space-y-3 rounded-xl border border-accent/25 bg-accent/[0.04] p-3.5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGoalType("cardio")}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold",
                  goalType === "cardio"
                    ? "border-cardio-accent/50 bg-cardio-accent/15 text-cardio-accent"
                    : "border-white/10 text-muted"
                )}
              >
                Cardio
              </button>
              <button
                type="button"
                onClick={() => setGoalType("gym")}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold",
                  goalType === "gym"
                    ? "border-gym-accent/50 bg-gym-accent/15 text-gym-accent"
                    : "border-white/10 text-muted"
                )}
              >
                Gym
              </button>
            </div>

            {goalType === "cardio" ? (
              <>
                <Select
                  label="Sport"
                  options={benchmarkOptions}
                  value={cardioSport}
                  onChange={(e) => setCardioSport(e.target.value)}
                />
                <div className="flex gap-2">
                  <Input
                    label="Target minutes"
                    type="number"
                    min={0}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                  <Input
                    label="Seconds"
                    type="number"
                    min={0}
                    max={59}
                    value={seconds}
                    onChange={(e) => setSeconds(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <Select
                  label="Exercise"
                  options={GYM_EXERCISE_OPTIONS}
                  value={exerciseName}
                  onChange={(e) => setExerciseName(e.target.value)}
                />
                <Input
                  label="Target weight (kg)"
                  type="number"
                  min={0}
                  value={targetKg}
                  onChange={(e) => setTargetKg(e.target.value)}
                />
              </>
            )}

            <Button size="sm" className="w-full" loading={submitting} disabled={!canSubmit} onClick={addGoal}>
              Save goal
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        {goals === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : goals.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No goals yet — add a cardio time or a lift target to get your first plan.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Sessions per week</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCapacityChange(Math.max(1, weeklyCapacity - 1))}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
                >
                  −
                </button>
                <span className="w-5 text-center tabular-nums text-foreground">{weeklyCapacity}</span>
                <button
                  type="button"
                  onClick={() => handleCapacityChange(Math.min(21, weeklyCapacity + 1))}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 hover:bg-white/10"
                >
                  +
                </button>
              </div>
            </div>

            <ul className="space-y-2">
              {goals.map((goal, i) => (
                <motion.li
                  key={goal.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
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
                        {formatValue(goal, goal.currentValue)} → {formatValue(goal, goal.targetValue)}
                        {!goal.achieved && ` · ${Math.round(goal.gapFraction * 100)}% to go`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!goal.achieved && goal.weeklySessions > 0 && (
                        <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
                          {goal.weeklySessions}x this week
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${goal.label} goal`}
                        onClick={() => removeGoal(goal.id)}
                        className="text-muted/60 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
                </motion.li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
