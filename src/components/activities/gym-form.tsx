"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
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
import { DerivedChip, Field, FieldError, GlassInput, MicroLabel, UnitInput } from "./fields";
import {
  createExerciseRow,
  epley1RM,
  parseNum,
  type ExerciseRowState,
  type FormErrors,
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
    copy.weight = source.weight;
    copy.sets = source.sets;
    copy.reps = source.reps;
    copy.rpe = source.rpe;
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
    const kg = rows.reduce((sum, row) => {
      const weight = parseNum(row.weight) ?? 0;
      const sets = parseNum(row.sets) ?? 0;
      const reps = parseNum(row.reps) ?? 0;
      return sum + weight * sets * reps;
    }, 0);
    return kg > 0 ? `${Math.round(kg).toLocaleString()} kg` : null;
  }, [rows]);

  const topRelative = useMemo(() => {
    if (!bodyweight) return null;
    let best: { name: string; ratio: number } | null = null;
    for (const row of rows) {
      const oneRm = epley1RM(parseNum(row.weight), parseNum(row.reps));
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

      <div className="hidden sm:grid grid-cols-[minmax(140px,1.4fr)_minmax(100px,1fr)_64px_64px_56px_72px_72px_72px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted/60">
        <span>Exercise</span>
        <span>Muscle</span>
        <span>kg</span>
        <span>Sets</span>
        <span>Reps</span>
        <span>RPE</span>
        <span>1RM</span>
        <span>× BW</span>
      </div>

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
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 space-y-5">
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
  const oneRm = epley1RM(parseNum(row.weight), parseNum(row.reps));
  const relativeBw =
    oneRm && bodyweight && bodyweight > 0
      ? Math.round((oneRm / bodyweight) * 100) / 100
      : null;

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
        className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-2 sm:grid sm:grid-cols-[minmax(140px,1.4fr)_minmax(100px,1fr)_64px_64px_56px_72px_72px_72px_auto] sm:gap-2 sm:items-start"
      >
        <div className="space-y-3 sm:contents">
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 sm:col-auto sm:contents">
            <Field label={`Exercise ${index + 1}`} error={errors[`ex.${row.id}.name`]} className="sm:mb-0">
              <ExerciseNameInput
                value={row.name}
                muscleFilter={muscleFilter}
                invalid={!!errors[`ex.${row.id}.name`]}
                onFilterChange={onFilterChange}
                onChange={(name) => onUpdate({ name })}
                onPick={(name, muscle) => onUpdate({ name, muscleGroup: muscle })}
              />
            </Field>
            <Field label="Muscle" error={errors[`ex.${row.id}.muscle`]} className="sm:mb-0 sm:hidden">
              <MuscleSelect
                value={row.muscleGroup}
                invalid={!!errors[`ex.${row.id}.muscle`]}
                onChange={(v) => onUpdate({ muscleGroup: v })}
              />
            </Field>
            <div className="hidden sm:block">
              <MuscleSelect
                value={row.muscleGroup}
                invalid={!!errors[`ex.${row.id}.muscle`]}
                onChange={(v) => onUpdate({ muscleGroup: v })}
                compact
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Field label="Weight" error={errors[`ex.${row.id}.weight`]} className="sm:mb-0">
              <UnitInput
                value={row.weight}
                unit="kg"
                placeholder="60"
                invalid={!!errors[`ex.${row.id}.weight`]}
                onChange={(e) => onUpdate({ weight: e.target.value })}
                className="h-11 sm:h-10"
              />
            </Field>
            <Field label="Sets" error={errors[`ex.${row.id}.sets`]} className="sm:mb-0">
              <UnitInput
                value={row.sets}
                placeholder="3"
                invalid={!!errors[`ex.${row.id}.sets`]}
                onChange={(e) => onUpdate({ sets: e.target.value })}
                className="h-11 sm:h-10"
              />
            </Field>
            <Field label="Reps" error={errors[`ex.${row.id}.reps`]} className="sm:mb-0">
              <UnitInput
                value={row.reps}
                placeholder="8"
                invalid={!!errors[`ex.${row.id}.reps`]}
                onChange={(e) => onUpdate({ reps: e.target.value })}
                className="h-11 sm:h-10"
              />
            </Field>
            <Field label="RPE" error={errors[`ex.${row.id}.rpe`]} className="sm:mb-0">
              <UnitInput
                value={row.rpe}
                placeholder="8"
                invalid={!!errors[`ex.${row.id}.rpe`]}
                onChange={(e) => onUpdate({ rpe: e.target.value })}
                className="h-11 sm:h-10"
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 sm:contents">
            <div className="hidden sm:flex sm:flex-col sm:justify-center sm:h-10 sm:pt-5">
              <span className="text-xs font-medium tabular-nums text-foreground/80">
                {oneRm ? `${oneRm} kg` : "—"}
              </span>
            </div>
            <div className="hidden sm:flex sm:flex-col sm:justify-center sm:h-10 sm:pt-5">
              <span className="text-xs font-semibold tabular-nums text-strength">
                {relativeBw ? formatRelativeStrength(relativeBw, true) : "—"}
              </span>
            </div>
            <div className="flex gap-1 sm:pt-4 sm:justify-end">
              <button
                type="button"
                aria-label="Duplicate set"
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
                  className="rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger min-h-[44px] min-w-[44px] items-center justify-center sm:flex hidden"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:hidden">
            <DerivedChip label="Est. 1RM" value={oneRm ? `${oneRm} kg` : null} tone="strength" />
            <DerivedChip
              label="× BW"
              value={relativeBw ? formatRelativeStrength(relativeBw, true) : null}
              tone="strength"
            />
          </div>

          <Field label="Notes (optional)" className="sm:col-span-full mt-1">
            <GlassInput
              value={row.notes}
              placeholder="Tempo, form cues, etc."
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="h-11"
            />
          </Field>
        </div>
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full appearance-none rounded-xl glass px-3 text-sm text-foreground",
        "border border-white/10 transition-colors duration-200",
        "cursor-pointer focus:border-accent/50 focus:ring-1 focus:ring-accent/30 outline-none",
        invalid && "border-danger/50",
        value === "" && "text-muted/50",
        compact ? "h-10" : "h-11"
      )}
    >
      <option value="" disabled className="bg-slate-900">
        Select…
      </option>
      {MUSCLE_GROUPS.map((group) => (
        <option key={group} value={group} className="bg-slate-900">
          {group}
        </option>
      ))}
    </select>
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
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const displayValue = open ? search : value;

  const matches = useMemo(() => {
    const query = (open ? search : value).trim().toLowerCase();
    return COMMON_EXERCISES.filter((ex) => {
      const matchesQuery =
        query === "" ||
        ex.name.toLowerCase().includes(query) ||
        ex.muscle.toLowerCase().includes(query);
      const matchesFilter =
        muscleFilter === "all" || ex.category === muscleFilter;
      return matchesQuery && matchesFilter;
    });
  }, [value, search, open, muscleFilter]);

  const pick = (index: number) => {
    const match = matches[index];
    if (!match) return;
    onPick(match.name, match.muscle);
    setSearch("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(highlight);
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/50" />
        <GlassInput
          value={displayValue}
          placeholder="Search or type custom…"
          autoComplete="off"
          invalid={invalid}
          className="pl-9 h-11 sm:h-10"
          onChange={(e) => {
            const v = e.target.value;
            setSearch(v);
            onChange(v);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            setSearch(value);
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setSearch("");
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#12121a] shadow-xl"
          >
            <div className="flex gap-1 overflow-x-auto border-b border-white/5 p-2">
              {MUSCLE_GROUP_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onFilterChange(cat.id)}
                  className={cn(
                    "shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors duration-200",
                    muscleFilter === cat.id
                      ? "bg-strength/20 text-strength"
                      : "text-muted hover:text-foreground"
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <ul className="max-h-52 overflow-auto p-1.5">
              {matches.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted">
                  No matches — press enter to use &ldquo;{search || value}&rdquo;
                </li>
              ) : (
                matches.map((exercise, index) => (
                  <li key={exercise.name}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(index);
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-200 min-h-[44px]",
                        index === highlight
                          ? "bg-white/8 text-foreground"
                          : "text-muted hover:text-foreground hover:bg-white/5"
                      )}
                    >
                      <span>{exercise.name}</span>
                      <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted/60">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5",
                            exercise.kind === "compound"
                              ? "bg-strength/15 text-strength"
                              : "bg-white/5"
                          )}
                        >
                          {exercise.kind}
                        </span>
                        {exercise.muscle}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
