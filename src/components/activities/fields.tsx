"use client";

import { createContext, useContext, useId } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { parseSeconds } from "./form-state";

/** Uppercase tracking-wider micro-label used across the logging forms. */
export function MicroLabel({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "text-[11px] font-medium uppercase tracking-wider text-muted",
        className
      )}
    >
      {children}
    </label>
  );
}

export function FieldError({ error }: { error?: string }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          initial={{ opacity: 0, height: 0, y: -2 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -2 }}
          transition={{ duration: 0.18 }}
          className="text-xs text-danger"
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * The id this field's label points at, handed down to whichever input is inside
 * it.
 *
 * `Field` has always accepted an `htmlFor`, and NONE of its 73 call sites
 * passed one — so the label was a floating `<p>` next to an unnamed `<input>`,
 * and VoiceOver announced every weight, rep and distance field in the app as
 * "text field, blank". Requiring 73 hand-written ids to fix that is how it
 * stayed broken; generating one here fixes all of them at once, and an explicit
 * `htmlFor` still wins where a caller wants to name its own.
 */
const FieldIdContext = createContext<string | undefined>(undefined);

/**
 * Adopt the surrounding Field's id — unless this input already carries its own
 * name.
 *
 * The `aria-label` check is what keeps the composites safe. DurationInput and
 * SplitInput put THREE and TWO inputs inside one Field, each already labelled
 * ("Duration hr", "Duration min"), and if all of them adopted the same id the
 * document would carry duplicates — a worse defect than the one being fixed.
 * An input that names itself does not need the field's id, so it does not take
 * it.
 */
function useFieldId(props: { id?: string; "aria-label"?: string }): string | undefined {
  const fieldId = useContext(FieldIdContext);
  if (props.id) return props.id;
  if (props["aria-label"]) return undefined;
  return fieldId;
}

export function Field({ label, error, hint, htmlFor, children, className }: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  return (
    <FieldIdContext.Provider value={id}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <MicroLabel htmlFor={id}>{label}</MicroLabel>
        {children}
        {hint && !error && <p className="text-xs text-muted/70">{hint}</p>}
        <FieldError error={error} />
      </div>
    </FieldIdContext.Provider>
  );
}

// text-base (16px), not text-sm — see components/ui/input.tsx for why: iOS
// auto-zooms into a sub-16px input and the zoom doesn't reset on SPA route
// changes, leaving the whole app looking zoomed-in afterward.
const inputBase =
  "h-11 w-full rounded-xl glass px-4 text-base text-foreground placeholder:text-muted/40 " +
  "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 " +
  "transition-colors duration-200 outline-none tabular-nums";

export function GlassInput({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const id = useFieldId(props);
  return (
    <input
      // The surrounding Field's label points here — see useFieldId. Without it
      // every one of these was an unnamed text field to a screen reader.
      id={id}
      // aria-invalid, not just a red border. Two reasons: a screen reader has
      // no way to perceive the border, and the submit-time error summary finds
      // the first bad field with `[aria-invalid="true"]` so it can take the
      // athlete straight to it.
      aria-invalid={invalid || undefined}
      className={cn(
        inputBase,
        invalid && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
        className
      )}
      {...props}
    />
  );
}

/**
 * Numeric-friendly input: inputMode decimal, unit suffix inside the field.
 *
 * `className` styles the <input>; `wrapperClassName` styles the positioning
 * div that actually becomes the flex/grid child. They're separate because the
 * set rows in gym-form.tsx place this component directly into a CSS grid —
 * `sm:col-start-*` and `flex-1` have to land on the wrapper to have any
 * effect, while `h-*` has to land on the input.
 */
export function UnitInput({
  unit,
  invalid,
  className,
  wrapperClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  unit?: string;
  invalid?: boolean;
  wrapperClassName?: string;
}) {
  const id = useFieldId(props);
  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={cn(
          inputBase,
          unit && "pr-9",
          invalid && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
          className
        )}
        {...props}
      />
      {unit && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted/60">
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * The one or two numbers an athlete actually came to type — distance and
 * duration on a cardio session. Same input, same validation, same state;
 * just sized so it dominates the screen rather than sitting in the identical
 * 44px box as "Temperature". Unit is rendered as a static suffix rather than
 * placeholder text so it stays readable at this size.
 */
export function HeroInput({
  unit,
  invalid,
  className,
  wrapperClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  unit?: string;
  invalid?: boolean;
  wrapperClassName?: string;
}) {
  const id = useFieldId(props);
  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={cn(
          "h-16 w-full rounded-2xl glass px-4 text-3xl font-semibold tracking-tight text-foreground",
          "placeholder:text-muted/30 placeholder:font-normal border border-white/10",
          "focus:border-accent/50 focus:ring-1 focus:ring-accent/30",
          "transition-colors duration-200 outline-none tabular-nums",
          unit && "pr-14",
          invalid && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
          className
        )}
        {...props}
      />
      {unit && (
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium uppercase tracking-wider text-muted/60">
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * Read-only derived headline (pace, split, speed) shown at the same visual
 * weight as the numbers it's derived from, so the athlete can see the figure
 * they care about without hunting for a chip.
 */
export function HeroReadout({
  label,
  value,
  placeholder,
  tone = "endurance",
}: {
  label: string;
  value: string | null;
  placeholder: string;
  tone?: "endurance" | "strength";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-center gap-0.5 rounded-2xl border px-4 py-3",
        tone === "endurance"
          ? "border-endurance/20 bg-endurance/[0.06]"
          : "border-strength/20 bg-strength/[0.06]"
      )}
    >
      <MicroLabel className="text-muted/70">{label}</MicroLabel>
      <p
        className={cn(
          "truncate text-2xl font-semibold tabular-nums tracking-tight",
          value
            ? tone === "endurance"
              ? "text-endurance"
              : "text-strength"
            : "text-muted/40 text-base font-normal"
        )}
      >
        {value ?? placeholder}
      </p>
    </div>
  );
}

/**
 * Forgiving duration entry: separate H / M / S boxes.
 *
 * `size="hero"` matches HeroInput's height and type scale so distance and
 * duration read as a matched pair of primary inputs on the cardio form. The
 * unit sits under each box there rather than inside it — at 3xl there isn't
 * room for both the number and an inline suffix at 375px.
 */
export function DurationInput({
  hours,
  minutes,
  seconds,
  onChange,
  invalid,
  size = "default",
}: {
  hours: string;
  minutes: string;
  seconds: string;
  onChange: (part: "hours" | "minutes" | "seconds", value: string) => void;
  invalid?: boolean;
  size?: "default" | "hero";
}) {
  const parts = [
    { key: "hours", value: hours, unit: "hr", placeholder: "0" },
    { key: "minutes", value: minutes, unit: "min", placeholder: "45" },
    { key: "seconds", value: seconds, unit: "sec", placeholder: "00" },
  ] as const;

  if (size === "hero") {
    return (
      <div className="grid grid-cols-3 gap-2">
        {parts.map((part) => (
          <div key={part.key} className="min-w-0">
            <HeroInput
              aria-label={`Duration ${part.unit}`}
              value={part.value}
              placeholder={part.placeholder}
              invalid={invalid}
              className="px-2 text-center"
              onChange={(e) => onChange(part.key, e.target.value)}
            />
            <p className="mt-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted/60">
              {part.unit}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {parts.map((part) => (
        <UnitInput
          key={part.key}
          aria-label={`Duration ${part.unit}`}
          value={part.value}
          unit={part.unit}
          placeholder={part.placeholder}
          invalid={invalid}
          onChange={(e) => onChange(part.key, e.target.value)}
        />
      ))}
    </div>
  );
}

/** mm:ss entry for average split per 500m. */
export function SplitInput({
  minutes,
  seconds,
  onChange,
  invalid,
}: {
  minutes: string;
  seconds: string;
  onChange: (part: "splitMinutes" | "splitSeconds", value: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <UnitInput
        aria-label="Split minutes"
        value={minutes}
        unit="min"
        placeholder="1"
        invalid={invalid}
        onChange={(e) => onChange("splitMinutes", e.target.value)}
      />
      <span className="text-lg font-semibold text-muted/60">:</span>
      <UnitInput
        aria-label="Split seconds"
        value={seconds}
        unit="sec"
        placeholder="45"
        invalid={invalid}
        onChange={(e) => onChange("splitSeconds", e.target.value)}
      />
    </div>
  );
}

/**
 * Split a stored duration string ("75", "1:15", "2:40") into the two boxes
 * ClockInput renders. Always normalises through total seconds so a legacy
 * value typed as a raw count still reads as minutes and seconds.
 */
export function clockParts(value: string): { minutes: string; seconds: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { minutes: "", seconds: "" };
  const total = parseSeconds(trimmed);
  if (total === null) return { minutes: "", seconds: trimmed };
  if (total < 60) return { minutes: "", seconds: String(Math.round(total)) };
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return { minutes: String(m), seconds: String(s).padStart(2, "0") };
}

/** Rejoin the two boxes into the single string the form state stores. */
export function joinClock(minutes: string, seconds: string): string {
  const m = minutes.trim();
  const s = seconds.trim();
  if (m === "" && s === "") return "";
  if (m === "") return s;
  if (s === "") return `${m}:00`;
  return `${m}:${s.length === 1 ? `0${s}` : s}`;
}

/**
 * Minutes + seconds, as two numeric boxes.
 *
 * A single "1:15" field would need a text keyboard on mobile to reach the
 * colon; two boxes keep the numeric keypad AND remove the ambiguity of a bare
 * "215" (is that 215 seconds or 2:15?). Same shape as SplitInput, which
 * already established this pattern for pace.
 */
export function ClockInput({
  value,
  onChange,
  invalid,
  minutesPlaceholder = "1",
  secondsPlaceholder = "15",
  ariaPrefix,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  minutesPlaceholder?: string;
  secondsPlaceholder?: string;
  ariaPrefix: string;
  className?: string;
}) {
  const { minutes, seconds } = clockParts(value);
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <UnitInput
        aria-label={`${ariaPrefix} minutes`}
        inputMode="numeric"
        value={minutes}
        placeholder={minutesPlaceholder}
        invalid={invalid}
        onChange={(e) => onChange(joinClock(e.target.value, seconds))}
        wrapperClassName="min-w-0 flex-1"
        className="h-11 px-2 text-center"
      />
      <span aria-hidden className="text-sm font-semibold text-muted/50">
        :
      </span>
      <UnitInput
        aria-label={`${ariaPrefix} seconds`}
        inputMode="numeric"
        value={seconds}
        placeholder={secondsPlaceholder}
        invalid={invalid}
        onChange={(e) => onChange(joinClock(minutes, e.target.value))}
        wrapperClassName="min-w-0 flex-1"
        className="h-11 px-2 text-center"
      />
    </div>
  );
}

/** Pill selector used for session type. */
export function PillGroup({
  options,
  value,
  onChange,
  layoutIdPrefix,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  layoutIdPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              // min-h-[40px], not the old ~30px: these are the first thing an
              // athlete taps on the cardio form now, and a 30px pill fails the
              // 44pt guidance badly enough to cause mis-taps between adjacent
              // session types.
              "relative flex min-h-[40px] items-center rounded-full px-3.5 text-[13px] font-medium transition-colors",
              active
                ? "text-accent-foreground"
                : "text-muted hover:text-foreground hover:bg-white/5"
            )}
          >
            {active && (
              <motion.span
                layoutId={`${layoutIdPrefix}-pill`}
                className="absolute inset-0 rounded-full bg-accent shadow-lg shadow-accent/30"
                transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Tappable 1–10 effort scale; tap again to clear. */
export function RpeScale({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = Number(value);
  return (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const active = selected >= n;
        const isExact = selected === n;
        return (
          <button
            key={n}
            type="button"
            aria-label={`RPE ${n}`}
            aria-pressed={isExact}
            onClick={() => onChange(isExact ? "" : String(n))}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums transition-all duration-150",
              active
                ? "border-accent/40 bg-accent/25 text-white"
                : "glass border-white/10 text-muted hover:border-white/20 hover:text-foreground",
              isExact && "bg-accent text-accent-foreground shadow-lg shadow-accent/30"
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/*
 * DerivedChip used to live here: a rounded chip that rendered NOTHING until
 * its value was parseable and then sprang itself in (AnimatePresence +
 * `layout`). Its only caller was the gym form, where that behaviour was the
 * main cause of "everything moves about when you start typing" — five of them
 * appearing on one keystroke grew the page 136px and moved the row being typed
 * into down 83px, measured at 375px. gym-form.tsx's StatCell replaced it with
 * an always-present, fixed-height slot that shows an em dash until there is a
 * value, so nothing removed it here — it simply has no callers left.
 */
