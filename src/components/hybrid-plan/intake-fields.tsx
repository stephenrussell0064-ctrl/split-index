"use client";

import { cn } from "@/lib/utils/cn";

/**
 * Intake form primitives.
 *
 * The one that matters is `Field`'s `why` prop, and it is required rather than
 * optional. Design rule 4 from the spec: "Every question states why it is
 * asked. A one-line 'why we ask' under each field measurably improves
 * completion and is the difference between an intake and an interrogation."
 * Making it a required prop means a question cannot be added without one.
 */

export function Field({
  label,
  why,
  children,
  required,
}: {
  label: string;
  /** Required by design — see the module note. */
  why: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="border-b border-white/[0.05] py-4 last:border-0">
      <label className="block text-sm font-medium text-foreground">
        {label}
        {/* Non-breaking space so a long question cannot wrap the asterisk onto
            a line of its own, where it reads as a bullet point. */}
        {required && (
          <span className="text-danger" aria-label="required">
            &nbsp;*
          </span>
        )}
      </label>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{why}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/**
 * A yes/no question with THREE states, not two. "Unanswered" has to be
 * distinguishable from "no", because every unanswered safety question
 * resolves conservatively and a default-to-no toggle would silently convert
 * "we never asked" into "they said no".
 */
export function YesNo({
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  value: boolean | null;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div className="flex gap-2" role="group">
      {[
        { v: true, label: yesLabel },
        { v: false, label: noLabel },
      ].map(({ v, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "min-h-11 flex-1 rounded-xl border px-4 text-sm font-medium transition-colors",
            value === v
              ? v
                ? "border-warning/40 bg-warning/15 text-warning"
                : "border-endurance/40 bg-endurance/15 text-endurance"
              : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
      {value == null && <span className="self-center text-xs italic text-muted/70">not answered</span>}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  placeholder,
  ariaLabel,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="min-h-11 w-32 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm tabular-nums text-foreground focus:border-accent focus:outline-none"
      />
      {suffix && <span className="text-sm text-muted">{suffix}</span>}
    </div>
  );
}

export function MultiSelect({
  options,
  selected,
  onChange,
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  ariaLabel?: string;
}) {
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => toggle(option.value)}
          aria-pressed={selected.includes(option.value)}
          className={cn(
            "min-h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors",
            selected.includes(option.value)
              ? "border-accent/40 bg-accent/15 text-accent"
              : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <select
      value={value ?? ""}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground focus:border-accent focus:outline-none"
    >
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A value Split Index already holds, shown for confirmation rather than
 * re-entry. Design rule 1. Rendering these as read-only with a route to the
 * place they're edited is what keeps the flow to fourteen real questions.
 */
export function Prefilled({
  label,
  value,
  source,
  missing,
}: {
  label: string;
  value: string | null;
  source: string;
  missing?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-3 last:border-0">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted">{source}</p>
      </div>
      {value != null ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
      ) : (
        <span className="shrink-0 text-right text-xs italic text-warning/90">{missing ?? "not set"}</span>
      )}
    </div>
  );
}

/** Wire shape for one day's window — snake_case to match `day_windows` as stored (see `parseDayWindows` in `hpe/intake-record.ts`). */
export interface DayWindowValue {
  day: string;
  available: boolean;
  start_hour: number;
  end_hour: number;
  two_sessions: boolean;
}

/**
 * Per-day training windows, Mon-Sun. Real clock times differ by day, and the
 * six-hour separation rule between a hard lift and a hard run is computed
 * from them — collapsing a week to one AM/PM pair throws away exactly what
 * that rule depends on. A day left unavailable here still falls back to the
 * flat hours elsewhere in Availability, so nothing here is required.
 */
export function DayWindowsEditor({
  days,
  value,
  onChange,
}: {
  days: readonly string[];
  value: DayWindowValue[];
  onChange: (value: DayWindowValue[]) => void;
}) {
  const forDay = (day: string): DayWindowValue =>
    value.find((w) => w.day === day) ?? { day, available: false, start_hour: 7, end_hour: 18, two_sessions: false };

  const update = (day: string, patch: Partial<DayWindowValue>) => {
    const next = { ...forDay(day), ...patch };
    onChange([...value.filter((w) => w.day !== day), next]);
  };

  return (
    <div className="space-y-2" role="group" aria-label="Per-day training windows">
      {days.map((day) => {
        const w = forDay(day);
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <span className="w-10 shrink-0 text-sm font-medium">{day}</span>
            <button
              type="button"
              onClick={() => update(day, { available: !w.available })}
              aria-pressed={w.available}
              className={cn(
                "min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors",
                w.available
                  ? "border-endurance/40 bg-endurance/15 text-endurance"
                  : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
              )}
            >
              {w.available ? "Available" : "Rest day"}
            </button>
            {/* Hours and the two-sessions toggle only mean something once the day is available — hiding them otherwise keeps a rest day reading as a rest day. */}
            {w.available && (
              <>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={w.start_hour}
                    min={0}
                    max={23}
                    aria-label={`${day} earliest start hour`}
                    onChange={(e) => update(day, { start_hour: Math.min(23, Math.max(0, Number(e.target.value))) })}
                    className="min-h-9 w-14 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none"
                  />
                  <span className="text-xs text-muted">to</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={w.end_hour}
                    min={0}
                    max={23}
                    aria-label={`${day} latest end hour`}
                    onChange={(e) => update(day, { end_hour: Math.min(23, Math.max(0, Number(e.target.value))) })}
                    className="min-h-9 w-14 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => update(day, { two_sessions: !w.two_sessions })}
                  aria-pressed={w.two_sessions}
                  className={cn(
                    "min-h-9 rounded-lg border px-3 text-xs font-medium transition-colors",
                    w.two_sessions
                      ? "border-accent/40 bg-accent/15 text-accent"
                      : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
                  )}
                >
                  Two sessions possible
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Minutes:seconds input for a target time — athletes think in 17:30, not 1050. */
export function DurationField({
  seconds,
  onChange,
  ariaLabel,
}: {
  seconds: number | null;
  onChange: (seconds: number | null) => void;
  ariaLabel?: string;
}) {
  const mins = seconds != null ? Math.floor(seconds / 60) : null;
  const secs = seconds != null ? seconds % 60 : null;

  const update = (m: number | null, s: number | null) => {
    if (m == null && s == null) return onChange(null);
    onChange((m ?? 0) * 60 + (s ?? 0));
  };

  return (
    <div className="flex items-center gap-2" aria-label={ariaLabel}>
      <input
        type="number"
        inputMode="numeric"
        value={mins ?? ""}
        min={0}
        aria-label="Minutes"
        onChange={(e) => update(e.target.value === "" ? null : Number(e.target.value), secs)}
        className="min-h-11 w-20 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm tabular-nums focus:border-accent focus:outline-none"
      />
      <span className="text-muted">:</span>
      <input
        type="number"
        inputMode="numeric"
        value={secs ?? ""}
        min={0}
        max={59}
        aria-label="Seconds"
        onChange={(e) => update(mins, e.target.value === "" ? null : Number(e.target.value))}
        className="min-h-11 w-20 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm tabular-nums focus:border-accent focus:outline-none"
      />
    </div>
  );
}
