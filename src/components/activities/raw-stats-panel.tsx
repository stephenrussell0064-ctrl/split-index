import { Clock, MapPin, Gauge, Mountain, HeartPulse, Thermometer, Footprints } from "lucide-react";
import { formatDuration, formatDistance, formatSportPace } from "@/lib/utils/format";
import type { SportType } from "@/types";

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
  // One formatter, shared with the logbook. This panel used to carry its own
  // pair — a per-km `formatPace` and a per-500m `formatSplit` for the ergs —
  // which is why a swim read "/km" here and in the list: neither copy knew
  // swimming is conventionally per 100m, and the two had already drifted on
  // spacing ("2:04/500m" against "2:04 /500m"). formatSportPace picks the
  // unit from the sport and prefers the ergs' own stored split column, so the
  // list and this page cannot disagree again.
  const paceValue = formatSportPace(sport, {
    avgPaceSecondsPerKm,
    avgSplitSeconds,
  });
  // "Avg split" for everything pace-based, not "Avg pace" — user feedback
  // asked for split as the headline metric generally, and runners call their
  // per-km time a split regardless of sport. Only genuinely speed-based
  // sports (outdoor cycling) keep "Avg speed".
  const hero = paceValue
    ? {
        label: sport === "outdoor_cycling" ? "Avg speed" : "Avg split",
        value: paceValue,
      }
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
