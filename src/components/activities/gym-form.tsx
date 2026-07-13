"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
  ChevronDown,
  Copy,
  Dumbbell,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  COMMON_EXERCISES,
  MUSCLE_GROUP_CATEGORIES,
  MUSCLE_GROUPS,
  type MuscleGroupCategory,
} from "@/lib/constants/sports";
import { formatRelativeStrength } from "@/lib/utils/scoring-display";
import { cn } from "@/lib/utils/cn";
import { scoreStrength } from "@/lib/scoring/split-strength-engine";
import {
  defaultWeightEntryMode,
  resolveScoringWeight,
  weightEntryLabel,
  type WeightEntryMode,
} from "@/lib/scoring/weight-entry";
import { DerivedChip, Field, FieldError, GlassInput, MicroLabel, UnitInput } from "./fields";
import {
  bestSetRow,
  createExerciseRow,
  createSetRow,
  epley1RM,
  parseNum,
  totalVolumeFromSets,
  type ExerciseRowState,
  type FormErrors,
  type SetRowState,
  type WorkoutFormState,
} from "./form-state";
import type { UpdateField } from "./sport-form";

export function GymExercises({
  state,
  errors,
  onUpdate,
  embedded = false,
}: {
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
  /** When true, skip outer section wrapper (inside ExpandableSection) */
  embedded?: boolean;
}) {
  const rows = state.exercises;
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroupCategory>("all");
  const bodyweight = parseNum(state.bodyweight);

  const updateRow = (id: string, patch: Partial<ExerciseRowState>) => {
    onUpdate(
      "exercises",
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const addRow = () => {
    onUpdate("exercises", [...rows, createExerciseRow(rows[rows.length - 1])]);
  };

  const duplicateRow = (id: string) => {
    const source = rows.find((r) => r.id === id);
    if (!source) return;
    const copy = createExerciseRow(source);
    copy.name = source.name;
    copy.muscleGroup = source.muscleGroup;
    copy.weightEntryMode = source.weightEntryMode;
    copy.sets = source.sets.map((s) => createSetRow(s));
    const idx = rows.findIndex((r) => r.id === id);
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    onUpdate("exercises", next);
  };

  const removeRow = (id: string) => {
    onUpdate(
      "exercises",
      rows.filter((row) => row.id !== id)
    );
  };

  const totalVolume = useMemo(() => {
    const kg = rows.reduce((sum, row) => sum + totalVolumeFromSets(row.sets), 0);
    return kg > 0 ? `${Math.round(kg).toLocaleString()} kg` : null;
  }, [rows]);

  const topRelative = useMemo(() => {
    if (!bodyweight) return null;
    let best: { name: string; ratio: number } | null = null;
    for (const row of rows) {
      const top = bestSetRow(row.sets);
      const oneRm = top ? epley1RM(parseNum(top.weight), parseNum(top.reps)) : null;
      if (!oneRm || !row.name.trim()) continue;
      const ratio = oneRm / bodyweight;
      if (!best || ratio > best.ratio) {
        best = { name: row.name.trim(), ratio };
      }
    }
    return best;
  }, [rows, bodyweight]);

  const inner = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!embedded && <MicroLabel className="text-muted/70">Strength work</MicroLabel>}
        <div className="flex flex-wrap gap-2 ml-auto">
          {topRelative && (
            <DerivedChip
              label="Top lift"
              value={`${topRelative.name} ${formatRelativeStrength(topRelative.ratio, true)}`}
              tone="strength"
            />
          )}
          <DerivedChip label="Volume" value={totalVolume} tone="strength" />
        </div>
      </div>

      <Field
        label="Current bodyweight"
        error={errors.bodyweight}
        hint="Used for relative strength (× bodyweight) scoring"
        className="sm:max-w-[240px]"
      >
        <UnitInput
          value={state.bodyweight}
          unit="kg"
          placeholder="75"
          invalid={!!errors.bodyweight}
          onChange={(e) => onUpdate("bodyweight", e.target.value)}
        />
      </Field>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {rows.map((row, index) => (
            <ExerciseRow
              key={row.id}
              row={row}
              index={index}
              bodyweight={bodyweight}
              muscleFilter={muscleFilter}
              errors={errors}
              canRemove={rows.length > 1}
              onUpdate={(patch) => updateRow(row.id, patch)}
              onDuplicate={() => duplicateRow(row.id)}
              onRemove={() => removeRow(row.id)}
              onFilterChange={setMuscleFilter}
            />
          ))}
        </AnimatePresence>
      </div>

      <FieldError error={errors.exercises} />

      <button
        type="button"
        onClick={addRow}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15",
          "py-3.5 text-sm font-medium text-muted transition-colors duration-200",
          "hover:border-strength/40 hover:bg-strength/5 hover:text-foreground min-h-[48px]"
        )}
      >
        <Plus className="h-4 w-4" />
        Add exercise
        <Dumbbell className="h-4 w-4 opacity-50" />
      </button>
    </>
  );

  if (embedded) return <div className="space-y-5">{inner}</div>;

  return (
    <section className="rounded-2xl border border-gym-border/40 bg-gym-bg-elevated/80 p-5 sm:p-6 space-y-5">
      {inner}
    </section>
  );
}

