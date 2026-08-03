"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Square, AlertTriangle, Gauge, Mountain, HeartPulse, Zap, Flag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SuccessScreen, type ScoreResultSummary } from "@/components/activities/success-screen";
import { SESSION_TYPES } from "@/lib/constants/sports";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { isNativePlatform } from "@/lib/native/platform";
import { startGpsSession, stopGpsSession, recoverOrphanedSession } from "@/lib/native/gps-tracking";
import { connectHeartRateMonitor, disconnectHeartRateMonitor } from "@/lib/native/heart-rate";
import {
  PARTIAL_REASON_LABEL,
  haversineDistanceMeters,
  elevationGainMeters,
  summarizeIntervalSegments,
  summarizeFartlekSegments,
  type GpsTrackSummary,
  type GpsPoint,
  type HrReading,
  type RunSegment,
} from "@/lib/scoring/gps-track";
import type { SessionType } from "@/types";

// Leaflet touches `window` at import time — ssr: false keeps it out of the
// server render entirely rather than crashing it.
const GpsMap = dynamic(() => import("@/components/cardio/gps-map"), { ssr: false });

/** Interval/fartlek are the only session types with a designed-around hard/easy segment toggle — every other type just tracks a single continuous effort. */
const SEGMENT_TRACKED_TYPES = new Set<SessionType>(["interval", "fartlek"]);

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

type Phase = "idle" | "tracking" | "reviewing" | "overview";

/**
 * Capacitor-conversion brief, Part 3 — the payoff feature: start a run,
 * lock the phone, put it away, tracking continues via native background
 * location (see lib/native/gps-tracking.ts), not a browser tab that dies
 * the moment the screen turns off. On stop, the completed track is
 * submitted through the exact same /api/activities pipeline every manually
 * logged run goes through — one more data source, not a separate system.
 */
