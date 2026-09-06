"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { MapPin, Square, AlertTriangle, Gauge, Mountain, HeartPulse, Zap, Flag, Thermometer, Footprints, TrendingUp, Pause, Play, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SuccessScreen, type ScoreResultSummary } from "@/components/activities/success-screen";
import { SESSION_TYPES } from "@/lib/constants/sports";
import { formatIndex } from "@/lib/utils/format";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { isNativePlatform } from "@/lib/native/platform";
import { createClient } from "@/lib/supabase/client";
import { livePredictionLadder, type LivePredictionEntry } from "@/lib/scoring/cardio-activity";
import {
  startGpsSession,
  stopGpsSession,
  clearGpsSession,
  pauseGpsSession,
  resumeGpsSession,
  recoverOrphanedSession,
  rejoinGpsSession,
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
  PARTIAL_REASON_LABEL,
  trackDistanceMeters,
  movingMillis,
  isPaused,
  elevationGainMeters,
  type GpsTrackSummary,
  type GpsPoint,
  type HrReading,
  type RunSegment,
  type PauseInterval,
} from "@/lib/scoring/gps-track";
import { buildGpsActivityPayload } from "./submission";
import { submitActivityRequest } from "@/lib/activities/submit-activity";
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
/**
 * `useSearchParams` forces everything under it out of static prerendering
 * unless it sits inside a Suspense boundary, so the boundary is the whole
 * page and the tracking screen below is the child. Same shape as
 * settings/billing, for the same build-time reason.
 */
export default function GpsRunPage() {
  return (
    <Suspense fallback={null}>
      <GpsRunScreen />
    </Suspense>
  );
}

