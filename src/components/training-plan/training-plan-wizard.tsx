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
  Moon,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COMMON_EXERCISES } from "@/lib/constants/sports";
import { MAX_PREMIUM_WEEKLY_CAPACITY } from "@/lib/premium/features";
import {
  buildWeeklySchedule,
  estimateSessionCount,
  DEFAULT_SESSION_HOURS,
  WEEKDAY_LABELS,
  type DaySchedule,
  type RankedGoal as CoreRankedGoal,
} from "@/lib/scoring/training-plan";
import { cn } from "@/lib/utils/cn";

interface BenchmarkOption {
  value: string;
  label: string;
  distanceMeters: number;
  currentSeconds: number | null;
}

/** The API also serializes targetDate/daysUntilTarget/feasibility (Stage 2) alongside the core RankedGoal shape — see /api/training-goals's toInput(). */
type RankedGoal = CoreRankedGoal & { targetDate: string | null };

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

function formatDistanceLabel(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)}K`;
  }
  return `${meters}m`;
}

const POPULAR_GYM_LIFTS = ["Squat", "Bench Press", "Deadlift", "Overhead Press"];
// "Any other activities" examples per user feedback — surfaced first,
// unfiltered, so there's always something obvious to tap.
const OTHER_CARDIO_SPORTS = ["swim", "cycle", "row", "ski", "walk"];

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

type Phase = "running" | "gym" | "more" | "targets" | "capacity" | null;

/**
 * Goal-driven hybrid training plan wizard. Walks major activities one at a
 * time — Running gets its own full screen, Gym gets its own full screen,
 * each with an explicit Skip (user feedback: "go through each major
 * activity and ask for a goal instead of the current approach... have a
 * button which says skip because the user doesn't want a goal in this
 * activity") — then a single "anything else?" screen covering every other
 * sport plus additional gym lifts, with examples (swim, cycling, walking,
 * rowing, skiing, more gym exercises) per feedback, also skippable.
 *
 * Finishes by asking real weekly training capacity in HOURS — either one
 * flat number or a per-day breakdown (user feedback: "ask how many hours
 * they can do each week, or per day") — and lays the resulting sessions
 * out onto an actual Monday-Sunday schedule (buildWeeklySchedule), not
 * just a bare "Nx this week" count per goal.
 */
export function TrainingPlanWizard() {
  const reducedMotion = useReducedMotion();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>(null);
  const [addOnly, setAddOnly] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [targetsReturnPhase, setTargetsReturnPhase] = useState<Phase>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickItem[]>([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState("");
  const [targetSeconds, setTargetSeconds] = useState("");
  const [targetKg, setTargetKg] = useState("");
  // Optional deadline (Stage 2) — same field reused across the running
  // screen and the shared target-value queue below.
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Running screen's own inline target inputs (single goal, no queue needed).
  const [runMinutes, setRunMinutes] = useState("");
  const [runSeconds, setRunSeconds] = useState("");
  const [runTargetDate, setRunTargetDate] = useState("");

  // Weekly capacity, in hours.
  const [capacityMode, setCapacityMode] = useState<"total" | "perDay">("total");
  const [totalHoursInput, setTotalHoursInput] = useState("5");
  const [perDayInputs, setPerDayInputs] = useState<string[]>(["1", "1", "1", "0", "1", "1", "0"]);
  const [perDayHours, setPerDayHours] = useState<number[] | null>(null);

  async function load(capacity?: number) {
    try {
      const url = capacity ? `/api/training-goals?capacity=${capacity}` : "/api/training-goals";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load your training plan");
      setPlan(data as PlanResponse);
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
      // their plan (established pattern elsewhere in this app: don't
      // re-ask what's already answered).
      if (data && data.totalGoalCount === 0) {
        setPhase("running");
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

  const runOption = cardioOptions.find((c) => c.sport === "run") ?? null;

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    const cardioMatches = cardioOptions.filter(
      (c) => c.sport !== "run" && c.label.toLowerCase().includes(q) && !existingKeys.has(itemKey(c))
    );
    const gymMatches = COMMON_EXERCISES.filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((e): PickItem => ({ kind: "gym", exerciseName: e.name }))
      .filter((item) => !existingKeys.has(itemKey(item)));
    return [...cardioMatches, ...gymMatches];
  }, [query, cardioOptions, existingKeys]);

  const popularOtherItems: PickItem[] = useMemo(() => {
    const cardio = OTHER_CARDIO_SPORTS.map((sport) => cardioOptions.find((c) => c.sport === sport)).filter(
      (c): c is Extract<PickItem, { kind: "cardio" }> => !!c
    );
    const gym: PickItem[] = POPULAR_GYM_LIFTS.map((name) => ({ kind: "gym", exerciseName: name }));
    return [...cardio, ...gym].filter((item) => !existingKeys.has(itemKey(item)));
  }, [cardioOptions, existingKeys]);

  const popularGymItems: PickItem[] = useMemo(
    () =>
      POPULAR_GYM_LIFTS.map((name): PickItem => ({ kind: "gym", exerciseName: name })).filter(
        (item) => !existingKeys.has(itemKey(item))
      ),
    [existingKeys]
  );

  const gymSearchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return COMMON_EXERCISES.filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((e): PickItem => ({ kind: "gym", exerciseName: e.name }))
      .filter((item) => !existingKeys.has(itemKey(item)));
  }, [query, existingKeys]);

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
    setEditMode(false);
    setPhase("more");
  }

  /**
   * Editing an already-saved goal — the picker screens deliberately
   * exclude goals that already exist (no point re-offering something
   * you've already added), which meant there was previously no way to
   * correct a target value or deadline short of deleting and re-adding
   * the whole goal. Jumps straight to the same target-entry screen used
   * everywhere else, pre-filled with the goal's own current saved value
   * (not the "current predicted" hint that screen normally shows) so
   * "Continue" here genuinely means "update," not "start over."
   */
  function startEditGoal(goal: RankedGoal) {
    const item: PickItem =
      goal.goalType === "cardio"
        ? {
            kind: "cardio",
            sport: goal.targetKey,
            label: goal.label,
            distanceMeters: cardioOptions.find((c) => c.sport === goal.targetKey)?.distanceMeters ?? 0,
            currentSeconds: cardioOptions.find((c) => c.sport === goal.targetKey)?.currentSeconds ?? null,
          }
        : { kind: "gym", exerciseName: goal.targetKey };

    setSelected([item]);
    setTargetIndex(0);
    setTargetsReturnPhase(null);
    setAddOnly(true);
    setEditMode(true);
    setActionError(null);
    if (goal.goalType === "cardio") {
      setTargetMinutes(String(Math.floor(goal.targetValue / 60)));
      setTargetSeconds(String(Math.round(goal.targetValue % 60)));
    } else {
      setTargetKg(String(goal.targetValue));
    }
    setTargetDate(goal.targetDate ?? "");
    setPhase("targets");
  }

  function startEditCapacity() {
    setPhase("capacity");
  }

  // ---------- Running screen ----------
  async function handleRunningContinue() {
    const seconds = Number(runMinutes || 0) * 60 + Number(runSeconds || 0);
    if (seconds <= 0) {
      setActionError("Enter a target time");
      return;
    }
    setActionError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/training-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalType: "cardio",
          targetKey: "run",
          targetValue: seconds,
          targetDate: runTargetDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save this goal");
      await load();
      setPhase("gym");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save this goal");
    } finally {
      setSaving(false);
    }
  }

  function handleRunningSkip() {
    setActionError(null);
    setPhase("gym");
  }

  // ---------- Gym screen ----------
  function handleGymContinue() {
    if (selected.length === 0) return;
    setTargetsReturnPhase("more");
    setTargetIndex(0);
    primeTargetInputs(selected[0]);
    setPhase("targets");
  }

  function handleGymSkip() {
    setSelected([]);
    setQuery("");
    setPhase("more");
  }

  // ---------- "Anything else?" screen ----------
  function handleMoreContinue() {
    if (selected.length === 0) return;
    setTargetsReturnPhase(addOnly ? null : "capacity");
    setTargetIndex(0);
    primeTargetInputs(selected[0]);
    setPhase("targets");
  }

  function handleMoreSkip() {
    setSelected([]);
    setQuery("");
    if (addOnly) {
      setAddOnly(false);
      setEditMode(false);
      setPhase(null);
    } else {
      setPhase("capacity");
    }
  }

  function primeTargetInputs(item: PickItem) {
    setTargetDate("");
    if (item.kind === "cardio") {
      const seconds = item.currentSeconds;
      setTargetMinutes(seconds ? String(Math.floor(seconds / 60)) : "");
      setTargetSeconds(seconds ? String(Math.round(seconds % 60)) : "");
    } else {
      setTargetKg("");
    }
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
            targetDate: targetDate || undefined,
          }
        : { goalType: "gym", targetKey: item.exerciseName, targetValue: Number(targetKg), targetDate: targetDate || undefined };

    if (payload.targetValue <= 0) {
      setActionError(item.kind === "cardio" ? "Enter a target time" : "Enter a target weight");
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
        await load();
        setSelected([]);
        setQuery("");
        setPhase(targetsReturnPhase);
        if (targetsReturnPhase === null) {
          setAddOnly(false);
          setEditMode(false);
        }
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save this goal");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Capacity screen ----------
  async function handleCapacityContinue() {
    if (!plan) return;
    setActionError(null);

    let totalHours: number;
    let nextPerDayHours: number[] | null = null;

    if (capacityMode === "total") {
      totalHours = Number(totalHoursInput);
    } else {
      const values = perDayInputs.map((v) => Math.max(0, Number(v) || 0));
      totalHours = values.reduce((sum, v) => sum + v, 0);
      nextPerDayHours = values;
    }

    if (!Number.isFinite(totalHours) || totalHours <= 0) {
      setActionError("Enter how many hours you can train");
      return;
    }

    const estimated = estimateSessionCount(plan.goals, totalHours);
    const clamped = Math.max(1, Math.min(plan.maxWeeklyCapacity, estimated || 1));

    setSaving(true);
    try {
      await load(clamped);
      setPerDayHours(nextPerDayHours);
      setPhase(null);
    } finally {
      setSaving(false);
    }
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
    void load(plan?.weeklyCapacity);
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

  const showProgressStrip = phase !== null && !addOnly;
  const stepIndex = phase === "running" ? 0 : phase === "gym" ? 1 : phase === "more" ? 2 : phase === "targets" ? 2 : 3;
  const stepTitle =
    phase === "running"
      ? "Running"
      : phase === "gym"
        ? "Gym"
        : phase === "more"
          ? "Any other goals?"
          : phase === "targets"
            ? currentTargetItem
              ? itemLabel(currentTargetItem)
              : "Set your target"
            : phase === "capacity"
              ? "How much time do you have?"
              : "";

  return (
    <div className="mx-auto max-w-lg">
      {showProgressStrip && (
        <div className="mb-8">
          <div className="mb-4 flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= stepIndex ? "bg-accent shadow-[0_0_8px_var(--accent-glow)]" : "bg-white/[0.08]"
                )}
              />
            ))}
          </div>
          <p className="mb-1.5 micro-label text-muted">Training Plan</p>
          <h1 className="headline-tight text-2xl font-semibold md:text-3xl">{stepTitle}</h1>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "running" && (
          <motion.div
            key="running"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Card className="space-y-4">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-cardio-accent" />
                <p className="text-sm text-muted">
                  Distance: <span className="font-semibold text-foreground">5K</span> — what time do
                  you want to hit?
                  {runOption?.currentSeconds && (
                    <> Your current predicted time is {formatDuration(runOption.currentSeconds)}.</>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  label="Target minutes"
                  type="number"
                  min={0}
                  value={runMinutes}
                  onChange={(e) => setRunMinutes(e.target.value)}
                />
                <Input
                  label="Seconds"
                  type="number"
                  min={0}
                  max={59}
                  value={runSeconds}
                  onChange={(e) => setRunSeconds(e.target.value)}
                />
              </div>
              <Input
                label="By when? (optional)"
                type="date"
                value={runTargetDate}
                onChange={(e) => setRunTargetDate(e.target.value)}
                hint="Gives you a real taper into your target date instead of a flat weekly plan."
                min={new Date().toISOString().slice(0, 10)}
              />
              {actionError && <p className="text-sm text-danger">{actionError}</p>}
            </Card>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" onClick={handleRunningSkip} disabled={saving}>
                Skip
              </Button>
              <Button className="flex-1" loading={saving} onClick={handleRunningContinue}>
                Continue
              </Button>
            </div>
          </motion.div>
        )}

        {phase === "gym" && (
          <motion.div
            key="gym"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Card className="space-y-4">
              <p className="text-sm text-muted">
                Pick any lift you want to hit a number on — tap as many as you like.
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search any lift…"
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
                      className="flex items-center gap-1.5 rounded-full bg-gym-accent/15 px-3 py-1.5 text-xs font-medium text-gym-accent"
                    >
                      {itemLabel(item)}
                      <span className="opacity-60">×</span>
                    </button>
                  ))}
                </div>
              )}
              <ItemGrid
                items={query.trim() === "" ? popularGymItems : gymSearchResults}
                heading={query.trim() === "" ? "Popular lifts" : undefined}
                emptyLabel="No matches — try a different search."
                selected={selected}
                onToggle={toggleItem}
              />
            </Card>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" onClick={handleGymSkip} disabled={saving}>
                Skip
              </Button>
              <Button className="flex-1" disabled={selected.length === 0} onClick={handleGymContinue}>
                Continue{selected.length > 0 ? ` (${selected.length})` : ""}
              </Button>
            </div>
          </motion.div>
        )}

        {phase === "more" && (
          <motion.div
            key="more"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {addOnly && (
              <div className="mb-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAddOnly(false);
                    setPhase(null);
                  }}
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
                Any other sport or lift you want to work toward — swimming, cycling, walking,
                rowing, skiing, another gym exercise, anything.
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
                      <span className="opacity-60">×</span>
                    </button>
                  ))}
                </div>
              )}
              <ItemGrid
                items={query.trim() === "" ? popularOtherItems : searchResults}
                heading={query.trim() === "" ? "Examples" : undefined}
                emptyLabel="No matches — try a different search."
                selected={selected}
                onToggle={toggleItem}
              />
            </Card>
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" onClick={handleMoreSkip} disabled={saving}>
                {addOnly ? "Cancel" : "Skip"}
              </Button>
              <Button className="flex-1" disabled={selected.length === 0} onClick={handleMoreContinue}>
                Continue{selected.length > 0 ? ` (${selected.length})` : ""}
              </Button>
            </div>
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
            {editMode && (
              <div className="mb-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAddOnly(false);
                    setEditMode(false);
                    setSelected([]);
                    setPhase(null);
                  }}
                  aria-label="Cancel edit"
                  className="flex h-9 w-9 items-center justify-center rounded-full glass hover:bg-white/5"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h1 className="headline-tight text-xl font-semibold">Edit {itemLabel(currentTargetItem)}</h1>
              </div>
            )}
            <Card className="space-y-4">
              {!editMode && (
                <p className="text-sm text-muted">
                  Goal {targetIndex + 1} of {selected.length}
                  {currentTargetItem.kind === "cardio" && (
                    <>
                      {" "}
                      — distance {formatDistanceLabel(currentTargetItem.distanceMeters)}
                      {currentTargetItem.currentSeconds !== null && (
                        <>, current predicted time {formatDuration(currentTargetItem.currentSeconds)}</>
                      )}
                    </>
                  )}
                </p>
              )}
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
              <Input
                label="By when? (optional)"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                hint="Gives you a real taper into your target date instead of a flat weekly plan."
                min={new Date().toISOString().slice(0, 10)}
              />
              {actionError && <p className="text-sm text-danger">{actionError}</p>}
            </Card>
            <div className="mt-6 flex gap-3">
              {editMode && (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setAddOnly(false);
                    setEditMode(false);
                    setSelected([]);
                    setPhase(null);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button className="flex-1" loading={saving} onClick={saveCurrentTarget}>
                {editMode ? "Save changes" : targetIndex + 1 < selected.length ? "Next goal" : "Continue"}
              </Button>
            </div>
          </motion.div>
        )}

        {phase === "capacity" && (
          <motion.div
            key="capacity"
            initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Card className="space-y-4">
              <p className="text-sm text-muted">
                How much time can you actually train each week? We&apos;ll build a real Monday-
                Sunday schedule around it.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCapacityMode("total")}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold",
                    capacityMode === "total" ? "border-accent/50 bg-accent/15 text-accent" : "border-white/10 text-muted"
                  )}
                >
                  Same every week
                </button>
                <button
                  type="button"
                  onClick={() => setCapacityMode("perDay")}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold",
                    capacityMode === "perDay" ? "border-accent/50 bg-accent/15 text-accent" : "border-white/10 text-muted"
                  )}
                >
                  Set each day
                </button>
              </div>

              {capacityMode === "total" ? (
                <Input
                  label="Hours per week"
                  type="number"
                  min={0}
                  step={0.5}
                  value={totalHoursInput}
                  onChange={(e) => setTotalHoursInput(e.target.value)}
                />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <Input
                      key={label}
                      label={label}
                      type="number"
                      min={0}
                      step={0.5}
                      value={perDayInputs[i]}
                      onChange={(e) =>
                        setPerDayInputs((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                      }
                    />
                  ))}
                </div>
              )}

              {!plan.premium && (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <Lock className="h-3 w-3" />
                  Free accounts are capped around {(plan.maxWeeklyCapacity * DEFAULT_SESSION_HOURS.cardio).toFixed(1)}
                  h/week —{" "}
                  <Link href="/settings/billing" className="underline">
                    Premium
                  </Link>{" "}
                  goes up to ~{(MAX_PREMIUM_WEEKLY_CAPACITY * DEFAULT_SESSION_HOURS.cardio).toFixed(0)}h.
                </p>
              )}
              {actionError && <p className="text-sm text-danger">{actionError}</p>}
            </Card>
            <Button className="mt-6 w-full" loading={saving} onClick={handleCapacityContinue}>
              Build my plan
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
              perDayHours={perDayHours}
              onAddGoal={startAddGoal}
              onRemoveGoal={removeGoal}
              onEditGoal={startEditGoal}
              onEditCapacity={startEditCapacity}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ItemGrid({
  items,
  heading,
  emptyLabel,
  selected,
  onToggle,
}: {
  items: PickItem[];
  heading?: string;
  emptyLabel: string;
  selected: PickItem[];
  onToggle: (item: PickItem) => void;
}) {
  return (
    <div>
      {heading && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted/70">{heading}</p>}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const isSelected = selected.some((s) => itemKey(s) === itemKey(item));
            return (
              <button
                key={itemKey(item)}
                type="button"
                onClick={() => onToggle(item)}
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
          })}
        </div>
      )}
    </div>
  );
}

function GoalRow({
  goal,
  onRemove,
  onEdit,
}: {
  goal: RankedGoal;
  onRemove?: (id: string) => void;
  onEdit?: (goal: RankedGoal) => void;
}) {
  // A deadline that's come and gone: rather than silently hide the date
  // (the old daysUntilTarget >= 0 check did this) or keep tapering forever,
  // surface it plainly so it's obvious the goal needs a fresh date or a
  // fresh target, not a mystery why the plan quietly changed.
  const deadlinePassed = goal.daysUntilTarget != null && goal.daysUntilTarget < 0;

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
            {goal.daysUntilTarget != null && goal.daysUntilTarget >= 0 && (
              <> · by {new Date(goal.targetDate ?? "").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
            )}
          </p>
          {deadlinePassed && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Target date passed — edit to set a new one.
            </p>
          )}
          {!deadlinePassed && !goal.feasibility.feasible && goal.feasibility.message && (
            <p className="mt-1 text-[11px] text-warning">{goal.feasibility.message}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!goal.achieved && goal.weeklySessions > 0 && (
            <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
              {goal.weeklySessions}x this week
            </span>
          )}
          {onEdit && (
            <button
              type="button"
              aria-label={`Edit ${goal.label} goal`}
              onClick={() => onEdit(goal)}
              className="text-muted/60 hover:text-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
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

function ScheduleDayCard({ day }: { day: DaySchedule }) {
  const totalHours = day.sessions.reduce((sum, s) => sum + s.durationHours, 0);
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{day.dayLabel}</p>
        {day.capacityHours !== null && (
          <p className="text-[11px] tabular-nums text-muted/70">
            {totalHours.toFixed(totalHours % 1 === 0 ? 0 : 1)}h / {day.capacityHours}h
          </p>
        )}
      </div>
      {day.sessions.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted/60">
          <Moon className="h-3 w-3" />
          Rest day
        </p>
      ) : (
        <ul className="space-y-2">
          {day.sessions.map((s, i) => (
            <li
              key={`${s.goalId}-${i}`}
              className={cn(
                "rounded-lg px-2.5 py-2",
                s.goalType === "gym" ? "bg-gym-accent/10" : "bg-cardio-accent/10"
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 text-xs font-semibold",
                  s.goalType === "gym" ? "text-gym-accent" : "text-cardio-accent"
                )}
              >
                {s.goalType === "gym" ? (
                  <Dumbbell className="h-3 w-3 shrink-0" />
                ) : (
                  <Activity className="h-3 w-3 shrink-0" />
                )}
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="ml-auto shrink-0 tabular-nums font-normal opacity-70">{s.durationHours}h</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted">{s.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanView({
  plan,
  perDayHours,
  onAddGoal,
  onRemoveGoal,
  onEditGoal,
  onEditCapacity,
}: {
  plan: PlanResponse;
  perDayHours: number[] | null;
  onAddGoal: () => void;
  onRemoveGoal: (id: string) => void;
  onEditGoal: (goal: RankedGoal) => void;
  onEditCapacity: () => void;
}) {
  const schedule = useMemo(
    () => buildWeeklySchedule(plan.goals, perDayHours ?? undefined),
    [plan.goals, perDayHours]
  );

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

      {plan.goals.length === 0 && plan.lockedGoals.length === 0 ? (
        <Card>
          <p className="py-4 text-center text-sm text-muted">
            No goals yet — add a cardio time or a lift target to get your first plan.
          </p>
        </Card>
      ) : (
        <>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="micro-label text-muted/70">This week</p>
              <button type="button" onClick={onEditCapacity} className="text-xs font-medium text-accent hover:underline">
                Edit weekly hours
              </button>
            </div>
            <div className="space-y-2">
              {schedule.map((day) => (
                <ScheduleDayCard key={day.day} day={day} />
              ))}
            </div>
          </Card>

          <Card className="space-y-3">
            <p className="micro-label text-muted/70">Goals</p>
            <ul className="space-y-2">
              {plan.goals.map((goal) => (
                <GoalRow key={goal.id} goal={goal} onRemove={onRemoveGoal} onEdit={onEditGoal} />
              ))}
            </ul>
          </Card>
        </>
      )}

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
              prioritize across all of them together, with more weekly hours to work with.
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
