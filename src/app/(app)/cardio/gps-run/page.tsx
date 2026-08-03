"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { MapPin, Square, AlertTriangle, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SESSION_TYPES } from "@/lib/constants/sports";
import { isNativePlatform } from "@/lib/native/platform";
import { startGpsSession, stopGpsSession, recoverOrphanedSession } from "@/lib/native/gps-tracking";
import { PARTIAL_REASON_LABEL, type GpsTrackSummary, type GpsPoint } from "@/lib/scoring/gps-track";
import type { SessionType } from "@/types";

// Leaflet touches `window` at import time — ssr: false keeps it out of the
// server render entirely rather than crashing it.
const GpsMap = dynamic(() => import("@/components/cardio/gps-map"), { ssr: false });

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null) return "—";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

type Phase = "idle" | "tracking" | "reviewing";

/**
 * Capacitor-conversion brief, Part 3 — the payoff feature: start a run,
 * lock the phone, put it away, tracking continues via native background
 * location (see lib/native/gps-tracking.ts), not a browser tab that dies
 * the moment the screen turns off. On stop, the completed track is
 * submitted through the exact same /api/activities pipeline every manually
 * logged run goes through — one more data source, not a separate system.
 */
export default function GpsRunPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [summary, setSummary] = useState<GpsTrackSummary | null>(null);
  const [orphaned, setOrphaned] = useState<GpsTrackSummary | null>(null);
  const [livePoints, setLivePoints] = useState<GpsPoint[]>([]);
  const [sessionType, setSessionType] = useState<SessionType>("easy");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const native = isNativePlatform();

  useEffect(() => {
    if (!native) return;
    recoverOrphanedSession().then((recovered) => {
      if (recovered) setOrphaned(recovered);
    });
  }, [native]);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function handleStart() {
    setError("");
    setLivePoints([]);
    await startGpsSession((point) => setLivePoints((prev) => [...prev, point]));
    startedAtRef.current = Date.now();
    setPhase("tracking");
    tickRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
  }

  async function handleStop() {
    if (tickRef.current) clearInterval(tickRef.current);
    const result = await stopGpsSession();
    setSummary(result);
    setPhase("reviewing");
  }

  async function submitSummary(trackSummary: GpsTrackSummary, startedAtIso: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport: "running",
          started_at: startedAtIso,
          duration_seconds: trackSummary.durationSeconds,
          distance_meters: trackSummary.distanceMeters,
          elevation_meters: trackSummary.elevationGainMeters ?? undefined,
          avg_pace_seconds_per_km: trackSummary.avgPaceSecondsPerKm ?? undefined,
          session_type: sessionType,
          source: "gps",
          is_partial_track: trackSummary.isPartial,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save this run. Please try again.");
        setSaving(false);
        return;
      }
      router.push("/cardio");
    } catch {
      setError("Could not save this run. Please try again.");
      setSaving(false);
    }
  }

  if (!native) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="The Engine"
          title="GPS Run Tracking"
          subtitle="Background GPS tracking needs the Split Index app, not the website."
        />
        <Card padding="md">
          <div className="flex flex-col items-center py-8 text-center">
            <MapPin className="mb-3 h-8 w-8 text-accent/60" />
            <p className="text-sm text-muted">
              A browser tab can&apos;t keep tracking your location once the screen locks — that&apos;s
              a platform limitation, not something this page can work around. Install the Split
              Index app to track runs with your phone locked and away.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="The Engine" title="GPS Run" subtitle="Lock your phone. Tracking keeps going." />

      {orphaned && (
        <Card padding="sm" className="border border-warning/30 bg-warning/5">
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                We found a run that didn&apos;t stop normally last time
                {orphaned.distanceMeters > 0 ? ` (~${(orphaned.distanceMeters / 1000).toFixed(2)}km)` : ""}.
              </p>
              <p className="mt-1 text-xs text-warning/80">
                It&apos;ll be saved as a partial/incomplete session, not a full clean effort.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => submitSummary(orphaned, new Date(Date.now() - orphaned.durationSeconds * 1000).toISOString())}
                >
                  Save as partial
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOrphaned(null)}>
                  Discard
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {phase === "idle" && (
        <Card padding="lg">
          <div className="flex flex-col items-center py-10 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/15">
              <MapPin className="h-8 w-8 text-accent" />
            </div>
            <p className="mb-8 max-w-xs text-sm text-muted">
              Background location tracking continues even with the screen off — put your phone away
              once you start.
            </p>
            <button
              type="button"
              onClick={handleStart}
              aria-label="Start run"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl shadow-accent/30 transition-transform active:scale-95"
            >
              <span className="text-sm font-bold uppercase tracking-wide">Start</span>
            </button>
          </div>
        </Card>
      )}

      {phase === "tracking" && (
        <Card padding="lg">
          <GpsMap points={livePoints} className="mb-6 h-56 w-full overflow-hidden rounded-2xl" />

          <div className="flex flex-col items-center pb-2 text-center">
            <p className="index-display mb-2 text-6xl font-bold tabular-nums">
              {formatElapsed(elapsedSeconds)}
            </p>
            <p className="mb-10 flex items-center gap-1.5 text-xs text-muted">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
              Tracking in the background — screen can lock
            </p>
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop run"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-danger text-white shadow-xl shadow-danger/30 transition-transform active:scale-95"
            >
              <Square className="h-8 w-8" fill="currentColor" />
            </button>
          </div>
        </Card>
      )}

      {phase === "reviewing" && summary && (
        <Card padding="lg">
          {livePoints.length > 0 && (
            <GpsMap points={livePoints} className="mb-6 h-48 w-full overflow-hidden rounded-2xl" />
          )}

          {summary.isPartial && summary.partialReason && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {PARTIAL_REASON_LABEL[summary.partialReason]} — this will be saved as a partial
                session, not scored as a complete effort.
              </span>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center rounded-2xl bg-white/[0.03] py-4 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-cardio-accent/15 text-cardio-accent">
                <MapPin className="h-4.5 w-4.5" />
              </div>
              <p className="micro-label text-muted">Distance</p>
              <p className="text-2xl font-bold tabular-nums">{(summary.distanceMeters / 1000).toFixed(2)} km</p>
            </div>
            <div className="flex flex-col items-center rounded-2xl bg-white/[0.03] py-4 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Gauge className="h-4.5 w-4.5" />
              </div>
              <p className="micro-label text-muted">Pace</p>
              <p className="text-2xl font-bold tabular-nums">{formatPace(summary.avgPaceSecondsPerKm)}</p>
            </div>
          </div>

          <Select
            label="Session type"
            value={sessionType}
            onChange={(e) => setSessionType(e.target.value as SessionType)}
            options={SESSION_TYPES}
            className="mb-4"
          />

          {error && <p className="mb-3 text-sm text-danger">{error}</p>}

          <Button
            className="w-full"
            loading={saving}
            onClick={() =>
              submitSummary(summary, new Date(Date.now() - summary.durationSeconds * 1000).toISOString())
            }
          >
            Save run
          </Button>
        </Card>
      )}
    </div>
  );
}