function GpsRunScreen() {
  // Which sport the + button asked for. The launcher links straight to
  // "record a run" / "record a ride" rather than to a generic tracker the
  // athlete then has to configure, so an invalid or absent value simply
  // falls back to the select below rather than erroring.
  const requestedSport = useSearchParams().get("sport");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [summary, setSummary] = useState<GpsTrackSummary | null>(null);
  const [orphaned, setOrphaned] = useState<RecoveredGpsSession | null>(null);
  const [livePoints, setLivePoints] = useState<GpsPoint[]>([]);
  const [sport, setSport] = useState<GpsSport>(
    GPS_SPORTS.some((s) => s.value === requestedSport) ? (requestedSport as GpsSport) : "running"
  );
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
  const [rejoining, setRejoining] = useState(false);
  /** User report: "No stop start button on GPS runs. Once paused you can only discard run." A paused run is not an abandoned run — everything recorded stays recorded, and this flips straight back. */
  const [paused, setPaused] = useState(false);
  const [pauses, setPauses] = useState<PauseInterval[]>([]);
  const [pausing, setPausing] = useState(false);
  /** Discard is two-step on purpose: one mis-tap must never be able to destroy a recorded run. */
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState("");
  /** Set when a run was accepted into the offline queue rather than saved outright — a success with a caveat, not an error, so it gets its own state and its own colour. */
  const [queuedMessage, setQueuedMessage] = useState("");
  const [overviewResult, setOverviewResult] = useState<ScoreResultSummary | null>(null);
  const [overviewIsPremium, setOverviewIsPremium] = useState(false);
  const [profile, setProfile] = useState<{
    restingHr: number | null;
    maxHr: number | null;
    sex: "male" | "female";
  } | null>(null);
  const startedAtRef = useRef<number>(0);
  const segmentStartRef = useRef<number>(0);
  /** Mirrors `pauses` so the once-a-second clock can read the current value without the interval being torn down and rebuilt on every pause. */
  const pausesRef = useRef<PauseInterval[]>([]);
  /** The instant a still-running clock would have to have started from to show the correct *moving* time — what the lock-screen Live Activity ticks from, so paused seconds don't accumulate there either. */
  const [liveClockStartMs, setLiveClockStartMs] = useState(0);

  function applyPauses(next: PauseInterval[]) {
    pausesRef.current = next;
    setPauses(next);
  }

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

  // The displayed clock is recomputed from wall time every tick rather than
  // incremented, so it self-corrects after the WebView's JS timers are frozen
  // by a screen lock or the app being backgrounded — and it subtracts paused
  // stretches, so a pause genuinely stops the clock instead of just hiding it.
  useEffect(() => {
    if (phase !== "tracking") return;
    const tick = () => {
      const moving = movingMillis(startedAtRef.current, Date.now(), pausesRef.current);
      setElapsedSeconds(Math.floor(moving / 1000));
      // While paused this keeps sliding forward by a second each second, which
      // is exactly what holds the native lock-screen timer still.
      setLiveClockStartMs(Date.now() - moving);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Live distance during tracking — the same function the final summary uses,
  // so the number on screen mid-run is the number that gets saved. Legs that
  // straddle a pause are skipped: standing at a crossing for two minutes must
  // not draw a straight line across the junction and call it distance run.
  const liveDistanceMeters = useMemo(
    () => trackDistanceMeters(livePoints, pauses),
    [livePoints, pauses]
  );

  /** Everything recorded while actually running. Fixes captured during a pause are receiver drift around a standing athlete, not route and not climb, so neither the map nor the elevation total should see them. */
  const movingPoints = useMemo(
    () => livePoints.filter((p) => !isPaused(p.time, pauses)),
    [livePoints, pauses]
  );

  const liveElevationGainMeters = useMemo(() => elevationGainMeters(movingPoints), [movingPoints]);

  /** Avg Split — this run's average pace from the very start, same number as the whole-session average shown after saving. Kept as its own explicitly-labeled tile (user feedback: needs to be unambiguous this is the RUN's average, not the instantaneous pace below). */
  const livePaceSecondsPerKm =
    liveDistanceMeters > 0 ? elapsedSeconds / (liveDistanceMeters / 1000) : null;

  /** Current Pace — a rolling last-60-seconds-of-*running* window, distinct from Avg Split above. Falls back to the whole-run average until there's at least 60s/two GPS fixes of recent data to compute a genuine rolling number from. */
  const currentPaceSecondsPerKm = useMemo(() => {
    if (livePoints.length < 2) return null;
    // Walk back until the window holds 60 seconds of *moving* time, so a pause
    // inside it doesn't shrink the window to nothing and report a wild pace on
    // resume.
    let firstIndex = livePoints.length - 1;
    let windowMs = 0;
    while (firstIndex > 0 && windowMs < 60_000) {
      windowMs += movingMillis(livePoints[firstIndex - 1].time, livePoints[firstIndex].time, pauses);
      firstIndex -= 1;
    }
    const recent = livePoints.slice(firstIndex);
    if (recent.length < 2) return livePaceSecondsPerKm;
    const meters = trackDistanceMeters(recent, pauses);
    const seconds = movingMillis(recent[0].time, recent[recent.length - 1].time, pauses) / 1000;
    return meters > 0 && seconds > 0 ? seconds / (meters / 1000) : livePaceSecondsPerKm;
  }, [livePoints, livePaceSecondsPerKm, pauses]);

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
      // Not the real start time: the instant a clock showing only *moving*
      // time would have started from. While paused this is pushed forward
      // once a second, which holds the lock-screen timer still — otherwise
      // the widget would keep counting through a pause and disagree with the
      // duration that actually gets saved.
      startDateEpochMs: liveClockStartMs || startedAtRef.current,
      distanceKm: liveDistanceMeters / 1000,
      paceOrSpeedText: formatPaceOrSpeed(sport, livePaceSecondsPerKm),
      heartRateBpm: liveBpm ?? undefined,
    });
  }, [phase, liveClockStartMs, liveDistanceMeters, livePaceSecondsPerKm, liveBpm, sport]);

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
    setPaused(false);
    setConfirmingDiscard(false);
    applyPauses([]);
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
      setLiveClockStartMs(startedAtRef.current);
      setPhase("tracking");
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

  /**
   * Picks a run back up after the WebView was reloaded underneath it.
   *
   * This is the fix for "pause only stops the run permanently". The athlete
   * pauses, pockets the phone, iOS re-creates the WKWebView behind the
   * backgrounded app, and this component remounts with `phase` back at "idle"
   * and every bit of run state gone. Before this existed the only thing on
   * offer was to save the run as a partial effort or throw it away — the run
   * they were standing in the middle of was simply over.
   *
   * Everything is restored from the recovered record, not re-derived: the
   * original start time (so the clock does not restart at zero), every fix,
   * and the pauses with the one they are currently standing in still OPEN, so
   * they come back to a paused run with a Resume button rather than to a run
   * that quietly started counting again while they were still stopped.
   */
  async function handleRejoin() {
    if (!orphaned || rejoining) return;
    setRejoining(true);
    setError("");
    try {
      const recovered = orphaned;
      await rejoinGpsSession(
        {
          points: recovered.points,
          pauses: recovered.livePauses,
          startedAt: recovered.startedAt,
        },
        (point) => setLivePoints((prev) => [...prev, point])
      );
      if (isOnFootSport && isStepCadenceSupported()) {
        startStepCadence((cadence) => {
          setLiveCadence(cadence);
          setCadenceReadings((prev) => [...prev, cadence]);
        }).catch(() => {});
      }
      setLivePoints(recovered.points);
      applyPauses(recovered.livePauses);
      setPaused(recovered.wasPaused);
      setConfirmingDiscard(false);
      startedAtRef.current = recovered.startedAt;
      // Effort segments are not persisted, so a rejoined interval run starts a
      // fresh segment here rather than pretending one has been open since the
      // start of the run.
      segmentStartRef.current = Date.now();
      setSegments([]);
      setSegmentType("easy");
      setOrphaned(null);
      setPhase("tracking");
      if (isLiveActivitySupported()) {
        startLiveActivity(
          "gpsTracking",
          GPS_SPORTS.find((s) => s.value === sport)?.label ?? "GPS Tracking",
          { startDateEpochMs: recovered.startedAt, distanceKm: recovered.summary.distanceMeters / 1000 }
        );
      }
    } catch {
      setError("Couldn't pick that run back up. You can still save it as a partial session below.");
    } finally {
      setRejoining(false);
    }
  }

  /** Marks the boundary between a hard and easy effort — the only UI interaction interval/fartlek tracking adds beyond a plain run. */
  function toggleSegment() {
    const now = Date.now();
    setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
    segmentStartRef.current = now;
    setSegmentType((t) => (t === "hard" ? "easy" : "hard"));
  }

  /**
   * Pause. Nothing recorded is thrown away and native tracking is deliberately
   * left running (see pauseGpsSession) — this only marks the stretch so that
   * distance, duration and climb all skip over it. Resuming picks the run back
   * up exactly where it stood.
   */
  async function handlePause() {
    if (pausing || paused) return;
    setPausing(true);
    const now = Date.now();
    try {
      // Close the open hard/easy effort at the pause, so standing still never
      // lands inside a rep and drags its pace and heart rate down.
      if (isSegmentTracked && now > segmentStartRef.current) {
        setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
        segmentStartRef.current = now;
      }
      applyPauses([...pausesRef.current, { startTime: now, endTime: null }]);
      setPaused(true);
      await pauseGpsSession(now);
    } finally {
      setPausing(false);
    }
  }

  /** Resume. The counterpart to the above — the run continues, with everything already recorded intact. */
  async function handleResume() {
    if (pausing || !paused) return;
    setPausing(true);
    const now = Date.now();
    try {
      applyPauses(pausesRef.current.map((p) => (p.endTime === null ? { ...p, endTime: now } : p)));
      // The next effort segment starts from the resume, not from the pause.
      segmentStartRef.current = now;
      setPaused(false);
      setConfirmingDiscard(false);
      await resumeGpsSession(now);
    } finally {
      setPausing(false);
    }
  }

  async function handleStop() {
    if (stopping) return;
    setStopping(true);
    try {
      const now = Date.now();
      // Close whatever segment was open at the moment of stopping, so the
      // final hard or easy effort isn't silently dropped from scoring. A run
      // stopped while paused already closed its segment at the pause.
      if (isSegmentTracked && !paused && now > segmentStartRef.current) {
        setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
      }
      // Finishing from a paused state closes that pause here too, so the route
      // drawn below excludes it exactly as the summary's distance does.
      if (paused) {
        applyPauses(pausesRef.current.map((p) => (p.endTime === null ? { ...p, endTime: now } : p)));
        setPaused(false);
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

  /** Bails out of a run in progress — stops native tracking and the HR monitor same as a normal stop, but throws the track away instead of moving to review. Only reachable from a paused run, behind an explicit confirmation. */
  async function handleDiscardTracking() {
    setStopping(true);
    try {
      await stopGpsSession();
      // Explicit, because Stop no longer deletes anything on its own. This is
      // the athlete saying "bin it", which is one of the only two things that
      // may remove a track.
      await clearGpsSession();
      if (hrSource) await handleDisconnectHeartRate();
      if (isOnFootSport) await stopStepCadence().catch(() => {});
      await endLiveActivity();
    } finally {
      setStopping(false);
      resetToIdle();
    }
  }

  async function handleDiscardReview() {
    // Same reasoning as handleDiscardTracking: leaving the review screen used
    // to be free because the record was already gone. Now it is a decision.
    await clearGpsSession();
    resetToIdle();
  }

  function resetToIdle() {
    setQueuedMessage("");
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
    setPaused(false);
    setPausing(false);
    setConfirmingDiscard(false);
    applyPauses([]);
    setLiveClockStartMs(0);
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

  /**
   * Saves a finished track. `sourcePoints`/`sourcePauses` default to the live
   * session, but MUST be passed explicitly by the recovered-orphan path.
   *
   * That default used to be an unconditional read of `livePoints`, which is
   * empty on recovery — the app was killed, the component remounted, and the
   * points live in `orphaned.points`, not in React state. So a recovered run
   * was saved with no route (no map, ever, for the run most likely to be a
   * long one) and no start coordinate (so no temperature was looked up, and
   * heat is a scoring input), while the summary alongside it carried the full
   * distance. Silent, and invisible until the athlete opened the logbook.
   */
  async function submitSummary(
    trackSummary: GpsTrackSummary,
    startedAtIso: string,
    sourcePoints: GpsPoint[] = livePoints,
    sourcePauses: readonly PauseInterval[] = pauses
  ) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      /*
        THROUGH THE OFFLINE QUEUE, like every other logged session.

        This was a bare `fetch`. Every manually logged workout in the app goes
        through `submitActivityRequest`, which queues the payload on this device
        when the request fails for want of a network and flushes it on
        reconnect — and the ONE kind of session most likely to finish out of
        signal was the one path that skipped it. A run finished on a hill with
        no bars got "Could not save this run", and that was the end of it.
      */
      const result = await submitActivityRequest(
        "/api/activities",
        "POST",
        buildGpsActivityPayload({
          sport,
          sessionType,
          startedAtIso,
          summary: trackSummary,
          points: sourcePoints,
          pauses: sourcePauses,
          hrReadings,
          cadenceReadings,
          segments,
        })
      );

      if (!result.ok) {
        setError(result.error ?? "Could not save this run. Please try again.");
        setSaving(false);
        return;
      }

      /*
        The stored track is deleted HERE and nowhere else — the run is now
        either on the server or in the offline queue, so this is the first
        moment there is a second copy of it. Everything before this point
        (Stop, the review screen, a failed attempt) leaves the record on disk,
        because until now it was the only copy.
      */
      await clearGpsSession();

      if (result.queued) {
        // Queued is a success with a caveat, not a failure. Say so plainly and
        // stay on the review screen rather than showing an overview built from
        // a server response that does not exist yet.
        setError("");
        setQueuedMessage(
          result.message ??
            "You're offline — this run is saved on your phone and will sync when you're back online."
        );
        setSaving(false);
        return;
      }

      const data = (result.data ?? {}) as Record<string, unknown>;
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
          <GpsMap points={movingPoints} className="h-full w-full" />
          <div
            className="pointer-events-none absolute left-4 flex items-center gap-1.5 rounded-full border border-white/20 bg-black px-3 py-1.5 text-xs font-bold text-white shadow-lg"
            style={{ top: "max(1rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
          >
            {paused ? (
              <>
                <Pause className="h-3 w-3 text-warning" fill="currentColor" />
                Paused — your run is safe
              </>
            ) : (
              <>
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
                Tracking — screen can lock
              </>
            )}
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

            {isSegmentTracked && !paused && (
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
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {livePrediction.map((entry) => (
                    <div
                      key={entry.label}
                      className="flex min-w-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.06] px-2 py-2 text-center"
                    >
                      <p className="micro-label text-white/50">{entry.label}</p>
                      <p className="text-sm font-bold tabular-nums text-white">
                        {formatRaceTime(entry.seconds)}
                      </p>
                      {/* formatIndex, not Math.round: `score` is on the internal
                          0-1000 scale and every score the athlete has ever been
                          shown is on the 0-100 one. Raw, this predicted 742
                          mid-run and then saved as 74.2 — the same run, two
                          numbers, one of them ten times the other. */}
                      <p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
                        {formatIndex(entry.score)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Controls. Two big targets, both sized to be hit at a run with wet
              hands: pause/resume and finish. Discard is not among them — it
              lives behind a pause AND a confirmation, because the one thing
              this screen must never do is destroy a recorded run on a
              mis-tap (user report: "Once paused you can only discard run"). */}
          <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-8">
              <button
                type="button"
                onClick={paused ? handleResume : handlePause}
                disabled={pausing || stopping}
                aria-label={paused ? "Resume run" : "Pause run"}
                className={`flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 disabled:opacity-60 ${
                  paused
                    ? "bg-accent text-accent-foreground shadow-accent/30"
                    : "bg-white text-black shadow-white/20"
                }`}
              >
                {paused ? (
                  <Play className="h-8 w-8" fill="currentColor" />
                ) : (
                  <Pause className="h-8 w-8" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={stopping || pausing}
                aria-label="Finish run"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition-transform active:scale-95 disabled:opacity-60"
              >
                <Square className="h-7 w-7" fill="currentColor" />
              </button>
            </div>
            <div className="flex items-center justify-center gap-8 text-center">
              <p className="w-20 micro-label text-white/50">{paused ? "Resume" : "Pause"}</p>
              <p className="w-20 micro-label text-white/50">Finish</p>
            </div>

            {/* Discard: paused only, visually separated from the controls
                above, and two-tap. Finishing keeps the run; this is the only
                path that throws it away, so it should feel like one. */}
            {paused && (
              <div className="w-full border-t border-white/10 pt-3">
                {confirmingDiscard ? (
                  <div className="flex flex-col items-center gap-2">
                    {/* Built as one string rather than interleaved JSX text and
                        expressions: the split version rendered as "02:21will be
                        lost" on device, because the space before "will" sat at
                        the start of a text node and was stripped. A warning
                        about permanent deletion is the last place to ship a
                        typo. */}
                    <p className="text-center text-xs text-white/70">
                      {`Delete this run for good? ${(liveDistanceMeters / 1000).toFixed(2)}km and ${formatElapsed(
                        elapsedSeconds
                      )} will be lost — it can't be recovered.`}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirmingDiscard(false)} disabled={stopping}>
                        Keep run
                      </Button>
                      <Button size="sm" variant="destructive" onClick={handleDiscardTracking} loading={stopping}>
                        Delete run
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDiscard(true)}
                    className="mx-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/45 transition-colors hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Discard run
                  </button>
                )}
              </div>
            )}
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
        <Card
          padding="sm"
          className={
            orphaned.resumable
              ? "border border-accent/30 bg-accent/5"
              : "border border-warning/30 bg-warning/5"
          }
        >
          <div
            className={`flex items-start gap-2 text-sm ${orphaned.resumable ? "text-accent" : "text-warning"}`}
          >
            {orphaned.resumable ? (
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="flex-1">
              {/* A run that is still live gets offered back as a run, not as
                  wreckage. Pausing and pocketing the phone is enough to make
                  iOS rebuild the WebView, and the old copy of this banner was
                  the whole of the athlete's "pause only stops the run
                  permanently" report: two buttons, both of which ended it. */}
              {orphaned.resumable ? (
                <>
                  <p className="font-medium">
                    Your run is still going
                    {orphaned.summary.distanceMeters > 0
                      ? ` — ${(orphaned.summary.distanceMeters / 1000).toFixed(2)}km so far`
                      : ""}
                    {orphaned.wasPaused ? ", paused" : ""}.
                  </p>
                  <p className="mt-1 text-xs text-accent/80">
                    {orphaned.wasPaused
                      ? "Pick it up where you stopped — nothing you've run is lost."
                      : "The app restarted mid-run. Carry on and it'll be saved as one session."}
                  </p>
                </>
              ) : (
                <>
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
                </>
              )}

              {orphaned.points.length > 0 && (
                <GpsMap
                  points={orphaned.points}
                  className="my-3 h-40 w-full overflow-hidden rounded-xl"
                />
              )}

              <div className="mt-1 flex flex-wrap gap-2">
                {orphaned.resumable && (
                  <Button size="sm" loading={rejoining} onClick={handleRejoin}>
                    <Play className="h-4 w-4" fill="currentColor" />
                    {orphaned.wasPaused ? "Back to my run" : "Continue run"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rejoining}
                  onClick={() =>
                    submitSummary(
                      orphaned.summary,
                      new Date(Date.now() - orphaned.summary.durationSeconds * 1000).toISOString(),
                      // Load-bearing: the recovered run's fixes live here, not
                      // in `livePoints` — this component mounted fresh after
                      // the app was killed. Without them the run saves with no
                      // map and no temperature.
                      orphaned.points,
                      orphaned.pauses
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
          {movingPoints.length > 0 && (
            <GpsMap points={movingPoints} className="mb-6 h-48 w-full overflow-hidden rounded-2xl" />
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
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {reviewPrediction.map((entry) => (
                  <div
                    key={entry.label}
                    className="flex min-w-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.06] px-2 py-2 text-center"
                  >
                    <p className="micro-label text-white/50">{entry.label}</p>
                    <p className="text-sm font-bold tabular-nums text-white">{formatRaceTime(entry.seconds)}</p>
                    {/* See the live strip above — same scale, same reason. */}
                    <p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
                      {formatIndex(entry.score)}
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
          {queuedMessage && (
            <div className="mb-3 rounded-xl border border-warning/30 bg-warning/[0.08] px-3 py-2.5">
              <p className="text-sm text-warning">{queuedMessage}</p>
              <p className="mt-1 text-xs text-muted">
                You can close this screen — the run is on your phone and will upload on its own.
              </p>
            </div>
          )}

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