function ExerciseRow({
  row,
  index,
  bodyweight,
  muscleFilter,
  errors,
  canRemove,
  onUpdate,
  onDuplicate,
  onRemove,
  onFilterChange,
}: {
  row: ExerciseRowState;
  index: number;
  bodyweight: number | null;
  muscleFilter: MuscleGroupCategory;
  errors: FormErrors;
  canRemove: boolean;
  onUpdate: (patch: Partial<ExerciseRowState>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onFilterChange: (c: MuscleGroupCategory) => void;
}) {
  const topSet = bestSetRow(row.sets);
  const weightKgRaw = topSet ? parseNum(topSet.weight) : null;
  // Bodyweight-only sets (pull-ups, dips, push-ups with no added load) leave
  // the weight field blank — that's a valid "0kg added" entry, not a missing
  // one, so it must still score off reps-at-bodyweight rather than silently
  // producing no score.
  const weightKg =
    weightKgRaw ?? (row.weightEntryMode === "added" ? 0 : null);
  const reps = topSet ? parseNum(topSet.reps) : null;
  const resolved =
    weightKg !== null && row.name.trim()
      ? resolveScoringWeight(weightKg, row.name, row.weightEntryMode)
      : null;
  const engineScore =
    resolved && reps && bodyweight
      ? scoreStrength({
          liftKey: row.name,
          history: [],
          latestSet: { weightKg: resolved.scoringWeightKg, reps },
          bodyweightKg: bodyweight,
          sex: "male",
          age: 28,
          isPremium: false,
          isBodyweightRelative: resolved.isBodyweightRelative,
          weightEntryMode: resolved.mode,
        }).score
      : null;
  const oneRm = topSet ? epley1RM(parseNum(topSet.weight), parseNum(topSet.reps)) : null;
  const relativeBw =
    oneRm && bodyweight && bodyweight > 0
      ? Math.round((oneRm / bodyweight) * 100) / 100
      : null;
  const volume = totalVolumeFromSets(row.sets);
  const weightUnit = weightEntryLabel(row.weightEntryMode);

  const updateSet = (setId: string, patch: Partial<SetRowState>) => {
    onUpdate({
      sets: row.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
    });
  };
  const addSet = () => {
    onUpdate({ sets: [...row.sets, createSetRow(row.sets[row.sets.length - 1])] });
  };
  const removeSet = (setId: string) => {
    if (row.sets.length <= 1) return;
    onUpdate({ sets: row.sets.filter((s) => s.id !== setId) });
  };

  const dragX = useMotionValue(0);
  const deleteOpacity = useTransform(dragX, [-120, -60], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80 && canRemove) {
      onRemove();
    }
    dragX.set(0);
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {canRemove && (
        <motion.div
          style={{ opacity: deleteOpacity }}
          className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-danger/90 text-white sm:hidden"
        >
          <Trash2 className="h-5 w-5" />
        </motion.div>
      )}
      <motion.div
        layout
        drag={canRemove ? "x" : false}
        dragConstraints={{ left: -100, right: 0 }}
        dragElastic={0.1}
        style={{ x: dragX }}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.2 }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-4 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(140px,1.4fr)_minmax(100px,1fr)]">
          <Field label={`Exercise ${index + 1}`} error={errors[`ex.${row.id}.name`]} className="mb-0">
            <ExerciseNameInput
              value={row.name}
              muscleFilter={muscleFilter}
              invalid={!!errors[`ex.${row.id}.name`]}
              onFilterChange={onFilterChange}
              onChange={(name) =>
                onUpdate({
                  name,
                  weightEntryMode: name.trim()
                    ? defaultWeightEntryMode(name)
                    : row.weightEntryMode,
                })
              }
              onPick={(name, muscle) =>
                onUpdate({
                  name,
                  muscleGroup: muscle,
                  weightEntryMode: defaultWeightEntryMode(name),
                })
              }
            />
          </Field>
          <Field label="Muscle" error={errors[`ex.${row.id}.muscle`]} className="mb-0">
            <MuscleSelect
              value={row.muscleGroup}
              invalid={!!errors[`ex.${row.id}.muscle`]}
              onChange={(v) => onUpdate({ muscleGroup: v })}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
            Weight entry
          </span>
          {(["total", "per_hand", "added"] as WeightEntryMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onUpdate({ weightEntryMode: mode })}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[36px]",
                row.weightEntryMode === mode
                  ? "bg-gym-accent/15 text-gym-accent border border-gym-accent/30"
                  : "bg-white/[0.03] text-muted border border-white/[0.06] hover:text-foreground"
              )}
            >
              {mode === "total" ? "Total load" : mode === "per_hand" ? "Per hand" : "Added load"}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[28px_1fr_1fr_1fr_40px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted/60">
            <span>Set</span>
            <span>{weightUnit}</span>
            <span>Reps</span>
            <span>RPE</span>
            <span />
          </div>
          {row.sets.map((set, setIndex) => (
            <div
              key={set.id}
              className="grid grid-cols-[20px_1.6fr_0.7fr_0.7fr_auto] sm:grid-cols-[28px_1fr_1fr_1fr_40px] gap-2 items-center"
            >
              <span className="text-xs text-muted/70 text-center tabular-nums">{setIndex + 1}</span>
              <UnitInput
                aria-label={`Set ${setIndex + 1} weight`}
                value={set.weight}
                unit={weightUnit}
                placeholder={row.weightEntryMode === "added" ? "0 = bodyweight" : "60"}
                invalid={!!errors[`ex.${row.id}.set.${set.id}.weight`]}
                onChange={(e) => updateSet(set.id, { weight: e.target.value })}
                className="h-11 sm:h-10"
              />
              <UnitInput
                aria-label={`Set ${setIndex + 1} reps`}
                value={set.reps}
                placeholder="8"
                invalid={!!errors[`ex.${row.id}.set.${set.id}.reps`]}
                onChange={(e) => updateSet(set.id, { reps: e.target.value })}
                className="h-11 px-2 sm:h-10 sm:px-4"
              />
              <UnitInput
                aria-label={`Set ${setIndex + 1} RPE`}
                value={set.rpe}
                placeholder="8"
                invalid={!!errors[`ex.${row.id}.set.${set.id}.rpe`]}
                onChange={(e) => updateSet(set.id, { rpe: e.target.value })}
                className="h-11 px-2 sm:h-10 sm:px-4"
              />
              <button
                type="button"
                aria-label={`Remove set ${setIndex + 1}`}
                onClick={() => removeSet(set.id)}
                disabled={row.sets.length <= 1}
                className="rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger disabled:opacity-30 disabled:pointer-events-none min-h-[44px] min-w-[36px] flex items-center justify-center"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <FieldError error={errors[`ex.${row.id}.sets`]} />
          <button
            type="button"
            onClick={addSet}
            className="flex items-center gap-1.5 text-xs font-medium text-gym-accent hover:text-gym-accent/80 min-h-[36px]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add set
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <DerivedChip label="Est. 1RM" value={oneRm ? `${oneRm} kg` : null} tone="strength" />
            <DerivedChip
              label="× BW"
              value={relativeBw ? formatRelativeStrength(relativeBw, true) : null}
              tone="strength"
            />
            <DerivedChip label="Volume" value={volume > 0 ? `${Math.round(volume)} kg` : null} tone="strength" />
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums",
                engineScore ? "text-gym-accent bg-gym-accent/10" : "text-gym-muted/50"
              )}
            >
              {engineScore ?? "—"}
            </span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Duplicate exercise"
              onClick={onDuplicate}
              className="rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-white/5 hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Copy className="h-4 w-4" />
            </button>
            {canRemove && (
              <button
                type="button"
                aria-label="Remove exercise"
                onClick={onRemove}
                className="rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger min-h-[44px] min-w-[44px] items-center justify-center hidden sm:flex"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <Field label="Notes (optional)">
          <GlassInput
            value={row.notes}
            placeholder="Tempo, form cues, etc."
            onChange={(e) => onUpdate({ notes: e.target.value })}
            className="h-11"
          />
        </Field>
      </motion.div>
    </div>
  );
}

function MuscleSelect({
  value,
  invalid,
  onChange,
  compact,
}: {
  value: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        aria-label="Muscle group"
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full appearance-none rounded-xl glass pl-3 pr-9 text-sm text-foreground",
          "border border-white/10 transition-colors duration-200",
          "cursor-pointer focus:border-accent/50 focus:ring-1 focus:ring-accent/30 outline-none",
          invalid && "border-danger/50",
          value === "" && "text-muted/50",
          compact ? "h-10" : "h-11"
        )}
      >
        <option value="" disabled className="bg-slate-900">
          Select muscle…
        </option>
        {MUSCLE_GROUPS.map((group) => (
          <option key={group} value={group} className="bg-slate-900">
            {group}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/60"
        aria-hidden
      />
    </div>
  );
}

function ExerciseNameInput({
  value,
  muscleFilter,
  invalid,
  onChange,
  onPick,
  onFilterChange,
}: {
  value: string;
  muscleFilter: MuscleGroupCategory;
  invalid?: boolean;
  onChange: (value: string) => void;
  onPick: (name: string, muscle: string) => void;
  onFilterChange: (c: MuscleGroupCategory) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return COMMON_EXERCISES.filter((ex) => {
      const matchesQuery =
        query === "" ||
        ex.name.toLowerCase().includes(query) ||
        ex.muscle.toLowerCase().includes(query);
      const matchesFilter =
        muscleFilter === "all" || ex.category === muscleFilter;
      return matchesQuery && matchesFilter;
    });
  }, [search, muscleFilter]);

  const knownExercise = COMMON_EXERCISES.find(
    (ex) => ex.name.toLowerCase() === value.trim().toLowerCase()
  );

  if (customMode || (value && !knownExercise)) {
    return (
      <div className="space-y-2">
        <GlassInput
          value={value}
          placeholder="Type custom exercise…"
          aria-label="Custom exercise name"
          autoComplete="off"
          invalid={invalid}
          className="h-11 sm:h-10"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setCustomMode(false);
            setSearch("");
          }}
          className="text-xs text-gym-accent hover:text-gym-accent/80"
        >
          ← Pick from list
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="flex gap-1 overflow-x-auto pb-1"
        role="group"
        aria-label="Filter by muscle group"
      >
        {MUSCLE_GROUP_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            aria-pressed={muscleFilter === cat.id}
            onClick={() => onFilterChange(cat.id)}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors duration-200 min-h-[32px]",
              muscleFilter === cat.id
                ? "bg-gym-accent/20 text-gym-accent"
                : "text-gym-muted hover:text-gym-text border border-gym-border/40"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gym-muted/60" />
        <GlassInput
          value={search}
          placeholder="Filter exercises…"
          aria-label="Filter exercises"
          autoComplete="off"
          className="pl-9 h-10 mb-2"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="relative">
        <select
          value={knownExercise?.name ?? ""}
          aria-label="Select exercise"
          onChange={(e) => {
            const selected = e.target.value;
            if (selected === "__custom__") {
              setCustomMode(true);
              onChange("");
              return;
            }
            const ex = COMMON_EXERCISES.find((item) => item.name === selected);
            if (ex) onPick(ex.name, ex.muscle);
          }}
          className={cn(
            "w-full appearance-none rounded-xl border border-gym-border/50 bg-gym-bg-elevated pl-3 pr-9 py-3 text-sm text-gym-text",
            "cursor-pointer focus:border-gym-accent/60 focus:ring-1 focus:ring-gym-accent/30 outline-none min-h-[48px]",
            invalid && "border-danger/50"
          )}
        >
          <option value="" disabled className="bg-[#0c0f0c]">
            Select exercise…
          </option>
          {matches.map((ex) => (
            <option key={ex.name} value={ex.name} className="bg-[#0c0f0c]">
              {ex.name} — {ex.muscle}
            </option>
          ))}
          <option value="__custom__" className="bg-[#0c0f0c]">
            + Custom exercise…
          </option>
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gym-muted/60"
          aria-hidden
        />
      </div>

      {value && (
        <p className="text-xs text-gym-muted">
          Selected: <span className="text-gym-accent font-medium">{value}</span>
        </p>
      )}
    </div>
  );
}
