import { cn } from "@/lib/utils/cn";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const labelClass =
  "text-[11px] font-medium uppercase tracking-[0.1em] text-muted";

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className={labelClass}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          "h-11 w-full rounded-xl glass px-4 text-sm text-foreground placeholder:text-muted/40",
          "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
          "transition-all duration-200",
          error && "border-danger/50 focus:border-danger/50 focus:ring-danger/30",
          className
        )}
        {...props}
      />
      {hint && !error && <p className="text-xs text-muted/80">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className, id, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className={labelClass}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          "h-11 w-full rounded-xl glass px-4 text-sm text-foreground",
          "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
          "transition-all duration-200 appearance-none cursor-pointer",
          error && "border-danger/50",
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-slate-900">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, id, ...props }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className={labelClass}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cn(
          "min-h-[100px] w-full rounded-xl glass px-4 py-3 text-sm text-foreground placeholder:text-muted/40",
          "border border-white/10 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 focus:outline-none",
          "transition-all duration-200 resize-none",
          error && "border-danger/50",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
