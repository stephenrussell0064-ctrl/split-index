import Link from "next/link";
import { format } from "date-fns";
import { formatIndex, formatDuration, formatDistance } from "@/lib/utils/format";
import { SPORTS } from "@/lib/constants/sports";

interface ActivityRow {
  id: string;
  sport: string;
  title: string | null;
  started_at: string;
  duration_seconds: number | null;
  distance_meters: number | null;
}

function sparklineFromId(id: string, color: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const pts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = i * 12;
    const y = 8 + ((hash >> (i * 3)) & 7) * 2;
    pts.push(`${x},${y}`);
  }
  return (
    <svg width="72" height="28" viewBox="0 0 72 28" aria-hidden className="mt-1 opacity-70">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

export function ActivityListSection({
  items,
  zone,
  scoreMap,
}: {
  items: ActivityRow[];
  zone: "gym" | "cardio";
  scoreMap: Record<string, number>;
}) {
  const isGym = zone === "gym";
  const accent = isGym ? "#3DFF6E" : "#3BA6FF";

  if (!items.length) {
    return (
      <p
        className={`text-sm py-8 text-center ${isGym ? "text-gym-muted" : "text-cardio-muted"}`}
      >
        No sessions yet
      </p>
    );
  }

  return (
    <ul className="divide-y divide-inherit">
      {items.map((a) => {
        const meta = SPORTS.find((s) => s.id === a.sport);
        const score = scoreMap[a.id];
        return (
          <li key={a.id}>
            <Link
              href={`/activities/${a.id}`}
              className={`group flex items-center gap-4 px-5 py-4 transition-colors min-h-[76px] border-l-2 border-transparent ${
                isGym
                  ? "hover:bg-gym-accent/5 hover:border-gym-accent/40"
                  : "hover:bg-cardio-accent/5 hover:border-cardio-accent/40"
              }`}
            >
              <span className="text-2xl shrink-0">{meta?.icon ?? "🏋️"}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={`font-medium truncate ${isGym ? "text-gym-text" : "text-cardio-text"}`}
                >
                  {a.title ?? meta?.name ?? a.sport}
                </p>
                <p
                  className={`text-xs tabular-nums ${isGym ? "text-gym-muted" : "text-cardio-muted"}`}
                >
                  {format(new Date(a.started_at), "MMM d, yyyy")} ·{" "}
                  {formatDuration(a.duration_seconds ?? 0)}
                  {a.distance_meters ? ` · ${formatDistance(a.distance_meters)}` : ""}
                </p>
                {sparklineFromId(a.id, accent)}
              </div>
              {score !== undefined && (
                <span
                  className={`font-display text-sm font-bold tabular-nums shrink-0 ${
                    isGym ? "text-gym-accent" : "text-cardio-accent"
                  }`}
                >
                  {formatIndex(score)}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
