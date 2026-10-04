"use client";

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import nextDynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { MapPin, Square, AlertTriangle, Gauge, Mountain, HeartPulse, Zap, Flag, Thermometer, Footprints, TrendingUp, Pause, Play, Trash2, Volume2, VolumeX, Bike, Bluetooth, Timer, Route, CircleCheck } from "lucide-react";
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
import { speak } from "@/lib/native/speech";
import {
  trackDistanceMeters,
  movingMillis,
  isPaused,
  elevationGainMeters,
  type CadenceSample,
  type GpsTrackSummary,
  type GpsPoint,
  type HrReading,
  type RunSegment,
  type PauseInterval,
} from "@/lib/scoring/gps-track";
import { kilometreSplits, splitAnnouncement } from "@/lib/scoring/km-splits";
import { buildGpsActivityPayload } from "./submission";
import type { SessionType } from "@/types";

// Leaflet touches `window` at import time — ssr: false keeps it out of the
// server render entirely rather than crashing it.
const GpsMap = nextDynamic(() => import("@/components/cardio/gps-map"), { ssr: false });

/** Interval/fartlek are the only session types with a designed-around hard/easy segment toggle — every other type just tracks a single continuous effort. */
const SEGMENT_TRACKED_TYPES = new Set<SessionType>(["interval", "fartlek"]);

/** GPS tracking supports these three outdoor endurance sports — cycling shows speed instead of pace below, and cadence only applies to the two on-foot sports. */
type GpsSport = "running" | "outdoor_cycling" | "walking";

const GPS_SPORTS: { value: GpsSport; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "outdoor_cycling", label: "Outdoor Cycling" },
  { value: "walking", label: "Walking" },
];

/** How each sport is drawn on the start screen, and what the start button calls the session. */
const GPS_SPORT_META: Record<GpsSport, { short: string; noun: string; icon: typeof Footprints }> = {
  running: { short: "Run", noun: "run", icon: Footprints },
  outdoor_cycling: { short: "Ride", noun: "ride", icon: Bike },
  walking: { short: "Walk", noun: "walk", icon: Route },
};

/** One tile in the stat grids. The same shape on every GPS screen, so nothing is singled out by accident. */
function StatTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof Footprints;
  tone?: "neutral" | "accent" | "danger" | "warning";
  size?: "md" | "lg";
}) {
  const frame =
    tone === "accent"
      ? "border-cardio-accent/30 bg-cardio-accent/10"
      : tone === "danger"
        ? "border-danger/25 bg-danger/10"
        : tone === "warning"
          ? "border-warning/25 bg-warning/10"
          : "border-white/10 bg-white/[0.06]";
  const labelTone =
    tone === "danger" ? "text-danger/80" : tone === "warning" ? "text-warning/80" : "text-white/55";
  return (
    <div className={`flex min-w-0 flex-col items-center justify-center rounded-2xl border px-2 text-center ${frame} ${size === "lg" ? "py-3.5" : "py-2.5"}`}>
      <div className={`mb-1 flex items-center justify-center gap-1.5 ${labelTone}`}>
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        <p className="micro-label">{label}</p>
      </div>
      <p className={`index-display tabular-nums text-white ${size === "lg" ? "text-2xl font-bold" : "text-lg font-bold"}`}>
        {value}
      </p>
    </div>
  );
}

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

/** Where the spoken-splits preference is remembered between runs. */
const VOICE_SPLITS_KEY = "gps-voice-splits";

/**
 * The preference as a tiny external store, read through
 * `useSyncExternalStore`.
 *
 * Not `useState` plus a read in an effect: this project's lint rule forbids
 * setState inside an effect, and it is right to — the value is not React
 * state, it is a browser fact that React is reading. Not a lazy `useState`
 * initialiser either, because that runs on the server too, where there is no
 * localStorage, and an athlete who turned the voice off would hydrate a
 * toggle whose markup says "on". `getServerSnapshot` makes that difference
 * explicit instead of leaving it to a mismatch.
 */
const voiceSplitsListeners = new Set<() => void>();

