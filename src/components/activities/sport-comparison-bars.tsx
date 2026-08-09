/**
 * Zone-themed horizontal bar comparison — user feedback (Slice 10): "please
 * redesign this page so that it is more easy for users to view their
 * logbook, their scores, and the comparison between the different scoring
 * of their sports." The Engine and Lab pages previously listed these
 * numbers as plain text rows with no visual sense of scale between them;
 * bar width now encodes the comparison directly, not just the digits.
 */
interface ComparisonItem {
  label: string;
  value: number;
  sublabel?: string;
  /** Pre-formatted display string for `value` — falls back to the raw number. */
  displayValue?: string;
}

export function SportComparisonBars({
  items,
  zone,
}: {
  items: ComparisonItem[];
  zone: "gym" | "cardio";
}) {
  if (items.length === 0) return null;

  const isGym = zone === "gym";
  const max = Math.max(...items.map((i) => i.value), 1);
  const trackClass = isGym ? "bg-gym-border/25" : "bg-cardio-border/25";
  const barClass = isGym ? "bg-gym-accent" : "bg-cardio-accent";
  const textClass = isGym ? "text-gym-text" : "text-cardio-text";
  const mutedClass = isGym ? "text-gym-muted" : "text-cardio-muted";

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-medium capitalize ${textClass}`}>{item.label}</span>
            <span className={`font-mono text-sm font-semibold tabular-nums ${textClass}`}>
              {item.displayValue ?? item.value}
            </span>
          </div>
          <div className={`mt-1.5 h-2 w-full overflow-hidden rounded-full ${trackClass}`}>
            <div
              className={`h-full rounded-full ${barClass}`}
              style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
            />
          </div>
          {item.sublabel && <p className={`mt-1 text-xs ${mutedClass}`}>{item.sublabel}</p>}
        </li>
      ))}
    </ul>
  );
}