export default function GpsRunPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [summary, setSummary] = useState<GpsTrackSummary | null>(null);
  const [orphaned, setOrphaned] = useState<GpsTrackSummary | null>(null);
  const [livePoints, setLivePoints] = useState<GpsPoint[]>([]);
  const [sessionType, setSessionType] = useState<SessionType>("easy");
  const [segments, setSegments] = useState<RunSegment[]>([]);
  const [segmentType, setSegmentType] = useState<"hard" | "easy">("easy");
  const [hrReadings, setHrReadings] = useState<HrReading[]>([]);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [connectingHr, setConnectingHr] = useState(false);
  const [hrError, setHrError] = useState("");
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [overviewResult, setOverviewResult] = useState<ScoreResultSummary | null>(null);
  const [overviewIsPremium, setOverviewIsPremium] = useState(false);
  const startedAtRef = useRef<number>(0);
  const segmentStartRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const native = isNativePlatform();
  const isSegmentTracked = SEGMENT_TRACKED_TYPES.has(sessionType);

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

  // Live distance/pace during tracking — the same haversine sum the final
  // summary uses, just run incrementally over whatever points have arrived
  // so far, so the bottom-half metrics aren't just a stopwatch.
  const liveDistanceMeters = useMemo(() => {
    let total = 0;
    for (let i = 1; i < livePoints.length; i++) {
      total += haversineDistanceMeters(livePoints[i - 1], livePoints[i]);
    }
    return total;
  }, [livePoints]);

  const liveElevationGainMeters = useMemo(() => elevationGainMeters(livePoints), [livePoints]);

  const livePaceSecondsPerKm =
    liveDistanceMeters > 0 ? elapsedSeconds / (liveDistanceMeters / 1000) : null;

  async function handleConnectHeartRate() {
    if (connectingHr) return;
    setConnectingHr(true);
    setHrError("");
    try {
      const device = await connectHeartRateMonitor((reading) => {
        setLiveBpm(reading.bpm);
        setHrReadings((prev) => [...prev, reading]);
      });
      setHrDeviceName(device.name);
    } catch {
      setHrError("Couldn't connect — make sure the monitor is on and in pairing range.");
    } finally {
      setConnectingHr(false);
    }
  }

  async function handleDisconnectHeartRate() {
    await disconnectHeartRateMonitor();
    setHrDeviceName(null);
    setLiveBpm(null);
  }

  async function handleStart() {
    if (starting) return; // guards against a double-tap firing two watchers
    setStarting(true);
    setError("");
    setLivePoints([]);
    setSegments([]);
    setSegmentType("easy");
    setHrReadings([]);
    try {
      await startGpsSession((point) => setLivePoints((prev) => [...prev, point]));
      startedAtRef.current = Date.now();
      segmentStartRef.current = startedAtRef.current;
      setPhase("tracking");
      tickRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } finally {
      setStarting(false);
    }
  }

  /** Marks the boundary between a hard and easy effort — the only UI interaction interval/fartlek tracking adds beyond a plain run. */
  function toggleSegment() {
    const now = Date.now();
    setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
    segmentStartRef.current = now;
    setSegmentType((t) => (t === "hard" ? "easy" : "hard"));
  }

  async function handleStop() {
    if (stopping) return;
    setStopping(true);
    try {
      if (tickRef.current) clearInterval(tickRef.current);
      // Close whatever segment was open at the moment of stopping, so the
      // final hard or easy effort isn't silently dropped from scoring.
      const now = Date.now();
      if (isSegmentTracked && now > segmentStartRef.current) {
        setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
      }
      const result = await stopGpsSession();
      await disconnectHeartRateMonitor();
      setSummary(result);
      setPhase("reviewing");
    } finally {
      setStopping(false);
    }
  }

  /** Bails out of a run in progress — stops native tracking and the HR monitor same as a normal stop, but throws the track away instead of moving to review. */
  async function handleDiscardTracking() {
    if (tickRef.current) clearInterval(tickRef.current);
    setStopping(true);
    try {
      await stopGpsSession();
      await disconnectHeartRateMonitor();
    } finally {
      setStopping(false);
      resetToIdle();
    }
  }

  function handleDiscardReview() {
    resetToIdle();
  }

  function resetToIdle() {
    setPhase("idle");
    setSummary(null);
    setLivePoints([]);
    setSegments([]);
    setSegmentType("easy");
    setHrReadings([]);
    setLiveBpm(null);
    setHrDeviceName(null);
    setElapsedSeconds(0);
    setError("");
  }

  function buildOverviewResult(data: Record<string, unknown>): ScoreResultSummary {
    const sportIndex = (data.sportIndex as number | undefined) ?? 0;
    return {
      sport: "running",
      sportLabel: SPORT_INDEX_LABELS.running,
      sportIndex,
      splitIndex: (data.splitIndex as number | undefined) ?? 0,
      previousSplitIndex: (data.previousSplitIndex as number | undefined) ?? sportIndex,
      splitIndexDelta: (data.splitIndexDelta as number | undefined) ?? 0,
      enduranceIndex: (data.enduranceIndex as number | undefined) ?? 0,
      strengthIndex: (data.strengthIndex as number | undefined) ?? 0,
      sportComparison: (data.sportComparison ?? {
        history: [],
        average: sportIndex,
        percentile: 50,
        deltaVsAverage: 0,
        rank: 1,
        total: 0,
      }) as ScoreResultSummary["sportComparison"],
      isFirstSportSession: (data.isFirstSportSession as boolean | undefined) ?? true,
      splitBreakdownLabel: (data.splitBreakdownLabel as string | undefined) ?? null,
      scoreBreakdown: data.scoreBreakdown as ScoreResultSummary["scoreBreakdown"],
      cardioEnrichment: data.cardioEnrichment as ScoreResultSummary["cardioEnrichment"],
      tier1Prediction: data.tier1Prediction as ScoreResultSummary["tier1Prediction"],
      predictedBenchmarkAfterSession:
        data.predictedBenchmarkAfterSession as ScoreResultSummary["predictedBenchmarkAfterSession"],
      sessionType,
    };
  }

  async function submitSummary(trackSummary: GpsTrackSummary, startedAtIso: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const avgHeartRate =
        hrReadings.length > 0
          ? Math.round(hrReadings.reduce((sum, r) => sum + r.bpm, 0) / hrReadings.length)
          : undefined;
      const maxHeartRate = hrReadings.length > 0 ? Math.max(...hrReadings.map((r) => r.bpm)) : undefined;

      let segmentFields: Record<string, number | undefined> = {};
      if (sessionType === "interval") {
        const seg = summarizeIntervalSegments(livePoints, hrReadings, segments);
        if (seg) {
          segmentFields = {
            interval_reps: seg.reps,
            interval_work_distance_meters: seg.workDistanceMeters,
            interval_work_seconds: seg.workSecondsPerRep,
            interval_rest_seconds: seg.restSeconds,
            interval_work_avg_hr: seg.workAvgHr ?? undefined,
          };
        }
      } else if (sessionType === "fartlek") {
        const seg = summarizeFartlekSegments(livePoints, hrReadings, segments);
        if (seg) {
          segmentFields = {
            fartlek_on_distance_meters: seg.onDistanceMeters,
            fartlek_on_seconds: seg.onSeconds,
            fartlek_on_avg_hr: seg.onAvgHr ?? undefined,
          };
        }
      }

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
          avg_heart_rate: avgHeartRate,
          max_heart_rate: maxHeartRate,
          session_type: sessionType,
          source: "gps",
          is_partial_track: trackSummary.isPartial,
          ...segmentFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save this run. Please try again.");
        setSaving(false);
        return;
      }
      setOverviewIsPremium(!data.premium_required);
      setOverviewResult(buildOverviewResult(data));
      setPhase("overview");
    } catch {
      setError("Could not save this run. Please try again.");
    } finally {
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

  if (phase === "overview" && overviewResult) {
    return (
      <SuccessScreen
        result={overviewResult}
        onLogAnother={resetToIdle}
        isPremium={overviewIsPremium}
        redirectPath="/cardio"
      />
    );
  }

  // Tracking is a full-bleed overlay (escapes the app shell's padded content
  // area entirely) rather than a card in the normal page flow — the map
  // needs real screen real estate to be legible while running, not a
  // 200px-tall preview. landscape: variants split map/metrics side-by-side
  // instead of stacking them, since a portrait-only layout squishes both
  // panes into unusable slivers when the phone is rotated.
  if (phase === "tracking") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background landscape:flex-row">
        <div className="relative h-1/2 w-full shrink-0 landscape:h-full landscape:w-1/2">
          <GpsMap points={livePoints} className="h-full w-full" />
          <div
            className="pointer-events-none absolute left-4 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
            style={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
          >
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
            Tracking — screen can lock
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-between overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 landscape:h-full landscape:justify-center landscape:gap-6 landscape:py-6">
          <div className="flex flex-1 flex-col items-center justify-center landscape:flex-none">
            <p className="index-display text-6xl font-bold tabular-nums text-white">
              {formatElapsed(elapsedSeconds)}
            </p>

            {isSegmentTracked && (
              <button
                type="button"
                onClick={toggleSegment}
                className={`mt-4 flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
                  segmentType === "hard"
                    ? "bg-danger text-white shadow-lg shadow-danger/30"
                    : "bg-white/15 text-white"
                }`}
              >
                <Zap className="h-4 w-4" fill="currentColor" />
                {segmentType === "hard" ? "Hard effort — tap for easy" : "Easy — tap to go hard"}
              </button>
            )}

            <div className="mt-8 grid w-full max-w-xs grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl border border-white/15 bg-white/10 py-3">
                <p className="micro-label text-white/70">Distance</p>
                <p className="text-2xl font-bold tabular-nums text-white">
                  {(liveDistanceMeters / 1000).toFixed(2)} km
                </p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 py-3">
                <p className="micro-label text-white/70">Pace</p>
                <p className="text-2xl font-bold tabular-nums text-white">{formatPace(livePaceSecondsPerKm)}</p>
              </div>
              {liveElevationGainMeters !== null && (
                <div className="rounded-2xl border border-white/15 bg-white/10 py-3">
                  <p className="micro-label text-white/70">Elevation</p>
                  <p className="text-2xl font-bold tabular-nums text-white">
                    {Math.round(liveElevationGainMeters)} m
                  </p>
                </div>
              )}
              {liveBpm !== null && (
                <div className="rounded-2xl border border-white/15 bg-white/10 py-3">
                  <p className="micro-label text-white/70">Heart rate</p>
                  <p className="text-2xl font-bold tabular-nums text-white">{liveBpm} bpm</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDiscardTracking}
              disabled={stopping}
            >
              Discard
            </Button>
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              aria-label="Stop run"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition-transform active:scale-95 disabled:opacity-60"
            >
              <Square className="h-6 w-6" fill="currentColor" />
            </button>
          </div>
        </div>
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
            <p className="mb-6 max-w-xs text-sm text-muted">
              Background location tracking continues even with the screen off — put your phone away
              once you start.
            </p>

            <Select
              label="Session type"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as SessionType)}
              options={SESSION_TYPES}
              className="mb-2 w-full max-w-xs"
            />
            {isSegmentTracked && (
              <p className="mb-6 max-w-xs text-xs text-muted">
                Tracking will show a Hard/Easy toggle so you can mark each effort as it happens —
                pace and heart rate are captured separately for work vs. rest.
              </p>
            )}

            <div className="mb-8 w-full max-w-xs">
              {hrDeviceName ? (
                <div className="flex items-center justify-between rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 font-medium text-white">
                    <HeartPulse className="h-4 w-4 text-danger" />
                    {hrDeviceName}
                  </span>
                  <button type="button" onClick={handleDisconnectHeartRate} className="text-xs text-white/70 hover:text-white">
                    Disconnect
                  </button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  loading={connectingHr}
                  onClick={handleConnectHeartRate}
                >
                  <HeartPulse className="h-4 w-4" />
                  Connect heart rate monitor
                </Button>
              )}
              {hrError && <p className="mt-2 text-xs text-danger">{hrError}</p>}
              <p className="mt-2 text-xs text-muted">
                Works with Garmin watches and Polar/Wahoo-style chest straps (standard Bluetooth
                heart rate broadcast). Whoop doesn&apos;t broadcast to third-party apps, so it
                can&apos;t pair here.
              </p>
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              aria-label="Start run"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl shadow-accent/30 transition-transform active:scale-95 disabled:opacity-60"
            >
              <span className="text-sm font-bold uppercase tracking-wide">
                {starting ? "…" : "Start"}
              </span>
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
            <div className="flex flex-col items-center rounded-2xl border border-white/15 bg-white/10 py-4 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-cardio-accent/20 text-cardio-accent">
                <MapPin className="h-4.5 w-4.5" />
              </div>
              <p className="micro-label text-white/70">Distance</p>
              <p className="text-2xl font-bold tabular-nums text-white">{(summary.distanceMeters / 1000).toFixed(2)} km</p>
            </div>
            <div className="flex flex-col items-center rounded-2xl border border-white/15 bg-white/10 py-4 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Gauge className="h-4.5 w-4.5" />
              </div>
              <p className="micro-label text-white/70">Pace</p>
              <p className="text-2xl font-bold tabular-nums text-white">{formatPace(summary.avgPaceSecondsPerKm)}</p>
            </div>
            {summary.elevationGainMeters !== null && (
              <div className="flex flex-col items-center rounded-2xl border border-white/15 bg-white/10 py-4 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-warning/20 text-warning">
                  <Mountain className="h-4.5 w-4.5" />
                </div>
                <p className="micro-label text-white/70">Elevation gain</p>
                <p className="text-2xl font-bold tabular-nums text-white">{Math.round(summary.elevationGainMeters)} m</p>
              </div>
            )}
            {hrReadings.length > 0 && (
              <div className="flex flex-col items-center rounded-2xl border border-white/15 bg-white/10 py-4 text-center">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-danger/20 text-danger">
                  <HeartPulse className="h-4.5 w-4.5" />
                </div>
                <p className="micro-label text-white/70">Avg heart rate</p>
                <p className="text-2xl font-bold tabular-nums text-white">
                  {Math.round(hrReadings.reduce((sum, r) => sum + r.bpm, 0) / hrReadings.length)} bpm
                </p>
              </div>
            )}
          </div>

          {isSegmentTracked && segments.filter((s) => s.type === "hard").length > 0 && (
            <div className="mb-6 flex items-start gap-2 rounded-xl border border-accent/25 bg-accent/5 p-3 text-xs text-foreground/90">
              <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                {segments.filter((s) => s.type === "hard").length} hard effort
                {segments.filter((s) => s.type === "hard").length === 1 ? "" : "s"} logged — your score
                will be calibrated off the work-effort pace and heart rate, not the whole-session
                average.
              </span>
            </div>
          )}

          <p className="mb-4 text-sm text-muted">
            Session type: <span className="font-medium text-foreground/90">{SESSION_TYPES.find((s) => s.value === sessionType)?.label ?? sessionType}</span>
          </p>

          {error && <p className="mb-3 text-sm text-danger">{error}</p>}

          <div className="flex gap-3">
            <Button variant="destructive" onClick={handleDiscardReview} disabled={saving}>
              Discard
            </Button>
            <Button
              className="flex-1"
              loading={saving}
              onClick={() =>
                submitSummary(summary, new Date(Date.now() - summary.durationSeconds * 1000).toISOString())
              }
            >
              Save run
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
