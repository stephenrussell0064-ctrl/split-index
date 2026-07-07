const ITEMS = [
  { tone: "gym" as const, stat: "DOTS 412.6", label: "Top 21% worldwide" },
  { tone: "cardio" as const, stat: "EF +9.4%", label: "90-day efficiency" },
  { tone: "gym" as const, stat: "2.3× BW", label: "Deadlift ratio" },
  { tone: "cardio" as const, stat: "Negative split", label: "Last 5K verified" },
  { tone: "gym" as const, stat: "+31 pts", label: "8-session climb" },
  { tone: "cardio" as const, stat: "Decoupling 3.1%", label: "Aerobic health" },
];

export function DataTicker() {
  return (
    <div
      className="overflow-hidden border-y border-white/[0.07] bg-white/[0.02] py-4"
      role="region"
      aria-label="Athlete performance highlights"
    >
      <div className="ticker-track flex w-max gap-16 whitespace-nowrap motion-reduce:transform-none">
        {ITEMS.map((item, i) => (
          <span
            key={`${item.stat}-a-${i}`}
            className="flex items-center gap-3.5 text-xs uppercase tracking-[0.22em] text-white/45"
          >
            <strong
              className={`font-display text-sm font-bold tracking-wide ${
                item.tone === "gym" ? "text-gym-accent" : "text-cardio-accent"
              }`}
            >
              {item.stat}
            </strong>
            {item.label}
            <span className="h-1 w-1 rounded-full bg-white/25" />
          </span>
        ))}
        {ITEMS.map((item, i) => (
          <span
            key={`${item.stat}-b-${i}`}
            aria-hidden="true"
            className="flex items-center gap-3.5 text-xs uppercase tracking-[0.22em] text-white/45"
          >
            <strong
              className={`font-display text-sm font-bold tracking-wide ${
                item.tone === "gym" ? "text-gym-accent" : "text-cardio-accent"
              }`}
            >
              {item.stat}
            </strong>
            {item.label}
            <span className="h-1 w-1 rounded-full bg-white/25" />
          </span>
        ))}
      </div>
    </div>
  );
}
