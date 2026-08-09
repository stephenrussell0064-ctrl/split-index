"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Target, CalendarDays, Trophy, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { formatIndex } from "@/lib/utils/format";

/** Local shape for the `goals` table (types file is owned by another workstream) */
export interface DashboardGoal {
  id: string;
  title: string;
  target_split_index: number | null;
  deadline: string | null;
  completed: boolean;
}

interface GoalsCardProps {
  goals: DashboardGoal[];
  currentIndex: number;
  className?: string;
}

function daysRemaining(deadline: string): number {
  const end = new Date(`${deadline}T23:59:59`);
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

/** Fields shared by the edit form and the "add a goal" form — kept as one
 * component so amending a goal and creating one feel identical (user
 * feedback: "Allow the user to amend their goals on the dashboard by
 * clicking into the goals section"). */
function GoalFields({
  title,
  setTitle,
  target,
  setTarget,
  deadline,
  setDeadline,
}: {
  title: string;
  setTitle: (v: string) => void;
  target: string;
  setDeadline: (v: string) => void;
  setTarget: (v: string) => void;
  deadline: string;
}) {
  return (
    <div className="space-y-2.5">
      <Input
        label="Goal"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Break a 700 Split Index"
        maxLength={120}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Input
          label="Target index"
          type="number"
          inputMode="numeric"
          min={350}
          max={999}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. 700"
        />
        <Input
          label="Deadline"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>
    </div>
  );
}

function GoalEditForm({
  goal,
  onDone,
}: {
  goal: DashboardGoal;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(goal.title);
  const [target, setTarget] = useState(
    goal.target_split_index != null ? String(goal.target_split_index) : ""
  );
  const [deadline, setDeadline] = useState(goal.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: goal.id,
          title,
          targetSplitIndex: target === "" ? null : Number(target),
          deadline: deadline === "" ? null : deadline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save goal");
      router.refresh();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save goal");
      setSaving(false);
    }
  }

  async function toggleCompleted() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goal.id, completed: !goal.completed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update goal");
      router.refresh();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update goal");
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals?id=${encodeURIComponent(goal.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not delete goal");
      router.refresh();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete goal");
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-3.5">
      <GoalFields
        title={title}
        setTitle={setTitle}
        target={target}
        setTarget={setTarget}
        deadline={deadline}
        setDeadline={setDeadline}
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="flex items-center gap-1 text-xs text-danger/80 hover:text-danger disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleCompleted}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            {goal.completed ? "Mark incomplete" : "Mark complete"}
          </button>
          <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" loading={saving} disabled={deleting} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddGoalForm({ currentIndex, onDone }: { currentIndex: number; onDone: () => void }) {
  const router = useRouter();
  const suggested = Math.min(999, Math.ceil((currentIndex + 25) / 25) * 25);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(String(suggested));
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          targetSplitIndex: Number(target),
          deadline: deadline || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create goal");
      router.refresh();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create goal");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-3.5">
      <GoalFields
        title={title}
        setTitle={setTitle}
        target={target}
        setTarget={setTarget}
        deadline={deadline}
        setDeadline={setDeadline}
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" loading={saving} onClick={create}>
          Add goal
        </Button>
      </div>
    </div>
  );
}

export function GoalsCard({ goals, currentIndex, className }: GoalsCardProps) {
  const reducedMotion = useReducedMotion();
  const active = goals.filter((g) => !g.completed).slice(0, 3);
  const completedCount = goals.filter((g) => g.completed).length;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Upcoming Goals</CardTitle>
          <div className="flex items-center gap-3">
            {completedCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
                <Trophy className="h-3 w-3" />
                {completedCount} done
              </span>
            )}
            {active.length > 0 && !adding && (
              <button
                type="button"
                aria-label="Add a goal"
                onClick={() => {
                  setAdding(true);
                  setEditingId(null);
                }}
                className="flex items-center justify-center rounded-lg p-1 text-muted hover:text-accent"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {active.length === 0 && !adding ? (
          <GoalsEmptyState currentIndex={currentIndex} onAddCustom={() => setAdding(true)} />
        ) : (
          <div className="space-y-3">
            {adding && (
              <AddGoalForm currentIndex={currentIndex} onDone={() => setAdding(false)} />
            )}
            {active.map((goal, i) => {
              if (editingId === goal.id) {
                return (
                  <GoalEditForm key={goal.id} goal={goal} onDone={() => setEditingId(null)} />
                );
              }

              const target = goal.target_split_index;
              const progress = target
                ? Math.max(0, Math.min(100, (currentIndex / target) * 100))
                : null;
              const remaining = goal.deadline ? daysRemaining(goal.deadline) : null;

              return (
                <motion.button
                  type="button"
                  key={goal.id}
                  onClick={() => {
                    setEditingId(goal.id);
                    setAdding(false);
                  }}
                  initial={reducedMotion ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.5 }}
                  className="group w-full rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-left transition-colors hover:border-accent/30 hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug">{goal.title}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {remaining !== null && (
                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                            remaining < 0
                              ? "bg-danger/10 text-danger"
                              : remaining <= 14
                                ? "bg-warning/10 text-warning"
                                : "bg-white/5 text-muted"
                          )}
                        >
                          <CalendarDays className="h-2.5 w-2.5" />
                          {remaining < 0 ? "Overdue" : `${remaining}d left`}
                        </span>
                      )}
                      <Pencil className="h-3 w-3 text-muted/0 transition-colors group-hover:text-muted/60" />
                    </div>
                  </div>

                  {/* A goal can outlive its own target — nothing here auto-marks
                      `completed` in the DB, so without this check an already-
                      surpassed target (e.g. 716 vs a 650 goal) kept reading as
                      "in progress, N days left" instead of reflecting reality
                      (user feedback: irrelevant/stale-looking dashboard data). */}
                  {target !== null && progress !== null && progress >= 100 ? (
                    <div className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-success">
                      <Trophy className="h-3.5 w-3.5 shrink-0" />
                      Achieved — {formatIndex(currentIndex)} vs {formatIndex(target)} target. Set a higher one?
                    </div>
                  ) : (
                    target !== null &&
                    progress !== null && (
                      <div className="mt-2.5">
                        <div className="flex justify-between text-[10px] tabular-nums text-muted">
                          <span>
                            {formatIndex(currentIndex)} / {formatIndex(target)}
                          </span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                          <motion.div
                            initial={reducedMotion ? { width: `${progress}%` } : { width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{
                              duration: 1,
                              ease: [0.22, 1, 0.36, 1],
                              delay: 0.4 + i * 0.1,
                            }}
                            className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
                          />
                        </div>
                      </div>
                    )
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoalsEmptyState({
  currentIndex,
  onAddCustom,
}: {
  currentIndex: number;
  onAddCustom: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // suggest a target one clean step up from the current index
  const suggested = Math.min(999, Math.ceil((currentIndex + 25) / 25) * 25);

  async function setSuggestedGoal() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSplitIndex: suggested }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not set goal");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set goal");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
        <Target className="h-5 w-5 text-accent" />
      </div>
      <div>
        <p className="text-sm font-medium">No goals set yet</p>
        <p className="mx-auto mt-1 max-w-[210px] text-xs leading-relaxed text-muted">
          Athletes with a target index improve ~2× faster. How about{" "}
          <span className="font-semibold tabular-nums text-accent">
            {formatIndex(suggested)}
          </span>{" "}
          by season&apos;s end?
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" loading={saving} onClick={setSuggestedGoal}>
          Set this goal
        </Button>
        <Button size="sm" variant="ghost" onClick={onAddCustom} disabled={saving}>
          Set my own
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
