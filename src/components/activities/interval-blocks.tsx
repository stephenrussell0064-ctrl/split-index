"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  ClockInput,
  FieldError,
  MicroLabel,
  UnitInput,
} from "./fields";
import {
  createIntervalBlock,
  createIntervalRepOverride,
  flattenIntervalBlocks,
  formatClock,
  intervalBlockHasEntry,
  intervalBlocksTotalSeconds,
  intervalBlocksWorkDistanceMeters,
  parseNum,
  parseSeconds,
  readIntervalBlocks,
  resolveIntervalBlock,
  type FormErrors,
  type IntervalBlockState,
  type WorkoutFormState,
} from "./form-state";

/** min:sec per km from metres + seconds — the number an interval athlete reads. */
function pacePerKm(meters: number | null, seconds: number | null): string | null {
  if (!meters || meters <= 0 || !seconds || seconds <= 0) return null;
  return `${formatClock((seconds / meters) * 1000)} /km`;
}

function blockSummary(block: IntervalBlockState): string | null {
  const reps = parseNum(block.reps);
  const distance = parseNum(block.distanceMeters);
  const work = parseSeconds(block.workSeconds);
  if (!reps || !distance) return null;
  const time = work ? ` @ ${formatClock(work)}` : "";
  return `${Math.round(reps)} × ${Math.round(distance)} m${time}`;
}

/**
 * The interval session, as the athlete actually ran it.
 *
 * User request, verbatim: "blocks that can be edited per rep". A session is a
 * list of blocks — 4 × 400m @ 75s, then 2 × 800m @ 2:40 — and any individual
 * rep inside a block can be corrected without re-entering the block. The
 * common case stays four numbers; per-rep editing is opt-in and collapsed.
 *
 * Nothing here changes what is stored. On submit the whole structure collapses
 * back onto the same five `interval_*` columns a uniform block has always
 * produced (see flattenIntervalBlocks), so the scorer, the schema and every
 * previously logged session are untouched.
 */
