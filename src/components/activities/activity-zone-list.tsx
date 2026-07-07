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

export function ActivityZoneList({
  items,
  zone,
  scoreMap,
}: {
  items: ActivityRow[];
  zone: "gym" | "cardio";
  scoreMap: Record<string, number>;
}) {
  const isGym = zone === "gym";

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
              className={`flex items-center gap-4 px-5 py-4 transition-colors min-h-[72px] ${
                isGym ? "hover:bg-gym-accent/5" : "hover:bg-cardio-accent/5"
              }`}
            >
              <span className="text-2xl">{meta?.icon ?? "🏋️"}</span>
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
                  {a.distance_meters
                    ? ` · ${formatDistance(a.distance_meters)}`
                    : ""}
                </p>
              </div>
              {score !== undefined && (
                <span
                  className={`font-mono text-sm font-semibold tabular-nums ${
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
