"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import {
  Check,
  ChevronDown,
  Copy,
  Dumbbell,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  categoryToMuscleGroup,
  COMMON_EXERCISES,
  getExerciseTracking,
  MUSCLE_GROUP_CATEGORIES,
  MUSCLE_GROUPS,
  type MuscleGroupCategory,
} from "@/lib/constants/sports";
import { formatRelativeStrength } from "@/lib/utils/scoring-display";
import { formatIndex } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { resolveAnchorKey, scoreStrength } from "@/lib/scoring/split-strength-engine";
import { scoreLoadedCarry, scoreTimedHold } from "@/lib/scoring/strength/isometric-carry";
import { getAttachmentOptionsByKey } from "@/lib/scoring/strength/attachments";
import { AttachmentPicker } from "@/components/gym/attachment-picker";
import {
  conventionLabel,
  conventionToMode,
  defaultWeightEntryMode,
  getExerciseLoadConfig,
  resolveScoringWeight,
  weightEntryLabel,
} from "@/lib/scoring/weight-entry";
import type { Gender } from "@/types";
import { DerivedChip, FieldError, GlassInput, UnitInput } from "./fields";
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

interface ExerciseHistorySet {
  weightKg: number;
  reps: number;
  sets: number;
  startedAt: string;
}
interface ExerciseHistoryPR {
  weightKg: number;
  reps: number;
  estimated1RMKg: number | null;
  startedAt: string;
}
interface ExerciseHistory {
  lastSet: ExerciseHistorySet | null;
  personalRecord: ExerciseHistoryPR | null;
}

/**
 * User feedback: "When logging exercises in the lab, it should inform you
 * of your previous weight and reps on this exercise as well as your
 * personal record on this exercise." Debounced, best-effort — a failed or
 * slow history fetch should never block or interrupt actually logging the
 * set, so failures are silently swallowed rather than surfaced as an
 * error.
 */
