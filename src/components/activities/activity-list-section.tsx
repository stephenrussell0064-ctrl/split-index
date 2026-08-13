import Link from "next/link";
import type { RoutePoint } from "@/lib/scoring/gps-track";
import { RouteMap } from "@/components/activities/route-map";
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
  /** Present only for runs recorded by Split Index's own GPS tracker. */
  route?: RoutePoint[] | null;
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
              {/* The run's own route, for sessions Split Index tracked itself.
                  Sits inline in the row rather than behind a tap: recognising
                  a run by its shape is faster than reading its date, and that
                  is the whole reason to want a map in a logbook. */}
              {a.route && a.route.length >= 2 && (
                <RouteMap
                  route={a.route}
                  className="h-16 w-16 shrink-0 sm:h-20 sm:w-24"
                  ariaLabel={`Route map for the run on ${format(new Date(a.started_at), "MMMM d, yyyy")}`}
                />
              )}
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