function subscribeVoiceSplits(listener: () => void): () => void {
  voiceSplitsListeners.add(listener);
  return () => {
    voiceSplitsListeners.delete(listener);
  };
}

/** Defaults to on. Guarded around the property access itself, not just the read: a browser with site data blocked throws on `window.localStorage`. */
function readVoiceSplitsPreference(): boolean {
  try {
    return window.localStorage.getItem(VOICE_SPLITS_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The server has no preference to read, so it renders the default. */
function serverVoiceSplitsPreference(): boolean {
  return true;
}

function writeVoiceSplitsPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(VOICE_SPLITS_KEY, enabled ? "on" : "off");
  } catch {
    // Nothing to do — the preference simply won't outlive this run.
  }
  for (const listener of voiceSplitsListeners) listener();
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
export default function GpsRunClient() {
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
  /** Timestamped so run analysis can report cadence per split — the average alone cannot be laid against the track. */
  const [cadenceSamples, setCadenceSamples] = useState<CadenceSample[]>([]);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  /** User report: "No stop start button on GPS runs. Once paused you can only discard run." A paused run is not an abandoned run — everything recorded stays recorded, and this flips straight back. */
  const [paused, setPaused] = useState(false);
  const [pauses, setPauses] = useState<PauseInterval[]>([]);
  /** Discard is two-step on purpose: one mis-tap must never be able to destroy a recorded run. */
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
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
  /** Mirrors `pauses` so the once-a-second clock can read the current value without the interval being torn down and rebuilt on every pause. */
  const pausesRef = useRef<PauseInterval[]>([]);
  /** How many whole kilometres have already been read aloud this run, so each split is announced exactly once. */
  const announcedSplitsRef = useRef(0);
  /**
   * Whether to read the kilometre splits aloud. Remembered in localStorage
   * rather than on the profile: it is a property of the phone in the
   * athlete's pocket (which headphones, whether they are running with
   * company), not of the account, and it must be readable synchronously at
   * the moment a split lands with the screen locked — no round trip, and no
   * migration against a production database mid-submission.
   */
  const voiceSplits = useSyncExternalStore(
    subscribeVoiceSplits,
    readVoiceSplitsPreference,
    serverVoiceSplitsPreference
  );
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

  /** Every whole kilometre completed so far — what the voice callouts read from, and what the "Last km" tile shows. Same distance the Distance tile is built on, so the two can never disagree about when a kilometre finished. */
  const completedSplits = useMemo(
    () => (phase === "tracking" ? kilometreSplits(livePoints, pauses, startedAtRef.current) : []),
    [phase, livePoints, pauses]
  );
  const lastSplit = completedSplits.length > 0 ? completedSplits[completedSplits.length - 1] : null;

  // Voice callout at every kilometre (user feedback: "call out the splits
  // every 1km with how many km you are in"). Driven by the fixes arriving,
  // not by a timer, so it fires the moment the boundary is crossed and keeps
  // firing with the screen locked — native location callbacks still reach
  // the WebView in the background, timers do not. Each split is read once:
  // the ref remembers how many have been spoken, and if several complete at
  // once (a burst of fixes after a signal gap) only the latest is read, so a
  // backlog can't be recited on the athlete's ear one after another.
  useEffect(() => {
    if (phase !== "tracking" || paused) return;
    if (completedSplits.length <= announcedSplitsRef.current) return;
    // Still advanced when the voice is off, so turning it back on mid-run
    // reads the NEXT kilometre rather than reciting the ones it missed.
    const pending = completedSplits.length > announcedSplitsRef.current;
    announcedSplitsRef.current = completedSplits.length;
    if (!voiceSplits || !pending) return;
    void speak(splitAnnouncement(completedSplits[completedSplits.length - 1]));
  }, [phase, paused, completedSplits, voiceSplits]);

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
    try {
      if (hrSource === "airpods") {
        await stopAirPodsHeartRate();
      } else {
        await disconnectHeartRateMonitor();
      }
    } finally {
      // The app's own idea of the source is cleared whether or not the native
      // side managed to stop cleanly — a stuck plugin must not leave a
      // "connected" row on screen that can never be disconnected.
      setHrDeviceName(null);
      setHrSource(null);
      setLiveBpm(null);
    }
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
    setCadenceSamples([]);
    setPaused(false);
    setConfirmingDiscard(false);
    applyPauses([]);
    announcedSplitsRef.current = 0;
    try {
      await startGpsSession((point) => setLivePoints((prev) => [...prev, point]));
      if (isOnFootSport && isStepCadenceSupported()) {
        // Best-effort — a missing Motion & Fitness permission or an older
        // device without the M-series coprocessor just means no cadence
        // tile shows up later, never something that should block the run.
        startStepCadence((cadence) => {
          setLiveCadence(cadence);
          setCadenceSamples((prev) => [...prev, { spm: cadence, time: Date.now() }]);
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
          setCadenceSamples((prev) => [...prev, { spm: cadence, time: Date.now() }]);
        }).catch(() => {});
      }
      setLivePoints(recovered.points);
      applyPauses(recovered.livePauses);
      setPaused(recovered.wasPaused);
      setConfirmingDiscard(false);
      startedAtRef.current = recovered.startedAt;
      // Kilometres completed before the reload were announced by the JS
      // context that died; the next callout is the next NEW kilometre, not a
      // recap of every one so far.
      announcedSplitsRef.current = kilometreSplits(
        recovered.points,
        recovered.livePauses,
        recovered.startedAt
      ).length;
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
      setError("Couldn't pick that run back up. You can still save what was recorded below.");
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
   *
   * Pause and Resume are SYNCHRONOUS from the button's point of view. The
   * earlier version set a `pausing` flag, disabled the button, awaited the
   * write to native storage, and only then re-enabled it — so the Resume
   * button was exactly as usable as that write was prompt. Every persistence
   * call queues behind every other one (see withSessionLock in
   * gps-tracking.ts, where each incoming fix serialises the whole run), and
   * a queue that stalls — a bridge call left hanging while iOS suspended the
   * WebView, a slow write on a long run — left the athlete looking at a
   * greyed-out Play button with no way to carry on (user report: "Pause
   * button still does not let you resume your run after pressing it").
   *
   * The screen's own state is what the clock, the distance and the map read
   * from, so it flips here, immediately and unconditionally. Persisting the
   * pause is for recovery after an app kill, and it happens in the
   * background: if it is slow the run is still correct on screen, and if it
   * fails the run still saves from the same state the athlete watched.
   * Double-taps are guarded by the state itself — a second Pause while a
   * pause is open is a no-op, as is Resume with none open.
   */
  function handlePause() {
    if (paused || pausesRef.current.some((p) => p.endTime === null)) return;
    const now = Date.now();
    // Close the open hard/easy effort at the pause, so standing still never
    // lands inside a rep and drags its pace and heart rate down.
    if (isSegmentTracked && now > segmentStartRef.current) {
      setSegments((prev) => [...prev, { type: segmentType, startTime: segmentStartRef.current, endTime: now }]);
      segmentStartRef.current = now;
    }
    applyPauses([...pausesRef.current, { startTime: now, endTime: null }]);
    setPaused(true);
    void pauseGpsSession(now).catch(() => {});
  }

  /** Resume. The counterpart to the above — the run continues, with everything already recorded intact. */
  function handleResume() {
    if (!paused && !pausesRef.current.some((p) => p.endTime === null)) return;
    const now = Date.now();
    applyPauses(pausesRef.current.map((p) => (p.endTime === null ? { ...p, endTime: now } : p)));
    // The next effort segment starts from the resume, not from the pause.
    segmentStartRef.current = now;
    setPaused(false);
    setConfirmingDiscard(false);
    void resumeGpsSession(now).catch(() => {});
  }

  async function handleStop() {
    if (stopping) return;
    setStopping(true);
    setError("");
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
      /*
        THE RUN IS FINISHED THE MOMENT THE TRACK IS IN HAND. Everything after
        this line is teardown of optional extras — the heart-rate source, the
        pedometer, the lock-screen Live Activity — and none of it may stand
        between the athlete and their summary. It used to: each await here was
        unguarded, so an AirPods workout session that refused to stop (which
        HealthKit will do if it was never granted, or if the session was torn
        down underneath us) threw out of this function, `finally` cleared the
        spinner, and the Finish button simply did nothing, again and again,
        with a run recorded behind it (owner: "it would not let me finish the
        run as the button wouldn't work"). The summary and the phase change
        now come FIRST, and each teardown step is allowed to fail on its own.
      */
      setSummary(result);
      setPhase("reviewing");
      if (hrSource) await handleDisconnectHeartRate().catch(() => {});
      if (isOnFootSport) await stopStepCadence().catch(() => {});
      await endLiveActivity().catch(() => {});
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(
        detail
          ? `Couldn't stop tracking: ${detail}. Try again — nothing recorded has been lost.`
          : "Couldn't stop tracking. Try again — nothing recorded has been lost."
      );
    } finally {
      setStopping(false);
    }
  }

  /** Bails out of a run in progress — stops native tracking and the HR monitor same as a normal stop, but throws the track away instead of moving to review. Only reachable from a paused run, behind an explicit confirmation. */
  async function handleDiscardTracking() {
    setStopping(true);
    try {
      await stopGpsSession().catch(() => {});
      if (hrSource) await handleDisconnectHeartRate().catch(() => {});
      if (isOnFootSport) await stopStepCadence().catch(() => {});
      await endLiveActivity().catch(() => {});
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
    setCadenceSamples([]);
    setElapsedSeconds(0);
    setPaused(false);
    setConfirmingDiscard(false);
    applyPauses([]);
    announcedSplitsRef.current = 0;
    setLiveClockStartMs(0);
    setError("");
  }

  function buildOverviewResult(data: Record<string, unknown>): ScoreResultSummary {
    const sportIndex = (data.sportIndex as number | undefined) ?? 0;
    return {
      sport,
      sportLabel: SPORT_INDEX_LABELS[sport],
      sportIndex,
      personalIndex: (data.personalIndex as number | null | undefined) ?? null,
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
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildGpsActivityPayload({
            sport,
            sessionType,
            startedAtIso,
            summary: trackSummary,
            points: sourcePoints,
            pauses: sourcePauses,
            hrReadings,
            cadenceSamples,
            segments,
          })
        ),
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
          <GpsMap points={movingPoints} className="h-full w-full" emptyTone="dark" />
          {/*
            No fix after fifteen seconds is almost always a permission, not a
            satellite. Say so, on the HUD, instead of leaving a pale box that
            reads as a blank map (owner: "the gps fixing wont load anymore and
            the map screen is blank").
          */}
          {movingPoints.length === 0 && elapsedSeconds >= 15 && (
            <div
              className="pointer-events-none absolute inset-x-4 rounded-2xl border border-warning/30 bg-black/80 px-4 py-3 text-xs leading-relaxed text-white/85 backdrop-blur"
              style={{ bottom: "1rem" }}
            >
              <p className="font-semibold text-warning">Still waiting for a GPS fix</p>
              <p className="mt-0.5">
                Check that Location is allowed for Split Index (Settings → Privacy &amp; Security →
                Location Services) and that you are outdoors with a view of the sky. Tracking
                starts the moment a fix arrives.
              </p>
            </div>
          )}
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
            {/*
              HIERARCHY, NOT A LIST. Distance and moving time are the two
              numbers a runner glances at mid-run, so they are the hero pair at
              twice the size of everything else; pace, the last split, heart
              rate, elevation and cadence are a row of matching tiles beneath.
              The previous HUD had one 60px clock and six equal tiles under it,
              which made distance as prominent as cadence.
            */}
            <div className="grid w-full max-w-sm grid-cols-2 gap-2.5">
              <StatTile
                size="lg"
                icon={MapPin}
                label="Distance"
                value={`${(liveDistanceMeters / 1000).toFixed(2)} km`}
              />
              <StatTile size="lg" icon={Timer} label="Moving time" value={formatElapsed(elapsedSeconds)} />
            </div>

            {isSegmentTracked && !paused && (
              <button
                type="button"
                onClick={toggleSegment}
                className={`mt-3 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition-colors ${
                  segmentType === "hard"
                    ? "bg-danger text-white shadow-lg shadow-danger/30"
                    : "bg-white/15 text-white"
                }`}
              >
                <Zap className="h-4 w-4" fill="currentColor" />
                {segmentType === "hard" ? "Hard effort — tap for easy" : "Easy — tap to go hard"}
              </button>
            )}

            <div className="mt-2.5 grid w-full max-w-sm grid-cols-3 gap-2.5">
              <StatTile icon={Gauge} label={sport === "outdoor_cycling" ? "Avg speed" : "Avg split"} value={formatPaceOrSpeed(sport, livePaceSecondsPerKm)} />
              <StatTile label={sport === "outdoor_cycling" ? "Speed now" : "Pace now"} value={formatPaceOrSpeed(sport, currentPaceSecondsPerKm)} />
              {/* The most recent whole-kilometre split — the same number the
                  voice callout just read, kept on screen for a glance-check
                  when it was missed under traffic noise. */}
              {lastSplit && (
                <StatTile tone="accent" label={`Km ${lastSplit.km}`} value={formatPaceOrSpeed(sport, lastSplit.splitSeconds)} />
              )}
              {liveBpm !== null && <StatTile tone="danger" icon={HeartPulse} label="Heart rate" value={liveBpm} />}
              {liveElevationGainMeters !== null && (
                <StatTile tone="warning" icon={Mountain} label="Climb" value={`${Math.round(liveElevationGainMeters)} m`} />
              )}
              {liveCadence !== null && <StatTile icon={Footprints} label="Cadence" value={`${liveCadence}`} />}
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
                      className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-2 text-center"
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

          {/* Controls. Two big targets, both sized to be hit at a run with wet
              hands: pause/resume and finish. Discard is not among them — it
              lives behind a pause AND a confirmation, because the one thing
              this screen must never do is destroy a recorded run on a
              mis-tap (user report: "Once paused you can only discard run"). */}
          <div className="flex w-full max-w-sm shrink-0 flex-col items-center gap-4">
            {error && (
              <p role="alert" className="w-full rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs text-white">
                {error}
              </p>
            )}
            <div className="flex items-center justify-center gap-8">
              <button
                type="button"
                onClick={paused ? handleResume : handlePause}
                disabled={stopping}
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
                disabled={stopping}
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
                    Everything recorded up to where it stopped can be saved as the finished run.
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
                  Save run
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOrphaned(null)}>
                  Discard
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/*
        THE START SCREEN, REBUILT (4 Oct 2026). What was here: a single card
        with everything stacked and centred — a 64px icon medallion, a
        paragraph, two native selects, a hand-rolled toggle, two full-width
        secondary buttons, a paragraph about Garmin, and a 96px green circle
        that said "Start". It read as a settings form with a button in the
        middle (owner: "tacky and doesn't look great").

        Now it is laid out like the rest of the Engine: a hero that names
        what you are about to do, with the sport as three tiles you can hit
        with a thumb; a settings list, one row per decision, each with an icon
        tile, a label and a one-line explanation; and one full-width primary
        button at the bottom that says what it starts. Every control and every
        handler is the same — only the arrangement changed.
      */}
      {phase === "idle" && (() => {
        const meta = GPS_SPORT_META[sport];
        const SportIcon = meta.icon;
        return (
          <div className="space-y-4">
            <Card padding="md" className="overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="micro-label text-muted">Live tracking</p>
                  <h2 className="headline-tight mt-1 text-2xl font-bold">
                    Record a {meta.noun}
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    Lock your phone and put it away — tracking keeps going in the background and
                    the run is saved like any other session.
                  </p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                  <SportIcon className="h-6 w-6" aria-hidden />
                </span>
              </div>

              <div className="mt-5">
                <p className="micro-label mb-2 text-muted">Sport</p>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Sport">
                  {GPS_SPORTS.map((option) => {
                    const m = GPS_SPORT_META[option.value];
                    const Icon = m.icon;
                    const active = sport === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSport(option.value)}
                        className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl border text-sm font-semibold transition-colors ${
                          active
                            ? "border-accent/50 bg-accent/15 text-accent"
                            : "border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                        {m.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <Select
                  label="Session type"
                  value={sessionType}
                  onChange={(e) => setSessionType(e.target.value as SessionType)}
                  options={SESSION_TYPES}
                />
                {isSegmentTracked && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
                    <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                    You will get a Hard/Easy toggle while tracking, so each effort is marked as it
                    happens and scored separately from the rest.
                  </p>
                )}
              </div>
            </Card>

            <Card padding="md">
              <p className="micro-label mb-3 text-muted">Before you go</p>
              <ul className="divide-y divide-white/[0.06]">
                {/* Spoken splits. On the GPS screen rather than buried in
                    Settings: it is a per-run decision (headphones in or not,
                    running alone or with someone) made in the ten seconds
                    before pressing Start, which is exactly here. */}
                <li className="py-3 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={voiceSplits}
                    onClick={() => writeVoiceSplitsPreference(!voiceSplits)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${voiceSplits ? "bg-accent/15 text-accent" : "bg-white/[0.06] text-muted"}`}>
                      {voiceSplits ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">Call out every kilometre</span>
                      <span className="block text-xs text-muted">Split time read aloud as each km completes.</span>
                    </span>
                    <span
                      className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${voiceSplits ? "bg-accent" : "bg-white/20"}`}
                      aria-hidden
                    >
                      <span className={`h-6 w-6 rounded-full bg-white shadow transition-transform ${voiceSplits ? "translate-x-5" : "translate-x-0"}`} />
                    </span>
                  </button>
                </li>

                <li className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hrDeviceName ? "bg-danger/15 text-danger" : "bg-white/[0.06] text-muted"}`}>
                      <HeartPulse className="h-5 w-5" aria-hidden fill={hrDeviceName ? "currentColor" : "none"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {hrDeviceName ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">Heart rate connected</p>
                            <p className="truncate text-xs text-muted">{hrDeviceName}</p>
                          </div>
                          <Button size="sm" variant="ghost" onClick={handleDisconnectHeartRate}>
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold">Heart rate</p>
                          <p className="text-xs leading-relaxed text-muted">
                            Optional. Bluetooth works with Garmin watches and Polar or Wahoo chest
                            straps. AirPods go through Apple Health: connecting opens an Apple
                            workout session so the sensor switches on, and iOS shows its own workout
                            indicator — nothing is recorded here until you press Start.
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={connectingHr === "ble"}
                              disabled={connectingHr === "airpods"}
                              onClick={handleConnectHeartRate}
                            >
                              <Bluetooth className="h-4 w-4" aria-hidden />
                              Connect monitor
                            </Button>
                            {isAirPodsHeartRateSupported() && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={connectingHr === "airpods"}
                                disabled={connectingHr === "ble"}
                                onClick={handleConnectAirPods}
                              >
                                <HeartPulse className="h-4 w-4" aria-hidden />
                                Use AirPods
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                      {hrError && <p className="mt-2 text-xs text-danger">{hrError}</p>}
                    </div>
                  </div>
                </li>

                <li className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted">
                      <Thermometer className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Weather is automatic</p>
                      <p className="text-xs text-muted">Temperature is recorded from your starting location.</p>
                    </div>
                  </div>
                </li>
              </ul>
            </Card>

            <Button
              size="lg"
              className="w-full"
              onClick={handleStart}
              loading={starting}
              aria-label={`Start ${meta.noun}`}
            >
              <MapPin className="h-5 w-5" aria-hidden />
              Start {meta.noun}
            </Button>
          </div>
        );
      })()}

      {phase === "reviewing" && summary && (() => {
        const meta = GPS_SPORT_META[sport];
        const avgHr =
          hrReadings.length > 0
            ? Math.round(hrReadings.reduce((sum, r) => sum + r.bpm, 0) / hrReadings.length)
            : null;
        const avgCadence =
          cadenceSamples.length > 0
            ? Math.round(cadenceSamples.reduce((sum, c) => sum + c.spm, 0) / cadenceSamples.length)
            : null;
        const hardEfforts = isSegmentTracked ? segments.filter((s) => s.type === "hard").length : 0;
        return (
          <div className="space-y-4">
            {/*
              THE REVIEW, AS A FINISHED THING. The route on top, then the two
              numbers a runner looks for first — distance and moving time — at
              hero size, then everything else as the same tiles the live HUD
              used. Save is the one primary action and is full width; discard
              is a quieter secondary beside it, and both stay above the fold.
            */}
            <Card padding="md" className="overflow-hidden">
              {movingPoints.length > 0 && (
                <GpsMap points={movingPoints} className="-mx-5 -mt-5 mb-4 h-52 w-[calc(100%+2.5rem)] md:-mx-6 md:-mt-6 md:w-[calc(100%+3rem)]" />
              )}
              <div className="flex items-center gap-2">
                <CircleCheck className="h-4 w-4 text-accent" aria-hidden />
                <p className="micro-label text-accent">{meta.short} complete</p>
                <span className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-muted">
                  {SESSION_TYPES.find((s) => s.value === sessionType)?.label ?? sessionType}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <StatTile
                  size="lg"
                  icon={MapPin}
                  label="Distance"
                  value={`${(summary.distanceMeters / 1000).toFixed(2)} km`}
                />
                <StatTile size="lg" icon={Timer} label="Moving time" value={formatElapsed(summary.durationSeconds)} />
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <StatTile icon={Gauge} label={sport === "outdoor_cycling" ? "Avg speed" : "Avg split"} value={formatPaceOrSpeed(sport, summary.avgPaceSecondsPerKm)} />
                {summary.elevationGainMeters !== null && (
                  <StatTile tone="warning" icon={Mountain} label="Elevation" value={`${Math.round(summary.elevationGainMeters)} m`} />
                )}
                {avgHr !== null && <StatTile tone="danger" icon={HeartPulse} label="Avg heart rate" value={`${avgHr} bpm`} />}
                {avgCadence !== null && <StatTile icon={Footprints} label="Avg cadence" value={`${avgCadence} spm`} />}
              </div>

              {reviewPrediction && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-cardio-accent-soft" aria-hidden />
                    <p className="micro-label text-muted">Predicted at this pace &amp; effort</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {reviewPrediction.map((entry) => (
                      <div
                        key={entry.label}
                        className="flex min-w-0 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-2.5 text-center"
                      >
                        <p className="micro-label text-white/55">{entry.label}</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-white">{formatRaceTime(entry.seconds)}</p>
                        <p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
                          {Math.round(entry.score)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hardEfforts > 0 && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-accent/25 bg-accent/5 p-3 text-xs leading-relaxed text-foreground/90">
                  <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span>
                    {hardEfforts} hard effort{hardEfforts === 1 ? "" : "s"} logged — your score will be
                    calibrated off the work-effort pace and heart rate, not the whole-session average.
                  </span>
                </div>
              )}

              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
                <Thermometer className="h-3.5 w-3.5" aria-hidden />
                Temperature was recorded from your starting location and shows on the saved activity.
              </p>
            </Card>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={handleDiscardReview} disabled={saving} aria-label={`Discard ${meta.noun}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Discard
              </Button>
              <Button
                size="lg"
                className="h-12 min-h-12 flex-1 rounded-2xl text-sm"
                loading={saving}
                onClick={() =>
                  submitSummary(summary, new Date(Date.now() - summary.durationSeconds * 1000).toISOString())
                }
              >
                <CircleCheck className="h-5 w-5" aria-hidden />
                Save {meta.noun}
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