function useExerciseHistory(exerciseName: string): ExerciseHistory | null {
  const trimmed = exerciseName.trim();
  const [history, setHistory] = useState<ExerciseHistory | null>(null);

  useEffect(() => {
    // Nothing to fetch when the name is cleared — no need to reset
    // `history` here either: ExerciseHistoryHint already refuses to render
    // unless exerciseName is non-empty, so a stale value sitting unused in
    // state is harmless, and resetting it here would mean calling setState
    // synchronously in the effect body (flagged by this project's own lint
    // rule) for no real benefit.
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gym-exercises/history?name=${encodeURIComponent(trimmed)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ExerciseHistory;
        if (!cancelled) setHistory(data);
      } catch {
        // Best-effort — see doc comment above.
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  return history;
}

/**
 * The workout: a plain vertical list of exercise cards, one per movement.
 *
 * Deliberately NOT wrapped in a section card of its own. It used to sit
 * inside an ExpandableSection ("Metrics · Strength work", always open) which
 * sat inside a bordered panel — so each exercise card was a card, inside a
 * card, inside a card, and at 375px that nesting cost ~40px of horizontal
 * padding that the weight and reps inputs badly needed. The exercise cards
 * are the only container the list needs.
 */
export function GymExercises({
  state,
  errors,
  onUpdate,
  profileScoringSex = null,
}: {
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
  profileScoringSex?: Gender | null;
}) {
  const rows = state.exercises;
  // The muscle-group filter deliberately does NOT live here. It used to be a
  // single piece of state shared by every exercise row, so filtering row 1 to
  // "Legs" to find Squat also emptied row 2's dropdown of everything that
  // isn't a leg exercise — Bench Press simply wasn't in the list, with no
  // error and nothing to suggest tapping "All" would bring it back. It's
  // per-row local state inside ExerciseNameInput now, alongside the search
  // box it works with (which was always per-row).
  const bodyweight = parseNum(state.bodyweight);

  const updateRow = (id: string, patch: Partial<ExerciseRowState>) => {
    onUpdate(
      "exercises",
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const addRow = () => {
    onUpdate("exercises", [...rows, createExerciseRow()]);
  };

  /**
   * Same principle as removeSet below: the control is never inert. On the
   * last remaining exercise this empties it rather than deleting it (the
   * workout has to have somewhere to type), keeping the row's `id` so React
   * doesn't remount the card and lose focus.
   */
  const removeRow = (id: string) => {
    if (rows.length <= 1) {
      onUpdate(
        "exercises",
        rows.map((row) => (row.id === id ? { ...createExerciseRow(), id: row.id } : row))
      );
      return;
    }
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

  return (
    <div className="space-y-3">
      {/* Session bar — bodyweight (needed for every × bodyweight score) and
          the running totals, on one line instead of a full labelled field
          block competing with exercise 1 for the first screen. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gym-border/40 bg-gym-bg-elevated/60 px-3 py-2.5">
        <label
          htmlFor="gym-bodyweight"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted/70"
        >
          Bodyweight
        </label>
        <UnitInput
          id="gym-bodyweight"
          value={state.bodyweight}
          unit="kg"
          placeholder="75"
          aria-label="Current bodyweight in kilograms"
          invalid={!!errors.bodyweight}
          wrapperClassName="w-[104px]"
          className="h-10 px-3"
          onChange={(e) => onUpdate("bodyweight", e.target.value)}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          {topRelative && (
            <DerivedChip
              label="Top lift"
              value={`${topRelative.name} ${formatRelativeStrength(topRelative.ratio, true)}`}
              tone="strength"
            />
          )}
          <DerivedChip label="Volume" value={totalVolume} tone="strength" />
        </div>
        <FieldError error={errors.bodyweight} />
      </div>

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {rows.map((row, index) => (
            <ExerciseRow
              key={row.id}
              row={row}
              index={index}
              bodyweight={bodyweight}
              errors={errors}
              canRemove={rows.length > 1}
              profileScoringSex={profileScoringSex}
              onUpdate={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
        </AnimatePresence>
      </div>

      <FieldError error={errors.exercises} />

      <button
        type="button"
        onClick={addRow}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gym-border/60",
          "py-4 text-sm font-semibold text-gym-accent transition-colors duration-200",
          "hover:border-gym-accent/50 hover:bg-gym-accent/5 min-h-[52px]"
        )}
      >
        <Plus className="h-4 w-4" />
        Add exercise
        <Dumbbell className="h-4 w-4 opacity-40" />
      </button>
    </div>
  );
}

/**
 * Explicit grid placement for the set row's single-line `sm:` layout. The
 * mobile layout wraps the inputs in two flex rows which become
 * `display: contents` at `sm` — at which point DOM order alone would put the
 * delete button between reps and RIR, so every cell states its column.
 * Written as literal class strings because Tailwind scans source text.
 */
const SM_COL = [
  "",
  "sm:col-start-1",
  "sm:col-start-2",
  "sm:col-start-3",
  "sm:col-start-4",
  "sm:col-start-5",
  "sm:col-start-6",
] as const;

function ExerciseRow({
  row,
  index,
  bodyweight,
  errors,
  canRemove,
  profileScoringSex,
  onUpdate,
  onRemove,
}: {
  row: ExerciseRowState;
  index: number;
  bodyweight: number | null;
  errors: FormErrors;
  canRemove: boolean;
  profileScoringSex?: Gender | null;
  onUpdate: (patch: Partial<ExerciseRowState>) => void;
  onRemove: () => void;
}) {
  const loadConfig = row.name.trim() ? getExerciseLoadConfig(row.name) : null;
  const attachmentOptions = row.name.trim()
    ? getAttachmentOptionsByKey(resolveAnchorKey(row.name))
    : null;
  const history = useExerciseHistory(row.name);
  /**
   * The exercise picker (muscle-filter chips + search box + select) is ~150px
   * of chrome that used to stay on screen for the life of the row, so a
   * five-exercise workout was mostly pickers. It collapses to the chosen
   * name once you've picked, with a "Change" button to bring it back.
   *
   * Explicit-open only, OR'd with "there is no name yet": a fresh row opens
   * the picker, and `onChange` (which only fires from the custom-name text
   * input) pins it open so typing a custom exercise doesn't collapse the
   * field out from under the cursor on the first keystroke.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasName = row.name.trim().length > 0;
  const showPicker = pickerOpen || !hasName;
  /** Notes are per-exercise and rarely used — revealed on demand, but always shown once written. */
  const [noteOpen, setNoteOpen] = useState(false);
  // Pull Up / Dip / Push Up / Muscle Up — the plain bodyweight variant shows
  // no weight field at all (user feedback: these "should not require you to
  // have to add weight," and should stay a separate exercise/entry from
  // "Weighted X"). Scoring always treats these as 0kg added.
  const isBodyweightOnly = loadConfig?.noWeightInput === true;
  /**
   * Planks are held for seconds and carries/sled work cover metres — neither
   * has reps. The middle column follows the movement instead of always saying
   * "Reps", which is what made these exercises impossible to log: there was
   * no field for what you actually did, and submitting failed on the reps you
   * couldn't enter. Custom/unknown names stay on reps.
   */
  const tracking = getExerciseTracking(row.name);
  const countLabel =
    tracking === "time" ? "Secs" : tracking === "distance" ? "Metres" : "Reps";
  const showConventionPicker =
    loadConfig != null && loadConfig.allowedConventions.length > 1;
  const topSet = bestSetRow(row.sets);
  const weightKgRaw = topSet ? parseNum(topSet.weight) : null;
  // Bodyweight-only sets (pull-ups, dips, push-ups with no added load) leave
  // the weight field blank — that's a valid "0kg added" entry, not a missing
  // one, so it must still score off reps-at-bodyweight rather than silently
  // producing no score.
  const weightKg = isBodyweightOnly
    ? 0
    : (weightKgRaw ?? (row.weightEntryMode === "added" ? 0 : null));
  const reps = topSet ? parseNum(topSet.reps) : null;
  const rir = topSet?.repsInReserve.trim() ? parseNum(topSet.repsInReserve) : null;
  const resolved =
    weightKg !== null && row.name.trim()
      ? resolveScoringWeight(weightKg, row.name, row.weightEntryMode)
      : null;
  const scoringSex =
    profileScoringSex === "female" || profileScoringSex === "male" ? profileScoringSex : null;
  // This IS the same function activity-scorer.ts's scoreGymSession() calls
  // per-exercise to compute the real, saved score (split-strength-engine's
  // scoreStrength) — see that file's own comment: calculateStrengthIndexV2
  // is a "legacy" call kept only for DOTS/GL/loadScore, explicitly "no
  // longer used for per-exercise scoring". Live and saved already agree by
  // construction here; don't change this to call a different function.
  // Holds and carries never fill `reps` — the rep-based branch below would
  // return null and show nothing, so live and saved would silently disagree,
  // contrary to the promise made in the comment above. Route them to the same
  // scorers scoreGymSession uses.
  const holdSeconds = topSet ? parseNum(topSet.durationSeconds ?? "") : null;
  const carryMeters = topSet ? parseNum(topSet.distanceMeters ?? "") : null;
  const accessoryScore =
    bodyweight && scoringSex && row.name.trim() && tracking !== "reps"
      ? (tracking === "time"
          ? holdSeconds
            ? scoreTimedHold({
                liftKey: row.name,
                sets: [
                  {
                    weightKg: resolved?.scoringWeightKg ?? 0,
                    durationSeconds: holdSeconds,
                  },
                ],
                bodyweightKg: bodyweight,
                sex: scoringSex,
                age: 28,
              }).score
            : null
          : carryMeters && resolved
            ? scoreLoadedCarry({
                liftKey: row.name,
                sets: [
                  {
                    weightKg: resolved.scoringWeightKg,
                    distanceMeters: carryMeters,
                  },
                ],
                bodyweightKg: bodyweight,
                sex: scoringSex,
                age: 28,
              }).score
            : null) ?? null
      : null;
  const engineScore =
    accessoryScore ??
    (resolved && reps && bodyweight && scoringSex
      ? scoreStrength({
          liftKey: row.name,
          history: [],
          latestSet: {
            weightKg: resolved.scoringWeightKg,
            reps,
            repsInReserve: rir,
          },
          bodyweightKg: bodyweight,
          sex: scoringSex,
          age: 28,
          isPremium: false,
          isBodyweightRelative: resolved.isBodyweightRelative,
          weightEntryMode: resolved.mode,
          exerciseName: row.name,
          attachment: row.attachment,
        }).score
      : null);
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
    onUpdate({ sets: [...row.sets, createSetRow()] });
  };
  /**
   * "Adding the next set repeats the last set's shape" — but as an explicit
   * tap, not a silent prefill.
   *
   * createSetRow() deliberately stopped inheriting the previous set's numbers
   * (see its doc comment): an inherited weight you have to notice and clear
   * gets logged and scored as real training data when you don't. That fix
   * stands — `addSet` above still adds a blank set. This is the same
   * convenience made honest: the athlete asks for the copy, so a number that
   * appears is a number they chose. Only offered when there's a filled set to
   * copy, and it copies the SHAPE (load + volume), not the effort ratings —
   * RPE/RIR are the two values most likely to differ set to set, and a
   * carried-over "RPE 8" on a set that felt like 10 is exactly the kind of
   * quietly-wrong data the blank-start fix was protecting.
   */
  const lastFilledSet = [...row.sets]
    .reverse()
    .find(
      (s) =>
        s.weight.trim() !== "" ||
        s.reps.trim() !== "" ||
        (s.durationSeconds ?? "").trim() !== "" ||
        (s.distanceMeters ?? "").trim() !== ""
    );
  const repeatLastSet = () => {
    if (!lastFilledSet) return;
    onUpdate({
      sets: [
        ...row.sets,
        {
          ...createSetRow(),
          weight: lastFilledSet.weight,
          reps: lastFilledSet.reps,
          durationSeconds: lastFilledSet.durationSeconds ?? "",
          distanceMeters: lastFilledSet.distanceMeters ?? "",
        },
      ],
    });
  };
  /**
   * User-reported: "the delete button for a set does not work — clicking it
   * fails to remove the set."
   *
   * It was dead precisely when athletes reach for it most. The button carried
   * `disabled={row.sets.length <= 1}` (mirrored by an early return here), and
   * a freshly added exercise row has exactly ONE set — so on a new workout,
   * or on any exercise you haven't added a second set to yet, tapping the bin
   * did nothing at all. The only feedback was `disabled:opacity-30`, which
   * reads as "greyed out" only if you already suspect it.
   *
   * An exercise still can't drop to zero sets — the set row IS the entry
   * surface for weight/reps, so removing the last one would leave nothing to
   * type into. Clearing it instead does what the athlete actually wanted
   * (get rid of these numbers) and means the control is never inert. The set
   * keeps its `id` so React doesn't remount the row and steal focus.
   */
  const removeSet = (setId: string) => {
    if (row.sets.length <= 1) {
      onUpdate({
        sets: row.sets.map((s) =>
          s.id === setId
            ? {
                ...s,
                weight: "",
                reps: "",
                rpe: "",
                repsInReserve: "",
                durationSeconds: "",
                distanceMeters: "",
              }
            : s
        ),
      });
      return;
    }
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

  // Single-line `sm:` grid: index, [weight], count, RIR, RPE, delete.
  const smGridTemplate = isBodyweightOnly
    ? "sm:grid-cols-[28px_1fr_0.7fr_0.7fr_40px]"
    : "sm:grid-cols-[28px_1fr_1fr_0.7fr_0.7fr_40px]";
  const col = isBodyweightOnly
    ? { idx: 1, weight: 0, count: 2, rir: 3, rpe: 4, del: 5 }
    : { idx: 1, weight: 2, count: 3, rir: 4, rpe: 5, del: 6 };

  return (
    <div className="relative overflow-hidden rounded-2xl">
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
        className="rounded-2xl border border-gym-border/30 bg-gym-bg-elevated/70 p-3 sm:p-4 space-y-3"
      >
        {/* Header — the exercise, and the two controls that act on it. The
            remove button is visible at every width now: it used to be
            `hidden sm:flex`, leaving swipe-to-delete (undiscoverable, and
            nothing on screen suggests it) as the only way to drop an
            exercise on the phone this app mostly runs on. */}
        <div className="flex items-start gap-2.5">
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gym-accent/10 text-xs font-bold tabular-nums text-gym-accent">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <p
              className={cn(
                "truncate text-[15px] font-semibold leading-tight",
                hasName ? "text-foreground" : "text-muted/50"
              )}
            >
              {hasName ? row.name : `Exercise ${index + 1}`}
            </p>
            <FieldError error={errors[`ex.${row.id}.name`]} />
          </div>
          {!showPicker && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex min-h-[40px] shrink-0 items-center rounded-lg px-2.5 text-xs font-semibold text-gym-accent transition-colors hover:bg-gym-accent/10"
            >
              Change
            </button>
          )}
          <button
            type="button"
            /* Never inert — on the last exercise this clears it. Same
               reasoning as the per-set button; see removeRow. */
            aria-label={canRemove ? `Remove exercise ${index + 1}` : "Clear this exercise"}
            title={canRemove ? "Remove this exercise" : "Clear this exercise"}
            onClick={onRemove}
            className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {showPicker && (
          <ExerciseNameInput
            value={row.name}
            invalid={!!errors[`ex.${row.id}.name`]}
            onChange={(name, suggestedMuscle) => {
              // Typing a custom name keeps the picker open — see pickerOpen.
              setPickerOpen(true);
              onUpdate({
                name,
                // Typing a CUSTOM exercise name never set a muscle group,
                // unlike picking one from the list (onPick below), so every
                // custom exercise failed submit on "Pick a muscle group" —
                // a field the athlete had no reason to think was required.
                // Seed it from the category they're browsing under, but
                // only where that's unambiguous (see categoryToMuscleGroup)
                // and only when they haven't already chosen one themselves.
                muscleGroup: row.muscleGroup || suggestedMuscle || "",
                weightEntryMode: name.trim()
                  ? defaultWeightEntryMode(name)
                  : row.weightEntryMode,
                // A previously-picked attachment (e.g. "rope") almost
                // certainly doesn't apply once the exercise itself
                // changes — reset rather than silently carry it over.
                attachment: null,
              });
            }}
            onPick={(name, muscle) => {
              setPickerOpen(false);
              onUpdate({
                name,
                muscleGroup: muscle,
                weightEntryMode: defaultWeightEntryMode(name),
                attachment: null,
              });
            }}
            onDone={hasName ? () => setPickerOpen(false) : undefined}
          />
        )}

        {/* Exercise-level settings: muscle group (required by submit, so it
            stays on screen), load convention, attachment. */}
        <div className="flex flex-wrap items-center gap-2">
          <MuscleSelect
            compact
            className="w-[148px]"
            value={row.muscleGroup}
            invalid={!!errors[`ex.${row.id}.muscle`]}
            onChange={(v) => onUpdate({ muscleGroup: v })}
          />
          {showConventionPicker &&
            loadConfig!.allowedConventions.map((convention) => {
              const mode = conventionToMode(convention);
              return (
                <button
                  key={convention}
                  type="button"
                  onClick={() => onUpdate({ weightEntryMode: mode })}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors min-h-[40px]",
                    row.weightEntryMode === mode
                      ? "bg-gym-accent/15 text-gym-accent border border-gym-accent/30"
                      : "bg-white/[0.03] text-muted border border-white/[0.06] hover:text-foreground"
                  )}
                >
                  {conventionLabel(convention)}
                </button>
              );
            })}
        </div>
        <FieldError error={errors[`ex.${row.id}.muscle`]} />

        {loadConfig?.conventionNote ? (
          <p className="text-[11px] text-muted/70">{loadConfig.conventionNote}</p>
        ) : isBodyweightOnly ? (
          <p className="text-[11px] text-muted/70">
            Bodyweight only — scored off reps. Log a &quot;Weighted {row.name}&quot; entry instead if you added load.
          </p>
        ) : null}

        {attachmentOptions && (
          <AttachmentPicker
            options={attachmentOptions}
            value={row.attachment}
            onChange={(id) => onUpdate({ attachment: id })}
          />
        )}

        <ExerciseHistoryHint history={history} exerciseName={row.name} unit={weightUnit} />

        <div className="space-y-2">
          {/* Column headers belong to the single-line sm layout only. The
              mobile rows label their own secondary inputs inline instead. */}
          <div
            className={cn(
              "hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted/60 sm:grid",
              smGridTemplate
            )}
          >
            <span>Set</span>
            {!isBodyweightOnly && <span>{weightUnit}</span>}
            <span>{countLabel}</span>
            <span>RIR</span>
            <span>RPE</span>
            <span />
          </div>
          {/* One set = one tap target group. On mobile the row splits in two:
              the numbers you came to type (weight, reps) get the full width,
              and the effort ratings sit on a slim second line — still on
              screen, never behind a disclosure, just no longer squeezing four
              inputs into 223px. That old five-column grid gave RIR and RPE
              ~24px of usable text width each at 375px, which clips a
              two-digit number. At `sm` the wrappers become `display: contents`
              and every cell rejoins the original single-line grid. */}
          {row.sets.map((set, setIndex) => {
            const countInput =
              tracking === "time" ? (
                <UnitInput
                  aria-label={`Set ${setIndex + 1} hold time in seconds`}
                  value={set.durationSeconds ?? ""}
                  placeholder="60"
                  invalid={!!errors[`ex.${row.id}.set.${set.id}.duration`]}
                  onChange={(e) => updateSet(set.id, { durationSeconds: e.target.value })}
                  wrapperClassName={cn("flex-1 sm:row-start-1", SM_COL[col.count])}
                  className="h-12 px-3 sm:h-10 sm:px-4"
                />
              ) : tracking === "distance" ? (
                <UnitInput
                  aria-label={`Set ${setIndex + 1} distance in metres`}
                  value={set.distanceMeters ?? ""}
                  placeholder="20"
                  invalid={!!errors[`ex.${row.id}.set.${set.id}.distance`]}
                  onChange={(e) => updateSet(set.id, { distanceMeters: e.target.value })}
                  wrapperClassName={cn("flex-1 sm:row-start-1", SM_COL[col.count])}
                  className="h-12 px-3 sm:h-10 sm:px-4"
                />
              ) : (
                <UnitInput
                  aria-label={`Set ${setIndex + 1} reps`}
                  value={set.reps}
                  placeholder="8"
                  invalid={!!errors[`ex.${row.id}.set.${set.id}.reps`]}
                  onChange={(e) => updateSet(set.id, { reps: e.target.value })}
                  wrapperClassName={cn("flex-1 sm:row-start-1", SM_COL[col.count])}
                  className="h-12 px-3 sm:h-10 sm:px-4"
                />
              );

            return (
              <div
                key={set.id}
                className={cn(
                  "rounded-xl bg-white/[0.025] p-2 sm:items-center sm:gap-2 sm:bg-transparent sm:p-0",
                  "sm:grid",
                  smGridTemplate
                )}
              >
                <div className="flex items-center gap-2 sm:contents">
                  <span
                    className={cn(
                      "w-6 shrink-0 text-center text-xs font-semibold tabular-nums text-muted/70 sm:row-start-1 sm:w-auto",
                      SM_COL[col.idx]
                    )}
                  >
                    {setIndex + 1}
                  </span>
                  {!isBodyweightOnly && (
                    <UnitInput
                      aria-label={`Set ${setIndex + 1} weight`}
                      value={set.weight}
                      unit={weightUnit}
                      placeholder={row.weightEntryMode === "added" ? "0 = bw" : "60"}
                      invalid={!!errors[`ex.${row.id}.set.${set.id}.weight`]}
                      onChange={(e) => updateSet(set.id, { weight: e.target.value })}
                      wrapperClassName={cn("flex-1 sm:row-start-1", SM_COL[col.weight])}
                      className="h-12 px-3 sm:h-10 sm:px-4"
                    />
                  )}
                  {countInput}
                  <button
                    type="button"
                    /* Never disabled — see removeSet. On the last remaining set
                       this clears the row rather than deleting it, so the label
                       has to say which, for screen readers and for the tooltip. */
                    aria-label={
                      row.sets.length <= 1
                        ? `Clear set ${setIndex + 1}`
                        : `Remove set ${setIndex + 1}`
                    }
                    title={row.sets.length <= 1 ? "Clear this set" : "Remove this set"}
                    onClick={() => removeSet(set.id)}
                    className={cn(
                      "flex min-h-[44px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger sm:row-start-1",
                      SM_COL[col.del]
                    )}
                  >
                    <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-8 sm:mt-0 sm:contents">
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 sm:row-start-1 sm:block",
                      SM_COL[col.rir]
                    )}
                  >
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted/60 sm:hidden">
                      RIR
                    </span>
                    <UnitInput
                      aria-label={`Set ${setIndex + 1} reps in reserve`}
                      value={set.repsInReserve}
                      placeholder="0"
                      invalid={!!errors[`ex.${row.id}.set.${set.id}.rir`]}
                      onChange={(e) => updateSet(set.id, { repsInReserve: e.target.value })}
                      wrapperClassName="flex-1"
                      className="h-10 px-3 sm:h-10 sm:px-4"
                    />
                  </div>
                  <div
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 sm:row-start-1 sm:block",
                      SM_COL[col.rpe]
                    )}
                  >
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted/60 sm:hidden">
                      RPE
                    </span>
                    <UnitInput
                      aria-label={`Set ${setIndex + 1} RPE`}
                      value={set.rpe}
                      placeholder="8"
                      invalid={!!errors[`ex.${row.id}.set.${set.id}.rpe`]}
                      onChange={(e) => updateSet(set.id, { rpe: e.target.value })}
                      wrapperClassName="flex-1"
                      className="h-10 px-3 sm:h-10 sm:px-4"
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <FieldError error={errors[`ex.${row.id}.sets`]} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addSet}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-gym-border/50 text-sm font-semibold text-gym-accent transition-colors hover:border-gym-accent/50 hover:bg-gym-accent/5"
            >
              <Plus className="h-4 w-4" />
              Add set
            </button>
            {lastFilledSet && (
              <button
                type="button"
                onClick={repeatLastSet}
                title="Add a set with the same load and volume as the last one"
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
                Repeat
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DerivedChip label="Est. 1RM" value={oneRm ? `${oneRm} kg` : null} tone="strength" />
          <DerivedChip
            label="× BW"
            value={relativeBw ? formatRelativeStrength(relativeBw, true) : null}
            tone="strength"
          />
          <DerivedChip label="Volume" value={volume > 0 ? `${Math.round(volume)} kg` : null} tone="strength" />
          {/* User feedback: "why is the scoring system in the lab when
              logging exercises still out of 999 not 99.9" — engineScore
              is the same internal 0-999 scale as every other score in the
              app; every other surface (dashboard, success screen, etc.)
              runs it through formatIndex() before display, this one
              didn't, so it showed the raw internal number instead of the
              app-wide 0-99.9 display scale. */}
          <span
            className={cn(
              "ml-auto inline-flex items-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums",
              engineScore ? "text-gym-accent bg-gym-accent/10" : "text-gym-muted/50"
            )}
          >
            {engineScore !== null ? formatIndex(engineScore) : "—"}
          </span>
        </div>

        {noteOpen || row.notes ? (
          <GlassInput
            value={row.notes}
            aria-label={`Notes for exercise ${index + 1}`}
            placeholder="Tempo, form cues, etc."
            onChange={(e) => onUpdate({ notes: e.target.value })}
            className="h-11 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add a note
          </button>
        )}
      </motion.div>
    </div>
  );
}

function formatDaysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** User feedback: "When logging exercises in the lab, it should inform you of your previous weight and reps on this exercise as well as your personal record on this exercise." */
function ExerciseHistoryHint({
  history,
  exerciseName,
  unit,
}: {
  history: ExerciseHistory | null;
  exerciseName: string;
  unit: string;
}) {
  if (!exerciseName.trim() || !history) return null;
  const { lastSet, personalRecord } = history;
  if (!lastSet && !personalRecord) return null;

  // A PR that IS the last set (only ever logged once, or the most recent
  // set happens to also be the best) isn't worth repeating twice.
  const prDiffersFromLast =
    personalRecord &&
    (!lastSet || personalRecord.weightKg !== lastSet.weightKg || personalRecord.reps !== lastSet.reps);

  return (
    /* Sits directly above the set rows, so the number to beat is on the same
       screen as the field you type it into — no navigating away. */
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
      {lastSet && (
        <span>
          Last time:{" "}
          <span className="font-medium text-foreground/90">
            {lastSet.weightKg}
            {unit} × {lastSet.reps}
          </span>
          {lastSet.sets > 1 ? ` (${lastSet.sets} sets)` : ""} · {formatDaysAgo(lastSet.startedAt)}
        </span>
      )}
      {prDiffersFromLast && (
        <span>
          PR:{" "}
          <span className="font-medium text-gym-accent">
            {personalRecord!.weightKg}
            {unit} × {personalRecord!.reps}
          </span>
        </span>
      )}
    </p>
  );
}

function MuscleSelect({
  value,
  invalid,
  onChange,
  compact,
  className,
}: {
  value: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        aria-label="Muscle group"
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full appearance-none rounded-xl glass pl-3 pr-9 text-base text-foreground",
          "border border-white/10 transition-colors duration-200",
          "cursor-pointer focus:border-accent/50 focus:ring-1 focus:ring-accent/30 outline-none",
          invalid && "border-danger/50",
          value === "" && "text-muted/50",
          compact ? "h-10 text-sm" : "h-11"
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
  invalid,
  onChange,
  onPick,
  onDone,
}: {
  value: string;
  invalid?: boolean;
  /** `suggestedMuscle` is the active filter's muscle group when unambiguous — see the caller. */
  onChange: (value: string, suggestedMuscle: string | null) => void;
  onPick: (name: string, muscle: string) => void;
  /**
   * Collapse the picker back to the card header. Picking from the list does
   * this on its own (see onPick's caller); a custom name has no such moment —
   * every keystroke is a valid, unfinished name — so it gets an explicit
   * "Done". Undefined while there's nothing to collapse to.
   */
  onDone?: () => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [search, setSearch] = useState("");
  // Per-row, like `search` above. Previously hoisted into GymExercises and
  // shared by every row, which hid exercises from every row but the one the
  // athlete last filtered — see the note there.
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroupCategory>("all");
  const suggestedMuscle = categoryToMuscleGroup(muscleFilter);

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
          onChange={(e) => onChange(e.target.value, suggestedMuscle)}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              // Clearing only `customMode` isn't enough: the render condition
              // above (`customMode || (value && !knownExercise)`) re-enters
              // custom mode on the very next render whenever `value` still
              // holds unrecognized custom text — which it always does right
              // after typing a custom name. That made this button silently
              // no-op instead of returning to the picker.
              setCustomMode(false);
              setSearch("");
              onChange("", null);
            }}
            className="flex min-h-[36px] items-center text-xs text-gym-accent hover:text-gym-accent/80"
          >
            ← Pick from list
          </button>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="ml-auto flex min-h-[36px] items-center gap-1.5 rounded-lg bg-gym-accent/10 px-3 text-xs font-semibold text-gym-accent hover:bg-gym-accent/20"
            >
              <Check className="h-3.5 w-3.5" />
              Done
            </button>
          )}
        </div>
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
            onClick={() => setMuscleFilter(cat.id)}
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
          className="pl-9 h-10"
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
              onChange("", null);
              return;
            }
            const ex = COMMON_EXERCISES.find((item) => item.name === selected);
            if (ex) onPick(ex.name, ex.muscle);
          }}
          className={cn(
            "w-full appearance-none rounded-xl border border-gym-border/50 bg-gym-bg-elevated pl-3 pr-9 py-3 text-base text-gym-text",
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

      {/* No "Selected: X" line — the card header above the picker already
          shows the chosen exercise, in a larger type size, and keeps showing
          it after the picker collapses. */}
    </div>
  );
}