export function IntervalBlocks({
  state,
  errors,
  onChange,
  onUseTotals,
}: {
  state: WorkoutFormState;
  errors: FormErrors;
  onChange: (blocks: IntervalBlockState[]) => void;
  /** Fill the session's distance + duration from what the blocks add up to. */
  onUseTotals?: (workDistanceMeters: number, totalSeconds: number) => void;
}) {
  // Never mutated in render: a session saved before blocks existed is READ as
  // one block (readIntervalBlocks) and only written back once the athlete
  // edits something.
  const blocks = readIntervalBlocks(state);

  const update = (id: string, patch: Partial<IntervalBlockState>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const addBlock = () => {
    // Seeded from nothing — a second block is a DIFFERENT piece of work
    // (that's the whole reason it's a second block), so inheriting the first
    // one's numbers would be the same silent-prefill mistake createSetRow
    // documents at length. "Duplicate" below is the explicit version.
    onChange([...blocks, createIntervalBlock()]);
  };

  const duplicateBlock = (id: string) => {
    const source = blocks.find((b) => b.id === id);
    if (!source) return;
    const index = blocks.findIndex((b) => b.id === id);
    const copy: IntervalBlockState = {
      ...createIntervalBlock({
        reps: source.reps,
        distanceMeters: source.distanceMeters,
        workSeconds: source.workSeconds,
        restSeconds: source.restSeconds,
      }),
      // Per-rep corrections describe reps that already happened — they are
      // never what the next block did.
      repOverrides: [],
    };
    onChange([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
  };

  /**
   * Never inert, same rule as the set and exercise delete buttons: on the last
   * remaining block this clears it instead of removing it, keeping the id so
   * React doesn't remount the card and drop focus.
   */
  const removeBlock = (id: string) => {
    if (blocks.length <= 1) {
      onChange(blocks.map((b) => (b.id === id ? { ...createIntervalBlock(), id: b.id } : b)));
      return;
    }
    onChange(blocks.filter((b) => b.id !== id));
  };

  const filled = blocks.filter(intervalBlockHasEntry);
  const flat = flattenIntervalBlocks(filled);
  const workDistance = intervalBlocksWorkDistanceMeters(filled);
  const totalSeconds = intervalBlocksTotalSeconds(filled);
  const workPace = flat
    ? pacePerKm(flat.reps * flat.workDistanceMeters, flat.reps * flat.workSeconds)
    : null;

  return (
    <div className="space-y-2.5">
      {/* Stacked, not side by side: at 375px the label and the hint were
          fighting over one line and "The reps" wrapped mid-phrase. */}
      <div>
        <MicroLabel className="text-cardio-accent">The reps</MicroLabel>
        <p className="mt-0.5 text-[11px] text-muted/70">
          Scored off work-piece pace, not the session average
        </p>
      </div>

      {/* No AnimatePresence — same reasoning as the exercise list in
          gym-form.tsx, where an exit animation that never completed left
          removed rows on screen and broke the delete button outright. A block
          leaves the moment it leaves state. */}
      <div className="space-y-2.5">
        {blocks.map((block, index) => (
          <IntervalBlockCard
            key={block.id}
            block={block}
            index={index}
            errors={errors}
            onUpdate={(patch) => update(block.id, patch)}
            onDuplicate={() => duplicateBlock(block.id)}
            onRemove={() => removeBlock(block.id)}
            isOnly={blocks.length <= 1}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addBlock}
        className={cn(
          "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-dashed",
          "border-cardio-accent/35 text-sm font-semibold text-cardio-accent",
          "transition-colors duration-200 hover:border-cardio-accent/60 hover:bg-cardio-accent/5"
        )}
      >
        <Plus className="h-4 w-4" />
        Add another block
      </button>

      {flat && (
        <div className="rounded-xl border border-cardio-accent/20 bg-cardio-accent/[0.06] p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {flat.reps} rep{flat.reps === 1 ? "" : "s"}
              {workDistance ? ` · ${workDistance.toLocaleString()} m of work` : ""}
            </p>
            {workPace && (
              <p className="text-sm font-semibold tabular-nums text-cardio-accent">{workPace}</p>
            )}
          </div>
          {totalSeconds !== null && (
            <p className="mt-0.5 text-[11px] text-muted">
              Work + rest adds up to {formatClock(totalSeconds)}
            </p>
          )}
          {onUseTotals && workDistance !== null && totalSeconds !== null && (
            <button
              type="button"
              onClick={() => onUseTotals(workDistance, totalSeconds)}
              className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cardio-accent/12 px-3 text-xs font-semibold text-cardio-accent transition-colors hover:bg-cardio-accent/20"
            >
              <Copy className="h-3.5 w-3.5" />
              Use as session distance &amp; duration
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IntervalBlockCard({
  block,
  index,
  errors,
  onUpdate,
  onDuplicate,
  onRemove,
  isOnly,
}: {
  block: IntervalBlockState;
  index: number;
  errors: FormErrors;
  onUpdate: (patch: Partial<IntervalBlockState>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  isOnly: boolean;
}) {
  const [repsOpen, setRepsOpen] = useState(false);
  const key = (field: string) => `ivl.${block.id}.${field}`;
  const reps = parseNum(block.reps);
  const repCount = reps && reps >= 1 && reps <= 100 ? Math.round(reps) : 0;
  const resolved = resolveIntervalBlock(block);
  const summary = blockSummary(block);
  const pace = resolved
    ? pacePerKm(
        resolved.reduce((s, r) => s + r.distanceMeters, 0),
        resolved.reduce((s, r) => s + r.workSeconds, 0)
      )
    : null;
  const editedReps = block.repOverrides.filter(
    (r, i) =>
      i < repCount &&
      (r.distanceMeters.trim() !== "" ||
        r.workSeconds.trim() !== "" ||
        r.restSeconds.trim() !== "")
  ).length;

  /**
   * Overrides are positional and materialised lazily — a uniform block carries
   * none at all. Opening the per-rep list pads the array out to the block's rep
   * count so every rep has a row to type into; shrinking the rep count leaves
   * the extra entries alone rather than destroying numbers the athlete may be
   * about to restore by fixing a typo in the count.
   */
  const overrideAt = (i: number) => block.repOverrides[i] ?? createIntervalRepOverride();
  const setOverride = (i: number, patch: Partial<ReturnType<typeof overrideAt>>) => {
    const next = [...block.repOverrides];
    while (next.length <= i) next.push(createIntervalRepOverride());
    next[i] = { ...next[i], ...patch };
    onUpdate({ repOverrides: next });
  };
  const clearOverride = (i: number) => {
    if (i >= block.repOverrides.length) return;
    const next = [...block.repOverrides];
    next[i] = { ...next[i], distanceMeters: "", workSeconds: "", restSeconds: "" };
    onUpdate({ repOverrides: next });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
    >
      {/* The summary is the one line that tells the athlete what this block
          IS, so it gets to wrap rather than truncate — at 375px "4 × 400 m @
          1:15" plus a pace plus two icon buttons does not fit on one line, and
          eliding it to "4 × 400 m @ 1:…" hides the number that was just typed.
          Pace moves below it for the same reason. */}
      <div className="mb-2.5 flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cardio-accent/12 text-[11px] font-bold tabular-nums text-cardio-accent">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-foreground">
            {summary ?? `Block ${index + 1}`}
          </p>
          {pace && (
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-cardio-accent">
              {pace}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDuplicate}
          aria-label={`Duplicate block ${index + 1}`}
          title="Duplicate this block"
          className="flex min-h-[40px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          /* Never inert — on the last block this clears it. Same rule the set
             and exercise delete buttons follow. */
          onClick={onRemove}
          aria-label={isOnly ? "Clear this block" : `Remove block ${index + 1}`}
          title={isOnly ? "Clear this block" : "Remove this block"}
          className="flex min-h-[40px] min-w-[36px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <MicroLabel htmlFor={`${block.id}-reps`}>Reps</MicroLabel>
          <UnitInput
            id={`${block.id}-reps`}
            inputMode="numeric"
            value={block.reps}
            placeholder="4"
            invalid={!!errors[key("reps")]}
            onChange={(e) => onUpdate({ reps: e.target.value })}
            className="h-11"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <MicroLabel htmlFor={`${block.id}-distance`}>Distance / rep</MicroLabel>
          <UnitInput
            id={`${block.id}-distance`}
            unit="m"
            value={block.distanceMeters}
            placeholder="400"
            invalid={!!errors[key("distanceMeters")]}
            onChange={(e) => onUpdate({ distanceMeters: e.target.value })}
            className="h-11"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <MicroLabel>Time / rep</MicroLabel>
          <ClockInput
            ariaPrefix={`Block ${index + 1} work time`}
            value={block.workSeconds}
            invalid={!!errors[key("workSeconds")]}
            onChange={(next) => onUpdate({ workSeconds: next })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <MicroLabel>Rest between</MicroLabel>
          <ClockInput
            ariaPrefix={`Block ${index + 1} rest`}
            value={block.restSeconds}
            minutesPlaceholder="1"
            secondsPlaceholder="30"
            onChange={(next) => onUpdate({ restSeconds: next })}
          />
        </div>
      </div>

      <FieldError error={errors[key("reps")]} />
      <FieldError error={errors[key("distanceMeters")]} />
      <FieldError error={errors[key("workSeconds")]} />

      <div className="mt-2.5 flex min-w-0 items-center gap-2">
        <MicroLabel htmlFor={`${block.id}-hr`} className="shrink-0">
          HR in reps
        </MicroLabel>
        <UnitInput
          id={`${block.id}-hr`}
          unit="bpm"
          value={block.workHr}
          placeholder="Optional"
          invalid={!!errors[key("workHr")]}
          onChange={(e) => onUpdate({ workHr: e.target.value })}
          wrapperClassName="w-[132px]"
          className="h-10"
        />
      </div>
      <FieldError error={errors[key("workHr")]} />

      {repCount >= 2 && (
        <>
          <button
            type="button"
            onClick={() => setRepsOpen((v) => !v)}
            aria-expanded={repsOpen}
            className="mt-2 flex min-h-[40px] w-full items-center gap-1.5 text-xs font-semibold text-cardio-accent transition-colors hover:text-cardio-accent-soft"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform duration-200", repsOpen && "rotate-180")}
              aria-hidden
            />
            {repsOpen ? "Hide individual reps" : "A rep was different?"}
            {editedReps > 0 && (
              <span className="ml-auto rounded-full bg-cardio-accent/15 px-2 py-0.5 text-[10px] font-bold tabular-nums">
                {editedReps} edited
              </span>
            )}
          </button>

          {repsOpen && (
            <div
              /* bg-white/*, not bg-black/*: globals.css remaps white-alpha
                 surfaces per zone, so this stays a subtle inset in The Lab's
                 dark palette AND in The Engine's light one. A literal
                 bg-black/20 was a grey slab on the light zone. */
              className="mt-1.5 space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-2.5"
            >
              <p className="text-[11px] text-muted/70">
                Leave a rep blank and it counts exactly as the block above says. Fill one
                in and only that rep changes.
              </p>
              {Array.from({ length: repCount }, (_, i) => {
                const override = overrideAt(i);
                const dirty =
                  override.distanceMeters.trim() !== "" ||
                  override.workSeconds.trim() !== "" ||
                  override.restSeconds.trim() !== "";
                const planned = clockPlaceholder(block.workSeconds);
                return (
                  <div key={override.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-[11px] font-semibold uppercase tracking-wider",
                          dirty ? "text-cardio-accent" : "text-muted/60"
                        )}
                      >
                        Rep {i + 1}
                      </span>
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => clearOverride(i)}
                          aria-label={`Reset rep ${i + 1} to the block`}
                          title="Back to what the block says"
                          className="ml-auto flex min-h-[32px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset
                        </button>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <UnitInput
                        aria-label={`Rep ${i + 1} distance in metres`}
                        unit="m"
                        value={override.distanceMeters}
                        placeholder={block.distanceMeters || "400"}
                        onChange={(e) => setOverride(i, { distanceMeters: e.target.value })}
                        wrapperClassName="min-w-0 flex-1"
                        className="h-10 px-2.5"
                      />
                      <ClockInput
                        ariaPrefix={`Rep ${i + 1} time`}
                        value={override.workSeconds}
                        minutesPlaceholder={planned.minutes}
                        secondsPlaceholder={planned.seconds}
                        onChange={(next) => setOverride(i, { workSeconds: next })}
                        className="flex-[1.3]"
                      />
                      <UnitInput
                        aria-label={`Rep ${i + 1} rest in seconds`}
                        unit="s"
                        inputMode="numeric"
                        value={override.restSeconds}
                        placeholder="rest"
                        onChange={(e) => setOverride(i, { restSeconds: e.target.value })}
                        wrapperClassName="min-w-0 flex-1"
                        className="h-10 px-2.5"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/** The block's own time, shown as ghost text in each rep's boxes. */
function clockPlaceholder(value: string): { minutes: string; seconds: string } {
  const total = parseSeconds(value);
  if (total === null || total <= 0) return { minutes: "1", seconds: "15" };
  if (total < 60) return { minutes: "0", seconds: String(Math.round(total)) };
  return {
    minutes: String(Math.floor(total / 60)),
    seconds: String(Math.round(total % 60)).padStart(2, "0"),
  };
}
