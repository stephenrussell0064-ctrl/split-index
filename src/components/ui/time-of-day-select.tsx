"use client";

import { cn } from "@/lib/utils/cn";

/**
 * A clock time, chosen from a list, on the half hour.
 *
 * WHY THIS EXISTS. Training times were free number inputs holding a whole
 * hour, with handlers that coerced an empty field straight back to a default:
 * `onChange={(v) => set("am_hour", v ?? 7)}` in the wizard, and
 * `Number(e.target.value)` — which is 0 for "" — in the per-day editor. Both
 * mean the same thing on a device: you cannot clear the field to type a new
 * value, because the instant it goes empty the old number is written back.
 * Reported as the morning time being impossible to change.
 *
 * A select removes the failure rather than patching it. There is no empty
 * intermediate state to coerce, no keyboard, and on iOS it opens the system
 * wheel, which is a better way to pick a time on a phone than typing digits.
 *
 * WHOLE HOURS WERE ALSO WRONG. Half past is when people actually train, and
 * the schema already allowed it — `am_hour` and `pm_hour` are NUMERIC(4,2)
 * with `CHECK (BETWEEN 0 AND 23.99)`, and `day_windows` is JSONB. So the
 * fractional value stores as-is with no migration.
 */

/** 00:00 to 23:30, every half hour. */
export const HALF_HOUR_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 48 },
  (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = i % 2 === 0 ? 0 : 30;
    return {
      value: hours + minutes / 60,
      label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    };
  },
);

/** The last representable minute of the day, 23:59, as a fractional hour. */
const END_OF_DAY = 23 + 59 / 60;

/** "7.5" -> "07:30". Used for a stored value that is not on the half hour. */
export function formatHour(value: number): string {
  /*
   * Clamped to 23:59 exactly, not to 23.999.
   *
   * 23.999 hours is 59.94 minutes, which rounds to 60 and then wraps the hour
   * — so an out-of-range value rendered as "00:00", the far end of the day
   * from where it was clamped. A clamp that lands on the opposite extreme is
   * worse than no clamp, because it looks like a real answer.
   */
  const clamped = Math.min(END_OF_DAY, Math.max(0, value));
  const hours = Math.floor(clamped);
  const minutes = Math.round((clamped - hours) * 60);
  // Still possible below the clamp: 7.999 is 59.94 minutes and must roll into
  // the next hour rather than render "07:60".
  if (minutes === 60) return `${String((hours + 1) % 24).padStart(2, "0")}:00`;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function TimeOfDaySelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  /*
   * An existing value that is not on the half hour is offered as its own
   * option rather than snapped to the nearest one.
   *
   * Snapping would rewrite an athlete's stored 07:15 to 07:00 or 07:30 the
   * first time they opened the screen, without asking and without telling
   * them — and the day_windows column is free-form JSON, so such values can
   * exist. Showing it means the select can represent what is actually stored;
   * picking anything else is then the athlete's own decision.
   */
  const onGrid = HALF_HOUR_OPTIONS.some((o) => Math.abs(o.value - value) < 1e-9);
  const options = onGrid
    ? HALF_HOUR_OPTIONS
    : [...HALF_HOUR_OPTIONS, { value, label: formatHour(value) }].sort((a, b) => a.value - b.value);

  return (
    <select
      value={String(value)}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        // text-base, never smaller: iOS zooms into any control under 16px on
        // focus and an SPA in a WebView never resets that zoom.
        "min-h-11 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-base tabular-nums text-foreground",
        // A <select> is sized by its widest option, and a flex child will not
        // shrink below that — the exact shape that has dragged three screens
        // sideways already. Every label here is five characters, so this is
        // insurance rather than a live problem, but the guard is right to
        // insist: the next person to add an option does not have to think
        // about it.
        "min-w-0 max-w-full",
        "focus:border-accent focus:outline-none",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={String(o.value)} className="mode-surface-elevated text-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}
