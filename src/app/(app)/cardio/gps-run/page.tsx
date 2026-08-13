"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { MapPin, Square, AlertTriangle, Gauge, Mountain, HeartPulse, Zap, Flag, Thermometer, Footprints, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SuccessScreen, type ScoreResultSummary } from "@/components/activities/success-screen";
import { SESSION_TYPES } from "@/lib/constants/sports";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { isNativePlatform } from "@/lib/native/platform";
import { createClient } from "@/lib/supabase/client";
import { livePredictionLadder, type LivePredictionEntry } from "@/lib/scoring/cardio-activity";
import {
  startGpsSession,
  stopGpsSession,
  recoverOrphanedSession,
  type RecoveredGpsSession,
} from "@/lib/native/gps-tracking";
import { connectHeartRateMonitor, disconnectHeartRateMonitor } from "@/lib/native/heart-rate";
import {
  isAirPodsHeartRateSupported,
  startAirPodsHeartRate,
  stopAirPodsHeartRate,
} from "@/lib/native/airpods-heart-rate";
import {
  isStepCadenceSupported,
  startStepCadence,
  stopStepCadence,
} from "@/lib/native/step-cadence";
import { isLiveActivitySupported, startLiveActivity, updateLiveActivity, endLiveActivity } from "@/lib/native/live-activity";
import {
  buildRoutePolyline,
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

/** GPS tracking supports these three outdoor endurance sports — cycling shows speed instead of pace below, and cadence only applies to the two on-foot sports. */
type GpsSport = "running" | "outdoor_cycling" | "walking";

const GPS_SPORTS: { value: GpsSport; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "outdoor_cycling", label: "Outdoor Cycling" },
  { value: "walking", label: "Walking" },
];

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

/** Cyclists think in speed (km/h), not pace (min/km) — same underlying seconds-per-km number, just inverted for display. */
function formatSpeed(secondsPerKm: number | null): string {
  if (secondsPerKm === null || secondsPerKm <= 0) return "—";
  const kmh = 3600 / secondsPerKm;
  return `${kmh.toFixed(1)} km/h`;
}

/** Cycling shows speed; running/walking show pace — same stored `avgPaceSecondsPerKm` number either way. */
function formatPaceOrSpeed(sport: GpsSport, secondsPerKm: number | null): string {
  return sport === "outdoor_cycling" ? formatSpeed(secondsPerKm) : formatPace(secondsPerKm);
}

function formatRaceTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Same 0-999 tier bands used everywhere else in the app (500=Intermediate/Semi-Pro, 725=Advanced, 850=Elite) — colored so a glance at the predicted-scores strip reads at a glance, not just as a bare number. */
function scoreAccentClass(score: number): string {
  if (score >= 850) return "text-warning";
  if (score >= 725) return "text-cardio-accent";
  if (score >= 475) return "text-strength-accent";
  return "text-muted";
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
  const [orphaned, setOrphaned] = useState<RecoveredGpsSession | null>(null);
  const [livePoints, setLivePoints] = useState<GpsPoint[]>([]);
  const [sport, setSport] = useState<GpsSport>("running");
  const [sessionType, setSessionType] = useState<SessionType>("easy");
  const [segments, setSegments] = useState<RunSegment[]>([]);
  const [segmentType, setSegmentType] = useState<"hard" | "easy">("easy");
  const [hrReadings, setHrReadings] = useState<HrReading[]>([]);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [hrSource, setHrSource] = useState<"ble" | "airpods" | null>(null);
  const [connectingHr, setConnectingHr] = useState<"ble" | "airpods" | null>(null);
  const [hrError, setHrError] = useState("");
  const [liveCadence, setLiveCadence] = useState<number | null>(null);
  const [cadenceReadings, setCadenceReadings] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [overviewResult, setOverviewResult] = useState<ScoreResultSummary | null>(null);
  const [overviewIsPremium, setOverviewIsPremium] = useState(false);
  const [profile, setProfile] = useState<{
    restingHr: number | null;
    maxHr: number | null;
    sex: "male" | "female";
  } | null>(null);
  const startedAtRef = useRef<number>(0);
  const segmentStartRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const native = isNativePlatform();
  const isSegmentTracked = SEGMENT_TRACKED_TYPES.has(sessionType);
  /** Cadence (steps/min) only means anything on foot — cycling cadence is pedal RPM, a different sensor entirely, out of scope here. */
  const isOnFootSport = sport === "running" || sport === "walking";

  useEffect(() => {
    if (!native) return;
    recoverOrphanedSession().then((recovered) => {
      if (recovered) setOrphaned(recovered);
    });
  }, [native]);

  // Fetched once, purely for the live/in-review score-prediction ladder
  // below — the same resting/max HR + sex a saved run would be scored
  // against, so the live number is a genuine estimate, not a guess.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("resting_hr, max_hr, gender")
        .eq("user_id", user.id)
        .single();
      if (cancelled || !data) return;
      setProfile({
        restingHr: data.resting_hr,
        maxHr: data.max_hr,
        sex: data.gender === "female" ? "female" : "male",
      });
    })();
    return () => {
      cancelled = true;
    };
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

  /** Avg Split — this run's average pace from the very start, same number as the whole-session average shown after saving. Kept as its own explicitly-labeled tile (user feedback: needs to be unambiguous this is the RUN's average, not the instantaneous pace below). */
  const livePaceSecondsPerKm =
    liveDistanceMeters > 0 ? elapsedSeconds / (liveDistanceMeters / 1000) : null;

  /** Current Pace — a rolling last-60-seconds window, distinct from Avg Split above. Falls back to the whole-run average until there's at least 60s/two GPS fixes of recent data to compute a genuine rolling number from. */
  const currentPaceSecondsPerKm = useMemo(() => {
    if (livePoints.length < 2) return null;
    const cutoff = livePoints[livePoints.length - 1].time - 60_000;
    const recent = livePoints.filter((p) => p.time >= cutoff);
    if (recent.length < 2) return livePaceSecondsPerKm;
    let meters = 0;
    for (let i = 1; i < recent.length; i++) meters += haversineDistanceMeters(recent[i - 1], recent[i]);
    const seconds = (recent[recent.length - 1].time - recent[0].time) / 1000;
    return meters > 0 && seconds > 0 ? seconds / (meters / 1000) : livePaceSecondsPerKm;
  }, [livePoints, livePaceSecondsPerKm]);

  /** Live score-prediction ladder (user feedback: "based off the current pace, heart rate... extrapolate a score prediction for set distances") — running only (see LIVE_LADDER_METERS), and only once there's enough real distance for a Riegel projection to mean anything rather than just amplifying GPS noise. */
  const livePrediction: LivePredictionEntry[] | null = useMemo(() => {
    if (sport !== "running" || !profile || liveDistanceMeters < 400) return null;
    return livePredictionLadder("run", liveDistanceMeters, elapsedSeconds, liveBpm, profile.sex, {
      restingHR: profile.restingHr,
      maxHR: profile.maxHr,
    });
  }, [sport, profile, liveDistanceMeters, elapsedSeconds, liveBpm]);

  /** Same ladder, computed from the FINAL stopped-tracking summary for the reviewing (pre-save) screen — an honest "if you saved this as-is" estimate, still not the actual score (see livePredictionLadder's doc comment on why). */
  const reviewPrediction: LivePredictionEntry[] | null = useMemo(() => {
    if (sport !== "running" || !profile || !summary || summary.distanceMeters < 400) return null;
    const reviewAvgBpm =
      hrReadings.length > 0
        ? Math.round(hrReadings.reduce((sum, r) => sum + r.bpm, 0) / hrReadings.length)
        : null;
    return livePredictionLadder(
      "run",
      summary.distanceMeters,
      summary.durationSeconds,
      reviewAvgBpm,
      profile.sex,
      { restingHR: profile.restingHr, maxHR: profile.maxHr }
    );
  }, [sport, profile, summary, hrReadings]);

  // Keeps the lock-screen Live Activity's distance/pace/HR in step with the
  // tracking HUD — the elapsed clock itself doesn't need a push at all
  // (startedAtRef.current, sent once at start, is enough for the widget's
  // native Text(_:style:.timer) to keep ticking correctly on its own, even
  // through a screen lock — see live-activity.ts). Depending on
  // elapsedSeconds (which ticks every second) rather than driving this from
  // the setInterval callback itself avoids a stale closure over
  // distance/pace/heart-rate/cadence — a fresh effect runs each render with
  // whatever those values currently are.
  useEffect(() => {
    if (phase !== "tracking") return;
    updateLiveActivity({
      startDateEpochMs: startedAtRef.current,
      distanceKm: liveDistanceMeters / 1000,
      paceOrSpeedText: formatPaceOrSpeed(sport, livePaceSecondsPerKm),
      heartRateBpm: liveBpm ?? undefined,
    });
  }, [phase, elapsedSeconds, liveDistanceMeters, livePaceSecondsPerKm, liveBpm, sport]);

  async function handleConnectHeartRate() {
    if (connectingHr) return;
    setConnectingHr("ble");
    setHrError("");
    try {
      const device = await connectHeartRateMonitor((reading) => {
        setLiveBpm(reading.bpm);
        setHrReadings((prev) => [...prev, reading]);
      });
      setHrDeviceName(device.name);
      setHrSource("ble");
    } catch {
      setHrError("Couldn't connect — make sure the monitor is on and in pairing range.");
    } finally {
      setConnectingHr(null);
    }
  }

  async function handleConnectAirPods() {
    if (connectingHr) return;
    setConnectingHr("airpods");
    setHrError("");
    try {
      await startAirPodsHeartRate(sport, (reading) => {
        setLiveBpm(reading.bpm);
        setHrReadings((prev) => [...prev, reading]);
      });
      setHrDeviceName("AirPods (Apple Health)");
      setHrSource("airpods");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setHrError(
        detail
          ? `Couldn't start AirPods heart rate: ${detail}`
          : "Couldn't start — check Health access is allowed for Split Index in Settings."
      );
    } finally {
      setConnectingHr(null);
    }
  }

  async function handleDisconnectHeartRate() {
    if (hrSource === "airpods") {
      await stopAirPodsHeartRate();
    } else {
      await disconnectHeartRateMonitor();
    }
    setHrDeviceName(null);
    setHrSource(null);
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
    setLiveCadence(null);
    setCadenceReadings([]);
    try {
      await startGpsSession((point) => setLivePoints((prev) => [...prev, point]));
      if (isOnFootSport && isStepCadenceSupported()) {
        // Best-effort — a missing Motion & Fitness permission or an older
        // device without the M-series coprocessor just means no cadence
        // tile shows up later, never something that should block the run.
        startStepCadence((cadence) => {
          setLiveCadence(cadence);
          setCadenceReadings((prev) => [...prev, cadence]);
        }).catch(() => {});
      }
      startedAtRef.current = Date.now();
      segmentStartRef.current = startedAtRef.current;
      setPhase("tracking");
      tickRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      if (isLiveActivitySupported()) {
        startLiveActivity(
          "gpsTracking",
          GPS_SPORTS.find((s) => s.value === sport)?.label ?? "GPS Tracking",
          { startDateEpochMs: startedAtRef.current, distanceKm: 0 }
        );
      }
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
      if (hrSource) await handleDisconnectHeartRate();
      if (isOnFootSport) await stopStepCadence().catch(() => {});
      await endLiveActivity();
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
      if (hrSource) await handleDisconnectHeartRate();
      if (isOnFootSport) await stopStepCadence().catch(() => {});
      await endLiveActivity();
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
    setHrSource(null);
    setLiveCadence(null);
    setCadenceReadings([]);
    setElapsedSeconds(0);
    setError("");
  }

  function buildOverviewResult(data: Record<string, unknown>): ScoreResultSummary {
    const sportIndex = (data.sportIndex as number | undefined) ?? 0;
    return {
      sport,
      sportLabel: SPORT_INDEX_LABELS[sport],
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
      const avgCadence =
        cadenceReadings.length > 0
          ? Math.round(cadenceReadings.reduce((sum, c) => sum + c, 0) / cadenceReadings.length)
          : undefined;
      const startPoint = livePoints[0];

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
          sport,
          started_at: startedAtIso,
          duration_seconds: trackSummary.durationSeconds,
          distance_meters: trackSummary.distanceMeters,
          elevation_meters: trackSummary.elevationGainMeters ?? undefined,
          avg_pace_seconds_per_km: trackSummary.avgPaceSecondsPerKm ?? undefined,
          avg_heart_rate: avgHeartRate,
          max_heart_rate: maxHeartRate,
          avg_cadence: avgCadence,
          session_type: sessionType,
          source: "gps",
          is_partial_track: trackSummary.isPartial,
          // Starting coordinates only — used server-side to auto-fetch the
          // temperature at run time (no manual entry needed for GPS runs).
          // Never persisted as their own column, just consumed once.
          start_latitude: startPoint?.latitude,
          start_longitude: startPoint?.longitude,
          // The run's shape, simplified for storage — this is what lets the
          // logbook draw the route back. Raw fixes are deliberately not sent:
          // a 10km run is ~1000 of them and the drawn difference is invisible.
          route: buildRoutePolyline(livePoints) ?? undefined,
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
    // Portaled to document.body rather than returned in place — this HUD is
    // deliberately dark regardless of app theme, but it still renders inside
    // the page tree, which sits under the cardio (light-mode) shell wrapper.
    // That wrapper remaps any `text-white`/`bg-white`/`border-white` utility
    // it finds as a descendant (so shared components stay legible on the
    // light cardio background elsewhere on this same page) — the remap has
    // no way to know this particular subtree wants to stay dark, so it was
    // flattening this screen's contrast to near-invisible. Escaping to
    // body sidesteps the wrapper's CSS selectors entirely instead of trying
    // to out-specificity them one utility at a time.
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-background landscape:flex-row">
        <div className="relative h-1/2 w-full shrink-0 landscape:h-full landscape:w-1/2">
          <GpsMap points={livePoints} className="h-full w-full" />
          <div
            className="pointer-events-none absolute left-4 flex items-center gap-1.5 rounded-full border border-white/20 bg-black px-3 py-1.5 text-xs font-bold text-white shadow-lg"
            style={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
          >
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
            Tracking — screen can lock
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-between overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 landscape:h-full landscape:justify-center landscape:gap-6 landscape:py-6">
          <div className="flex w-full flex-1 flex-col items-center justify-center landscape:flex-none">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-gradient-to-br from-cardio-accent to-strength-accent" aria-hidden />
              <p className="micro-label text-white/60">Elapsed</p>
            </div>
            <p className="index-display bg-gradient-to-br from-white to-white/70 bg-clip-text text-6xl font-extrabold tabular-nums text-transparent">
              {formatElapsed(elapsedSeconds)}
            </p>

            {isSegmentTracked && (
              <button
                type="button"
                onClick={toggleSegment}
                className={`mt-3 flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold uppercase tracking-wide transition-colors ${
                  segmentType === "hard"
                    ? "bg-danger text-white shadow-lg shadow-danger/30"
                    : "bg-white/15 text-white"
                }`}
              >
                <Zap className="h-4 w-4" fill="currentColor" />
                {segmentType === "hard" ? "Hard effort — tap for easy" : "Easy — tap to go hard"}
              </button>
            )}

            {/* Stat grid — Distance and Avg Split are just tiles here like
                everything else (user feedback: Avg Split had a large box in
                a different font/color, wanted it styled the same as every
                other individual stat instead of singled out). */}
            <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-2.5 text-center">
              <div className="rounded-xl border border-white/10 bg-white/[0.06] py-2.5">
                <div className="mb-1 flex items-center justify-center gap-1.5 text-white/50">
                  <MapPin className="h-3.5 w-3.5" />
                  <p className="micro-label">Distance</p>
                </div>
                <p className="text-lg font-bold tabular-nums text-white">
                  {(liveDistanceMeters / 1000).toFixed(2)} km
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.06] py-2.5">
                <div className="mb-1 flex items-center justify-center gap-1.5 text-white/50">
                  <Gauge className="h-3.5 w-3.5" />
                  <p className="micro-label">Avg split</p>
                </div>
                <p className="text-lg font-bold tabular-nums text-white">
                  {formatPaceOrSpeed(sport, livePaceSecondsPerKm)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.06] py-2.5">
                <p className="micro-label text-white/50">Current pace</p>
                <p className="text-lg font-bold tabular-nums text-white">
                  {formatPaceOrSpeed(sport, currentPaceSecondsPerKm)}
                </p>
              </div>
              {liveBpm !== null && (
                <div className="rounded-xl border border-danger/25 bg-danger/10 py-2.5">
                  <p className="micro-label text-danger/80">Heart rate</p>
                  <p className="flex items-center justify-center gap-1 text-lg font-bold tabular-nums text-white">
                    <HeartPulse className="h-3.5 w-3.5 text-danger" fill="currentColor" />
                    {liveBpm}
                  </p>
                </div>
              )}
              {liveElevationGainMeters !== null && (
                <div className="rounded-xl border border-warning/25 bg-warning/10 py-2.5">
                  <p className="micro-label text-warning/80">Elevation</p>
                  <p className="text-lg font-bold tabular-nums text-white">
                    {Math.round(liveElevationGainMeters)} m
                  </p>
                </div>
              )}
              {liveCadence !== null && (
                <div className="rounded-xl border border-white/10 bg-white/[0.06] py-2.5">
                  <p className="micro-label text-white/50">Cadence</p>
                  <p className="text-lg font-bold tabular-nums text-white">{liveCadence} spm</p>
                </div>
              )}
            </div>

            {/* Live score-prediction ladder — running only, once there's enough distance for a real Riegel projection (see livePrediction memo). */}
            {livePrediction && (
              <div className="mt-4 w-full max-w-sm">
                <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                  <TrendingUp className="h-3.5 w-3.5 text-cardio-accent-soft" />
                  <p className="micro-label text-white/60">
                    Predicted at this pace &amp; effort
                  </p>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {livePrediction.map((entry) => (
                    <div
                      key={entry.label}
                      className="flex min-w-[5.5rem] shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-center"
                    >
                      <p className="micro-label text-white/50">{entry.label}</p>
                      <p className="text-sm font-bold tabular-nums text-white">
                        {formatRaceTime(entry.seconds)}
                      </p>
                      <p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
                        {Math.round(entry.score)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
      </div>,
      document.body
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="The Engine"
        title="GPS Tracking"
        subtitle="Lock your phone. Tracking keeps going."
      />

      {/* User feedback (Slice 14): "make sure the runs are saved after so
          that when you log back in it comes up right away to show the
          map" — a recovered session (including one recorded entirely
          offline via offline-track.html, which writes to this exact same
          storage) used to surface as a text-only banner with a distance
          number and nothing else. recoverOrphanedSession() now returns the
          raw points too, so the actual route renders immediately. */}
      {orphaned && (
        <Card padding="sm" className="border border-warning/30 bg-warning/5">
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                We found a run that didn&apos;t stop normally last time
                {orphaned.summary.distanceMeters > 0
                  ? ` (~${(orphaned.summary.distanceMeters / 1000).toFixed(2)}km)`
                  : ""}
                .
              </p>
              <p className="mt-1 text-xs text-warning/80">
                It&apos;ll be saved as a partial/incomplete session, not a full clean effort.
              </p>

              {orphaned.points.length > 0 && (
                <GpsMap
                  points={orphaned.points}
                  className="my-3 h-40 w-full overflow-hidden rounded-xl"
                />
              )}

              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    submitSummary(
                      orphaned.summary,
                      new Date(Date.now() - orphaned.summary.durationSeconds * 1000).toISOString()
                    )
                  }
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
              label="Sport"
              value={sport}
              onChange={(e) => setSport(e.target.value as GpsSport)}
              options={GPS_SPORTS}
              className="mb-4 w-full max-w-xs"
            />

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
                <div className="flex flex-col gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    loading={connectingHr === "ble"}
                    disabled={connectingHr === "airpods"}
                    onClick={handleConnectHeartRate}
                  >
                    <HeartPulse className="h-4 w-4" />
                    Connect Bluetooth heart rate monitor
                  </Button>
                  {isAirPodsHeartRateSupported() && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      loading={connectingHr === "airpods"}
                      disabled={connectingHr === "ble"}
                      onClick={handleConnectAirPods}
                    >
                      <HeartPulse className="h-4 w-4" />
                      Use AirPods heart rate
                    </Button>
                  )}
                </div>
              )}
              {hrError && <p className="mt-2 text-xs text-danger">{hrError}</p>}
              <p className="mt-2 text-xs text-muted">
                Bluetooth works with Garmin watches and Polar/Wahoo-style chest straps. AirPods
                heart rate runs through Apple Health — the first run will ask for Health access
                and briefly show an Apple workout indicator.
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

          {/* Stat grid — Distance and Avg Split are just tiles here like
              everything else (user feedback: Avg Split had a large box in a
              different font/color, wanted it styled the same as every other
              individual stat instead of singled out). */}
          <div className="mb-6 grid grid-cols-2 gap-2.5">
            <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/[0.06] py-3 text-center">
              <div className="mb-1 flex items-center gap-1.5 text-white/60">
                <MapPin className="h-4 w-4" />
                <p className="micro-label">Distance</p>
              </div>
              <p className="text-lg font-bold tabular-nums text-white">
                {(summary.distanceMeters / 1000).toFixed(2)} km
              </p>
            </div>
            <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/[0.06] py-3 text-center">
              <div className="mb-1 flex items-center gap-1.5 text-white/60">
                <Gauge className="h-4 w-4" />
                <p className="micro-label">Avg split</p>
              </div>
              <p className="text-lg font-bold tabular-nums text-white">
                {formatPaceOrSpeed(sport, summary.avgPaceSecondsPerKm)}
              </p>
            </div>
            {summary.elevationGainMeters !== null && (
              <div className="flex flex-col items-center rounded-xl border border-warning/25 bg-warning/10 py-3 text-center">
                <div className="mb-1 flex items-center gap-1.5 text-warning/80">
                  <Mountain className="h-4 w-4" />
                  <p className="micro-label">Elevation gain</p>
                </div>
                <p className="text-lg font-bold tabular-nums text-white">{Math.round(summary.elevationGainMeters)} m</p>
              </div>
            )}
            {hrReadings.length > 0 && (
              <div className="flex flex-col items-center rounded-xl border border-danger/25 bg-danger/10 py-3 text-center">
                <div className="mb-1 flex items-center gap-1.5 text-danger/80">
                  <HeartPulse className="h-4 w-4" fill="currentColor" />
                  <p className="micro-label">Avg heart rate</p>
                </div>
                <p className="text-lg font-bold tabular-nums text-white">
                  {Math.round(hrReadings.reduce((sum, r) => sum + r.bpm, 0) / hrReadings.length)} bpm
                </p>
              </div>
            )}
            {cadenceReadings.length > 0 && (
              <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/[0.06] py-3 text-center">
                <div className="mb-1 flex items-center gap-1.5 text-white/60">
                  <Footprints className="h-4 w-4" />
                  <p className="micro-label">Avg cadence</p>
                </div>
                <p className="text-lg font-bold tabular-nums text-white">
                  {Math.round(cadenceReadings.reduce((sum, c) => sum + c, 0) / cadenceReadings.length)} spm
                </p>
              </div>
            )}
          </div>

          {reviewPrediction && (
            <div className="mb-6">
              <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                <TrendingUp className="h-3.5 w-3.5 text-cardio-accent-soft" />
                <p className="micro-label text-white/60">Predicted at this pace &amp; effort</p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {reviewPrediction.map((entry) => (
                  <div
                    key={entry.label}
                    className="flex min-w-[5.5rem] shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-center"
                  >
                    <p className="micro-label text-white/50">{entry.label}</p>
                    <p className="text-sm font-bold tabular-nums text-white">{formatRaceTime(entry.seconds)}</p>
                    <p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
                      {Math.round(entry.score)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-6 flex items-center gap-1.5 text-xs text-muted">
            <Thermometer className="h-3.5 w-3.5" />
            Temperature is recorded automatically from your starting location — you&apos;ll see it
            on the saved activity.
          </p>

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
