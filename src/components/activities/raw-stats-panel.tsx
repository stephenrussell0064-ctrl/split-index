import { Clock, MapPin, Gauge, Mountain, HeartPulse, Thermometer, Footprints } from "lucide-react";
import { formatDuration, formatDistance, formatPace, formatSpeed } from "@/lib/utils/format";
import type { SportType } from "@/types";

/** Cycling shows speed (km/h); every other endurance sport shows pace (min/km) — same stored avg_pace_seconds_per_km number either way. */
function paceOrSpeed(sport: SportType, secondsPerKm: number): { label: string; value: string } {
  return sport === "outdoor_cycling"
    ? { label: "Speed", value: formatSpeed(secondsPerKm) }
    : { label: "Pace", value: formatPace(secondsPerKm) };
}

/** Rowing/ski-erg sports think in split (min:sec per 500m), a distinct stored column from avg_pace_seconds_per_km — the latter is never populated for these sports at all. */
const SPLIT_SPORTS = new Set<SportType>(["rowing", "ski_erg"]);

function formatSplit(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")} /500m`;
}

interface RawStatsPanelProps {
  sport: SportType;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationMeters: number | null;
  avgHeartRate: number | null;
  avgPaceSecondsPerKm: number | null;
  avgSplitSeconds: number | null;
  avgCadence: number | null;
  temperatureCelsius: number | null;
}

/**
 * Raw, un-gated session stats (distance, time, elevation, avg HR, avg pace/
 * speed, temperature, cadence) for any cardio activity — previously none of
 * these stored columns were rendered on the activity detail page at all,
 * only derived/premium-gated enrichment metrics (user feedback: this data
 * should be visible on the logbook when clicking into a run).
 *
 * Avg pace/split gets its own hero row above the tile grid (user feedback:
 * "add an average split metric, this should be the main metric for
 * activities in general") — it's the one number that answers "how fast was
 * this session" at a glance, the same way Session Index answers "how good"
 * further down the page, so it gets equivalent visual weight instead of
 * being just one tile among duration/elevation/cadence/temperature.
 */
export function RawStatsPanel({
  sport,
  durationSeconds,
  distanceMeters,
  elevationMeters,
  avgHeartRate,
  avgPaceSecondsPerKm,
  avgSplitSeconds,
  avgCadence,
  temperatureCelsius,
}: RawStatsPanelProps) {
  const pace = avgPaceSecondsPerKm !== null ? paceOrSpeed(sport, avgPaceSecondsPerKm) : null;
  const split = SPLIT_SPORTS.has(sport) && avgSplitSeconds !== null ? formatSplit(avgSplitSeconds) : null;
  // Split (row/ski-erg) takes priority when both happen to be present —
  // pace-per-km is never actually populated for those sports (see
  // SPLIT_SPORTS's doc comment), but stay defensive rather than assume.
  // Everything pace-based (running, walking, swimming, bike/ski erg) is
  // labeled "Avg split" too, not "Avg pace" — user feedback asked for
  // "average split" as the headline metric for activities in general, and
  // runners commonly call their per-km time a "split" regardless of sport.
  // Only true speed-based sports (outdoor cycling) keep "Avg speed".
  const hero = split
    ? { label: "Avg split", value: split }
    : pace
      ? { label: pace.label === "Speed" ? "Avg speed" : "Avg split", value: pace.value }
      : null;
  /** Cadence only means anything on foot — cycling cadence is pedal RPM, a different sensor entirely. */
  const showCadence = avgCadence !== null && sport !== "outdoor_cycling";

  const tiles = [
    { label: "Duration", value: formatDuration(durationSeconds), icon: Clock },
    distanceMeters !== null
      ? { label: "Distance", value: formatDistance(distanceMeters), icon: MapPin }
      : null,
    elevationMeters !== null
      ? { label: "Elevation gain", value: `${Math.round(elevationMeters)} m`, icon: Mountain }
      : null,
    avgHeartRate !== null
      ? { label: "Avg heart rate", value: `${avgHeartRate} bpm`, icon: HeartPulse }
      : null,
    showCadence ? { label: "Avg cadence", value: `${avgCadence} spm`, icon: Footprints } : null,
    temperatureCelsius !== null
      ? { label: "Temperature", value: `${temperatureCelsius}°C`, icon: Thermometer }
      : null,
  ].filter((tile): tile is { label: string; value: string; icon: typeof Clock } => tile !== null);

  if (tiles.length === 0 && !hero) return null;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 mb-6">
      <p className="micro-label text-muted mb-4">Session stats</p>
      {hero && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-cardio-border/30 bg-cardio-bg-elevated/10 px-5 py-4">
          <Gauge className="h-6 w-6 shrink-0 text-cardio-accent" />
          <div>
            <p className="micro-label text-muted/70">{hero.label}</p>
            <p className="font-display text-3xl font-bold tabular-nums text-cardio-accent">{hero.value}</p>
          </div>
        </div>
      )}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] py-3 text-center"
            >
              <Icon className="mb-1.5 h-4 w-4 text-muted" />
              <p className="micro-label text-muted/70">{label}</p>
              <p className="text-lg font-bold tabular-nums text-foreground/90">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
