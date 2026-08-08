"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Plus, Trash2, MapPin, CloudSun, Mountain, ChevronDown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { formatRiegelPrediction } from "@/lib/scoring/presentation";
import { formatDistance } from "@/lib/utils/format";

interface PlannedRace {
  id: string;
  event_name: string;
  location_name: string;
  race_date: string;
  distance_meters: number;
  elevation_gain_meters: number | null;
  daysOut: number;
  basePredictionSeconds: number | null;
  forecast: { tempMaxCelsius: number; windMaxKph: number } | null;
  adjustment: {
    adjustedSeconds: number;
    elevationPenaltySeconds: number;
    temperaturePenaltySeconds: number;
    windPenaltySeconds: number;
    notes: string[];
  } | null;
}

const COMMON_DISTANCES = [
  { label: "5K", meters: 5000 },
  { label: "10K", meters: 10000 },
  { label: "Half marathon", meters: 21097 },
  { label: "Marathon", meters: 42195 },
];

function RaceRow({ race, onDelete }: { race: PlannedRace; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{race.event_name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            {race.location_name} · {formatDistance(race.distance_meters)} ·{" "}
            {format(new Date(race.race_date), "MMM d, yyyy")} (
            {formatDistanceToNow(new Date(race.race_date), { addSuffix: true })})
          </p>
        </div>
        <button
          type="button"
          aria-label="Remove race"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            await onDelete(race.id);
          }}
          className="shrink-0 text-muted/60 hover:text-danger disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {race.basePredictionSeconds != null ? (
        <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-white/5 pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted/70">Tailored prediction</p>
            <p className="index-display text-xl font-bold tabular-nums text-accent">
              {formatRiegelPrediction(
                race.adjustment?.adjustedSeconds ?? race.basePredictionSeconds
              )}
            </p>
          </div>
          {race.adjustment && race.adjustment.notes.length > 0 && (
            <div className="min-w-0 flex-1 text-xs text-muted">
              <span className="text-muted/70">vs {formatRiegelPrediction(race.basePredictionSeconds)} flat: </span>
              {race.adjustment.notes.join(" · ")}
            </div>
          )}
          {!race.forecast && race.daysOut > 16 && (
            <p className="text-xs text-muted/70">
              Forecast unlocks ~16 days before race day
              {race.elevation_gain_meters == null && " — add elevation gain for a terrain adjustment now"}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-white/5 pt-3 text-xs text-muted">
          Keep logging so we can predict your 5K, then this race gets a tailored prediction too.
        </p>
      )}

      {(race.elevation_gain_meters != null || race.forecast) && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted/70">
          {race.elevation_gain_meters != null && (
            <span className="flex items-center gap-1">
              <Mountain className="h-3 w-3" /> {race.elevation_gain_meters}m gain
            </span>
          )}
          {race.forecast && (
            <span className="flex items-center gap-1">
              <CloudSun className="h-3 w-3" /> {Math.round(race.forecast.tempMaxCelsius)}°C ·{" "}
              {Math.round(race.forecast.windMaxKph)}km/h wind
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function UpcomingRacesPanel() {
  const [races, setRaces] = useState<PlannedRace[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [eventName, setEventName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [distanceMeters, setDistanceMeters] = useState<number>(10000);
  const [elevationGainMeters, setElevationGainMeters] = useState("");

  async function loadRaces() {
    const res = await fetch("/api/races");
    if (res.ok) {
      const data = await res.json();
      setRaces(data.races);
    }
  }

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/races");
      if (res.ok) {
        const data = await res.json();
        setRaces(data.races);
      }
    })();
  }, []);

  async function handleDelete(id: string) {
    await fetch(`/api/races/${id}`, { method: "DELETE" });
    setRaces((prev) => prev?.filter((r) => r.id !== id) ?? null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!eventName.trim() || !raceDate) {
      setSubmitError("Event name and date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/races", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName,
          locationName,
          raceDate,
          distanceMeters,
          elevationGainMeters: elevationGainMeters || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save race");
      setEventName("");
      setLocationName("");
      setRaceDate("");
      setElevationGainMeters("");
      setFormOpen(false);
      await loadRaces();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save race");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Upcoming Races</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setFormOpen((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            Add race
          </Button>
        </div>
        <p className="text-xs text-muted">
          Add a race and its published elevation profile, and we&apos;ll fold in a weather forecast
          once you&apos;re within about 16 days of race day for a more tailored prediction than a
          flat, condition-blind one.
        </p>
      </CardHeader>
      <CardContent>
        {formOpen && (
          <form onSubmit={handleSubmit} className="mb-4 space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Input
              label="Event name"
              placeholder="Dorney Lake 10K"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
            <Input
              label="Location"
              placeholder="Dorney, UK"
              hint="Used to look up a forecast closer to race day — city/venue name is enough"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Race date"
                type="date"
                value={raceDate}
                onChange={(e) => setRaceDate(e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                  Distance
                </label>
                <div className="relative">
                  <select
                    value={distanceMeters}
                    onChange={(e) => setDistanceMeters(Number(e.target.value))}
                    className="h-11 w-full appearance-none rounded-xl glass border border-white/10 px-4 pr-9 text-base text-foreground focus:border-accent/50 focus:outline-none"
                  >
                    {COMMON_DISTANCES.map((d) => (
                      <option key={d.meters} value={d.meters}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                </div>
              </div>
            </div>
            <Input
              label="Elevation gain (m) — optional"
              placeholder="From the race's published course profile"
              type="number"
              min={0}
              value={elevationGainMeters}
              onChange={(e) => setElevationGainMeters(e.target.value)}
            />
            {submitError && <p className="text-xs text-danger">{submitError}</p>}
            <Button type="submit" loading={submitting} className="w-full">
              Save race
            </Button>
          </form>
        )}

        {races === null ? (
          <p className="py-4 text-center text-sm text-muted">Loading…</p>
        ) : races.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            No upcoming races yet — add one to get a terrain- and weather-aware prediction.
          </p>
        ) : (
          <ul className="space-y-3">
            {races.map((race) => (
              <RaceRow key={race.id} race={race} onDelete={handleDelete} />
            ))}
          </ul>
        )}

        <ScoringExplainerNote className="mt-4 text-muted">
          Elevation and weather adjustments are order-of-magnitude approximations, not a precise
          simulation — nobody&apos;s model (Garmin included) can predict exactly how heat or wind
          affects a specific athlete on a specific day.
        </ScoringExplainerNote>
      </CardContent>
    </Card>
  );
}
