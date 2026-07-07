"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

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

export function Field({ label, error, hint, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <MicroLabel htmlFor={htmlFor}>{label}</MicroLabel>
      {children}
      {hint && !error && <p className="text-xs text-muted/70">{hint}</p>}
      <FieldError error={error} />
    </div>
  );
}

const inputBase =
  "h-11 w-full rounded-xl glass px-4 text-sm text-foreground placeholder:text-muted/40 " +
  "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 " +
  "transition-colors duration-200 outline-none tabular-nums";

export function GlassInput({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        inputBase,
        invalid && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
        className
      )}
      {...props}
    />
  );
}

/** Numeric-friendly input: inputMode decimal, unit suffix inside the field. */
export function UnitInput({
  unit,
  invalid,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  unit?: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(
          inputBase,
          unit && "pr-14",
          invalid && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
          className
        )}
        {...props}
      />
      {unit && (
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs uppercase tracking-wider text-muted/60">
          {unit}
        </span>
      )}
    </div>
  );
}

/** Forgiving duration entry: separate H / M / S boxes. */
export function DurationInput({
  hours,
  minutes,
  seconds,
  onChange,
  invalid,
}: {
  hours: string;
  minutes: string;
  seconds: string;
  onChange: (part: "hours" | "minutes" | "seconds", value: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(
        [
          { key: "hours", value: hours, unit: "hr", placeholder: "0" },
          { key: "minutes", value: minutes, unit: "min", placeholder: "45" },
          { key: "seconds", value: seconds, unit: "sec", placeholder: "00" },
        ] as const
      ).map((part) => (
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
              "relative rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
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

/** Live derived metric chip (pace / split / speed / 1RM). */
export function DerivedChip({
  label,
  value,
  tone = "accent",
}: {
  label: string;
  value: string | null;
  tone?: "accent" | "endurance" | "strength";
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {value && (
        <motion.div
          key={label}
          layout
          initial={{ opacity: 0, scale: 0.92, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 4 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
          className={cn(
            "inline-flex items-baseline gap-2 rounded-full border px-3.5 py-1.5",
            tone === "accent" && "border-accent/25 bg-accent/10",
            tone === "endurance" && "border-endurance/25 bg-endurance/10",
            tone === "strength" && "border-strength/25 bg-strength/10"
          )}
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
            {label}
          </span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              tone === "accent" && "text-accent",
              tone === "endurance" && "text-endurance",
              tone === "strength" && "text-strength"
            )}
          >
            {value}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
