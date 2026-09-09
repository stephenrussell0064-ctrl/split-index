"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { fieldDescribedBy, fieldInvalid } from "@/lib/a11y/field-describedby";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /**
   * Classes for the label+control+message wrapper, which is what a surrounding
   * flex row or grid actually lays out.
   *
   * `className` goes to the `<input>` itself and always has. That is right for
   * anything about the control — colour, height, text alignment — and wrong for
   * anything about how the field is sized within a row, because the input is
   * `w-full` inside its own column wrapper and never a child of the caller's
   * row at all.
   *
   * Callers passed `flex-[2]`, `flex-1` and `flex-[1.3]` here expecting to set
   * column widths. Those landed on the input, inside a `flex flex-col`, where
   * `flex-[1.3]` means `flex-basis: 0%` on the HEIGHT — so the field silently
   * kept its default width and lost its height instead. Visible in the
   * onboarding cardio row as one input shorter than the two beside it.
   */
  wrapperClassName?: string;
}

const labelClass =
  "text-[11px] font-medium uppercase tracking-[0.1em] text-muted";

export function Input({
  label,
  error,
  hint,
  className,
  wrapperClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: InputProps) {
  /*
    A UNIQUE id per instance, not one derived from the label text.

    `label?.toLowerCase().replace(/\s+/g, "-")` gives every "Weight" field on a
    page the id `weight` — and the audit found 195 inputs sharing 29 ids that
    way. Duplicate ids make `htmlFor` ambiguous, so a screen reader (and a
    click on the label) reaches whichever one the browser saw first, which for
    a repeated row is never the one the user is looking at.

    An explicit `id` still wins, for the callers that genuinely need to name
    their field for something else to point at.
  */
  const generatedId = useId();
  const inputId = id ?? generatedId;

  /*
    N7 item 3. `role="alert"` on the error already announces it when it appears;
    these ids are what keep it attached to the field afterwards, for the user
    who tabs back to it or who arrives with the error already rendered.
  */
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const showHint = Boolean(hint) && !error;

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      {label && (
        <label htmlFor={inputId} className={labelClass}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={fieldInvalid(Boolean(error))}
        aria-describedby={fieldDescribedBy({
          caller: describedBy,
          hintId,
          errorId,
          hasHint: Boolean(hint),
          hasError: Boolean(error),
        })}
        className={cn(
          // text-base (16px), not text-sm — iOS auto-zooms into any input
          // whose font-size is under 16px, and since this is an SPA (no
          // full page reload on navigation) that zoom doesn't reset when
          // you leave the page, leaving the whole app looking "zoomed in
          // and not fitting" afterward.
          "h-11 w-full rounded-xl glass px-4 text-base text-foreground placeholder:text-muted/40",
          "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
          "transition-all duration-200",
          error && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
          className
        )}
        {...props}
      />
      {showHint && (
        <p id={hintId} className="text-xs text-muted/80">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  /** Classes for the field wrapper — see `Input`. */
  wrapperClassName?: string;
}

export function Select({
  label,
  error,
  options,
  className,
  wrapperClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: SelectProps) {
  // Same reasoning as Input above.
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      {label && (
        <label htmlFor={selectId} className={labelClass}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={fieldInvalid(Boolean(error))}
          aria-describedby={fieldDescribedBy({
            caller: describedBy,
            errorId,
            hasError: Boolean(error),
          })}
          className={cn(
            "h-11 w-full rounded-xl glass px-4 pr-9 text-base text-foreground",
            "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
            "transition-all duration-200 appearance-none cursor-pointer",
            error && "border-danger/50",
            className
          )}
          {...props}
        >
          {/*
            The option background has to follow the zone, not be pinned dark.
            `bg-slate-900` was hardcoded here, and The Engine is a LIGHT theme
            whose text token is near-black — so every dropdown on /cardio
            rendered dark text on a dark list at about 1:1 contrast, i.e.
            invisible. `mode-surface-elevated` is the existing escape hatch for
            exactly this (dark by default, white under [data-mode="cardio"]),
            and `text-foreground` follows it.
          */}
          {options.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              className="mode-surface-elevated text-foreground"
            >
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /** Classes for the field wrapper — see `Input`. */
  wrapperClassName?: string;
}

export function Textarea({
  label,
  error,
  className,
  wrapperClassName,
  id,
  "aria-describedby": describedBy,
  ...props
}: TextareaProps) {
  // Same reasoning as Input above.
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      {label && (
        <label htmlFor={textareaId} className={labelClass}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        aria-invalid={fieldInvalid(Boolean(error))}
        aria-describedby={fieldDescribedBy({
          caller: describedBy,
          errorId,
          hasError: Boolean(error),
        })}
        className={cn(
          "min-h-[100px] w-full rounded-xl glass px-4 py-3 text-base text-foreground placeholder:text-muted/40",
          "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
          "transition-all duration-200 resize-none",
          error && "border-danger/50",
          className
        )}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
