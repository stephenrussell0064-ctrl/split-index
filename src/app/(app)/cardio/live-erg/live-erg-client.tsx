"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  Bike,
  Bluetooth,
  CircleCheck,
  Flame,
  HeartPulse,
  Pause,
  Play,
  Square,
  Timer,
  Trash2,
  Waves,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SuccessScreen, type ScoreResultSummary } from "@/components/activities/success-screen";
import { SESSION_TYPES, SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { isNativePlatform } from "@/lib/native/platform";
import { createClient } from "@/lib/supabase/client";
import { ageFromDateOfBirth } from "@/lib/utils/age";
import { connectHeartRateMonitor, disconnectHeartRateMonitor } from "@/lib/native/heart-rate";
import { isLiveActivitySupported, startLiveActivity, updateLiveActivity, endLiveActivity } from "@/lib/native/live-activity";
import { clearErgSession, loadErgSession, saveErgSession, type ErgSessionRecord } from "@/lib/native/erg-session";
import { estimateSessionEnergy, type LiveSport } from "@/lib/scoring/energy";
import { isPaused as readingIsPaused, type HrReading, type PauseInterval } from "@/lib/scoring/gps-track";
import { buildErgActivityPayload, pausedSeconds, summariseErgSession } from "./submission";
import type { SessionType } from "@/types";

type Phase = "idle" | "tracking" | "reviewing" | "overview";

/** The two sports this screen records. The launcher's tiles must not get ahead of this list. */
const LIVE_SPORTS: { value: LiveSport; label: string; noun: string; icon: typeof Bike }[] = [
  { value: "rowing", label: "Rowing", noun: "row", icon: Waves },
  { value: "bike_erg", label: "BikeErg", noun: "bike erg session", icon: Bike },
];

/**
 * The wall clock, read from an event handler.
 *
 * The React Compiler's purity rule flags `Date.now()` inside a function
 * declared in a component body as a render-time read even when that function
 * is only ever passed to onClick — the GPS client escapes it by accident of
 * its shape. Every call site below is a tap: Start, Pause, Resume, Finish,
 * Resume-recovered. Render reads the ticking `nowMs` state instead.
 */
function clockNow(): number {
  return Date.now();
}

function isLiveSport(value: string | null): value is LiveSport {
  return value === "rowing" || value === "bike_erg";
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  size = "md",
  caption,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof Timer;
  tone?: "neutral" | "accent" | "danger" | "warning";
  size?: "md" | "lg";
  caption?: string;
}) {
  const frame =
    tone === "accent"
      ? "border-cardio-accent/30 bg-cardio-accent/10"
      : tone === "danger"
        ? "border-danger/25 bg-danger/10"
        : tone === "warning"
          ? "border-warning/25 bg-warning/10"
          : "border-white/10 bg-white/[0.06]";
  const labelTone = tone === "danger" ? "text-danger/80" : tone === "warning" ? "text-warning/80" : "text-white/55";
  return (
    <div className={`flex min-w-0 flex-col items-center justify-center rounded-2xl border px-2 text-center ${frame} ${size === "lg" ? "py-3.5" : "py-2.5"}`}>
      <div className={`mb-1 flex items-center justify-center gap-1.5 ${labelTone}`}>
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        <p className="micro-label">{label}</p>
      </div>
      <p className={`index-display tabular-nums text-white ${size === "lg" ? "text-2xl font-bold" : "text-lg font-bold"}`}>
        {value}
      </p>
      {caption && <p className="mt-0.5 text-[10px] text-white/45">{caption}</p>}
    </div>
  );
}

export default function LiveErgClient() {
  return (
    <Suspense fallback={null}>
      <LiveErgScreen />
    </Suspense>
  );
}

/**
 * Live recording for a rowing machine or bike erg.
 *
 * There is no GPS to track indoors, so what this screen does is keep the
 * clock, read a Bluetooth heart-rate strap or watch, and estimate the
 * calories the session has cost so far from that heart rate
 * (lib/scoring/energy.ts). Apple Health is deliberately not involved here —
 * no HealthKit session is started from this screen. The distance is the
 * erg's own monitor's number and is typed in at the finish, where it turns
 * into the split the rowing score needs.
 *
 * The session record lives outside React (lib/native/erg-session.ts) so a
 * killed app or a reloaded tab comes back to the session in progress rather
 * than to a blank start screen.
 */
function LiveErgScreen() {
  const params = useSearchParams();
  const requestedSport = params.get("sport");
  const hpeSessionId = params.get("hpeSession");

  const [phase, setPhase] = useState<Phase>("idle");
  const [sport, setSport] = useState<LiveSport>(isLiveSport(requestedSport) ? requestedSport : "rowing");
  const [sessionType, setSessionType] = useState<SessionType>("easy");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  /** Mirrors startedAtRef for render; the ref is what the once-a-second clock and the handlers read. */
  const [startedAt, setStartedAt] = useState(0);
  /** The clock's last tick. What the live calories integrate up to — render must not read Date.now() itself. */
  const [nowMs, setNowMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pauses, setPauses] = useState<PauseInterval[]>([]);
  const [hrReadings, setHrReadings] = useState<HrReading[]>([]);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [hrDeviceName, setHrDeviceName] = useState<string | null>(null);
  const [hrSource, setHrSource] = useState<"ble" | null>(null);
  const [connectingHr, setConnectingHr] = useState(false);
  const [hrError, setHrError] = useState("");
  const [recovered, setRecovered] = useState<ErgSessionRecord | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [distanceInput, setDistanceInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState("");
  const [overviewResult, setOverviewResult] = useState<ScoreResultSummary | null>(null);
  const [overviewIsPremium, setOverviewIsPremium] = useState(false);
  const [savedActivityId, setSavedActivityId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ weightKg: number | null; age: number | null; sex: "male" | "female" } | null>(null);

  const startedAtRef = useRef(0);
  const pausesRef = useRef<PauseInterval[]>([]);
  const readingsRef = useRef<HrReading[]>([]);
  const lastPersistRef = useRef(0);

  const native = isNativePlatform();
  const meta = LIVE_SPORTS.find((s) => s.value === sport)!;

  function applyPauses(next: PauseInterval[]) {
    pausesRef.current = next;
    setPauses(next);
  }

  // The athlete's numbers the calorie model needs. Read once; a missing
  // weight becomes a caveat on the screen rather than a blocked session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("weight_kg, date_of_birth, age, gender")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data || cancelled) return;
      setProfile({
        weightKg: data.weight_kg != null ? Number(data.weight_kg) : null,
        age: ageFromDateOfBirth(data.date_of_birth as string | null) ?? (data.age != null ? Number(data.age) : null),
        sex: data.gender === "female" ? "female" : "male",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A session this device was in the middle of.
  useEffect(() => {
    let cancelled = false;
    void loadErgSession().then((record) => {
      if (record && !cancelled) setRecovered(record);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The clock. Date-based so a backgrounded tab does not drift.
  useEffect(() => {
    if (phase !== "tracking") return;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      setElapsedSeconds(Math.max(0, Math.floor((now - startedAtRef.current) / 1000 - pausedSeconds(pausesRef.current, now))));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  function persist(partial: Partial<ErgSessionRecord> = {}) {
    void saveErgSession({
      sport,
      sessionType,
      startedAt: startedAtRef.current,
      pauses: pausesRef.current,
      hrReadings: readingsRef.current,
      hrSource,
      hpeSessionId,
      ...partial,
    });
  }

  function onHeartRate(reading: HrReading) {
    setLiveBpm(reading.bpm);
    readingsRef.current = [...readingsRef.current, reading];
    setHrReadings(readingsRef.current);
    // Persist at most every five seconds — a strap reports once a second,
    // and a Preferences write per beat is more than the record needs.
    if (startedAtRef.current > 0 && reading.time - lastPersistRef.current > 5000) {
      lastPersistRef.current = reading.time;
      persist();
    }
  }

  const movingReadings = useMemo(
    () => hrReadings.filter((r) => !readingIsPaused(r.time, pauses)),
    [hrReadings, pauses]
  );

  const liveEnergy = useMemo(() => {
    if (phase !== "tracking" || !profile) return null;
    return estimateSessionEnergy({
      sport,
      readings: movingReadings,
      movingSeconds: elapsedSeconds,
      endTime: paused ? (pauses[pauses.length - 1]?.startTime ?? nowMs) : nowMs,
      profile,
    });
  }, [phase, profile, sport, movingReadings, elapsedSeconds, paused, pauses, nowMs]);

  // The lock-screen card: the same timer the GPS run uses, the sport's name
  // as its title, with the calories where the pace would be.
  useEffect(() => {
    if (phase !== "tracking" || !isLiveActivitySupported()) return;
    updateLiveActivity({
      startDateEpochMs: Date.now() - elapsedSeconds * 1000,
      isPaused: paused,
      pausedElapsedSeconds: elapsedSeconds,
      paceOrSpeedText: liveEnergy ? `${Math.round(liveEnergy.kcal)} kcal` : undefined,
      heartRateBpm: liveBpm ?? undefined,
    }).catch(() => {});
    // elapsedSeconds is deliberately excluded: the native timer ticks itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, liveBpm, liveEnergy?.kcal]);

  async function handleConnectHeartRate() {
    if (connectingHr) return;
    setConnectingHr(true);
    setHrError("");
    try {
      const device = await connectHeartRateMonitor(onHeartRate);
      setHrDeviceName(device.name);
      setHrSource("ble");
    } catch {
      setHrError("Couldn't connect — make sure the monitor is on and in pairing range.");
    } finally {
      setConnectingHr(false);
    }
  }

  async function handleDisconnectHeartRate() {
    try {
      await disconnectHeartRateMonitor();
    } finally {
      setHrDeviceName(null);
      setHrSource(null);
      setLiveBpm(null);
    }
  }

  function handleStart() {
    if (recovered) {
      setError("Save or discard the recovered session above before starting a new one.");
      return;
    }
    setError("");
    startedAtRef.current = clockNow();
    setStartedAt(startedAtRef.current);
    applyPauses([]);
    readingsRef.current = readingsRef.current.filter((r) => r.time >= startedAtRef.current);
    setHrReadings(readingsRef.current);
    setElapsedSeconds(0);
    setPaused(false);
    setPhase("tracking");
    persist();
    if (isLiveActivitySupported()) {
      startLiveActivity("gpsTracking", meta.label, { startDateEpochMs: startedAtRef.current }).catch(() => {});
    }
  }

  function handleRejoin() {
    if (!recovered) return;
    setSport(recovered.sport);
    setSessionType(recovered.sessionType);
    startedAtRef.current = recovered.startedAt;
    setStartedAt(recovered.startedAt);
    readingsRef.current = recovered.hrReadings;
    setHrReadings(recovered.hrReadings);
    // Come back PAUSED: the athlete was not rowing while the app was gone,
    // and a clock that quietly kept counting would be wrong by exactly that.
    const open = recovered.pauses.find((p) => p.endTime == null);
    const next = open ? recovered.pauses : [...recovered.pauses, { startTime: clockNow(), endTime: null }];
    applyPauses(next);
    setPaused(true);
    setRecovered(null);
    setPhase("tracking");
    persist({ pauses: next });
  }

  function handlePause() {
    const next = [...pausesRef.current, { startTime: clockNow(), endTime: null }];
    applyPauses(next);
    setPaused(true);
    persist({ pauses: next });
  }

  function handleResume() {
    const next = pausesRef.current.map((p, i) => (i === pausesRef.current.length - 1 && p.endTime == null ? { ...p, endTime: clockNow() } : p));
    applyPauses(next);
    setPaused(false);
    persist({ pauses: next });
  }

  function handleStop() {
    const now = clockNow();
    const closed = pausesRef.current.map((p) => (p.endTime == null ? { ...p, endTime: now } : p));
    applyPauses(closed);
    setPaused(false);
    setEndedAt(now);
    setPhase("reviewing");
    if (isLiveActivitySupported()) endLiveActivity().catch(() => {});
  }

  async function handleDiscard() {
    if (!confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    await clearErgSession().catch(() => {});
    if (isLiveActivitySupported()) endLiveActivity().catch(() => {});
    setRecovered(null);
    setConfirmingDiscard(false);
    setEndedAt(null);
    setElapsedSeconds(0);
    applyPauses([]);
    readingsRef.current = [];
    setHrReadings([]);
    setDistanceInput("");
    setPhase("idle");
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
      predictedBenchmarkAfterSession: data.predictedBenchmarkAfterSession as ScoreResultSummary["predictedBenchmarkAfterSession"],
      sessionType,
    };
  }

  async function handleSave() {
    if (saving || endedAt == null) return;
    const distance = distanceInput.trim() === "" ? null : Number(distanceInput);
    if (distance != null && (!Number.isFinite(distance) || distance < 0)) {
      setError("Distance should be the metres shown on the monitor.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = buildErgActivityPayload({
        sport,
        sessionType,
        startedAt,
        endedAt,
        pauses,
        hrReadings,
        hrSource,
        profile: profile ?? { weightKg: null, age: null, sex: "male" },
        distanceMeters: distance,
        hpeSessionId,
      });
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save this session. Please try again.");
        return;
      }
      await clearErgSession().catch(() => {});
      if (hrSource) handleDisconnectHeartRate().catch(() => {});
      setOverviewIsPremium(!data.premium_required);
      setOverviewResult(buildOverviewResult(data));
      const activityId = (data.activity as { id?: string } | undefined)?.id ?? data.activity_id;
      setSavedActivityId(typeof activityId === "string" ? activityId : null);
      setPhase("overview");
    } catch {
      setError("Could not save this session. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (phase === "overview" && overviewResult) {
    return (
      <SuccessScreen
        result={overviewResult}
        onLogAnother={() => {
          setOverviewResult(null);
          setSavedActivityId(null);
          setEndedAt(null);
          setElapsedSeconds(0);
          applyPauses([]);
          readingsRef.current = [];
          setHrReadings([]);
          setDistanceInput("");
          setPhase("idle");
        }}
        isPremium={overviewIsPremium}
        redirectPath={savedActivityId ? `/activities/${savedActivityId}` : "/cardio"}
        redirectLabel={savedActivityId ? "the full breakdown of this session" : undefined}
        redirectButtonLabel={savedActivityId ? "See the full breakdown" : undefined}
      />
    );
  }

  if (phase === "tracking") {
    const SportIcon = meta.icon;
    return createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex flex-1 flex-col items-center justify-between overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black px-3 py-1.5 text-xs font-bold text-white">
              {paused ? (
                <>
                  <Pause className="h-3 w-3 text-warning" fill="currentColor" />
                  Paused — your session is safe
                </>
              ) : (
                <>
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
                  Recording
                </>
              )}
            </div>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-white/70">
              <SportIcon className="h-4 w-4" aria-hidden />
              {meta.label}
            </span>
          </div>

          <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center">
              <p className="micro-label text-white/55">Time</p>
              <p className="index-display mt-1 text-7xl font-bold tabular-nums text-white">{formatElapsed(elapsedSeconds)}</p>
            </div>
            <div className="grid w-full max-w-sm grid-cols-2 gap-2.5">
              <StatTile
                size="lg"
                tone="danger"
                icon={HeartPulse}
                label="Heart rate"
                value={liveBpm != null ? `${liveBpm}` : "—"}
                caption={hrDeviceName ? hrDeviceName : "No source connected"}
              />
              <StatTile
                size="lg"
                tone="warning"
                icon={Flame}
                label="Calories"
                value={liveEnergy ? `${Math.round(liveEnergy.kcal)}` : "—"}
                caption={
                  !liveEnergy
                    ? undefined
                    : liveEnergy.method === "heart-rate"
                      ? "From your heart rate"
                      : "Rough estimate — connect heart rate for a real one"
                }
              />
            </div>
            {liveEnergy?.assumed && (
              <p className="max-w-sm text-center text-xs text-white/55">
                Your profile has no bodyweight, so the calories assume 75 kg. Add it on your profile for your own number.
              </p>
            )}
          </div>

          <div className="w-full max-w-sm space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              {paused ? (
                <Button variant="endurance" size="lg" onClick={handleResume}>
                  <Play className="mr-2 h-4 w-4" aria-hidden />
                  Resume
                </Button>
              ) : (
                <Button variant="secondary" size="lg" onClick={handlePause}>
                  <Pause className="mr-2 h-4 w-4" aria-hidden />
                  Pause
                </Button>
              )}
              <Button variant="destructive" size="lg" onClick={handleStop}>
                <Square className="mr-2 h-4 w-4" aria-hidden />
                Finish
              </Button>
            </div>
            {!hrDeviceName && native && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="ghost" size="sm" loading={connectingHr} onClick={handleConnectHeartRate}>
                  <Bluetooth className="mr-1.5 h-4 w-4" aria-hidden />
                  Connect heart rate
                </Button>
              </div>
            )}
            {hrError && <p className="text-center text-xs text-danger">{hrError}</p>}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (phase === "reviewing" && endedAt != null) {
    const summary = summariseErgSession({
      sport,
      startedAt,
      endedAt,
      pauses,
      hrReadings,
      hrSource,
      profile: profile ?? { weightKg: null, age: null, sex: "male" },
    });
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="The Engine" title={`${meta.label} complete`} subtitle="Check the numbers, add the distance off the monitor, and save." />
        <Card padding="md">
          <div className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 text-accent" aria-hidden />
            <p className="micro-label text-accent">{meta.label} complete</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <StatTile size="lg" icon={Timer} label="Moving time" value={formatElapsed(summary.movingSeconds)} />
            <StatTile
              size="lg"
              tone="warning"
              icon={Flame}
              label="Calories"
              value={`${Math.round(summary.energy.kcal)} kcal`}
              caption={summary.energy.method === "heart-rate" ? "From your heart rate" : "Rough estimate, no heart rate"}
            />
          </div>
          {summary.avgHr != null && (
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <StatTile tone="danger" icon={HeartPulse} label="Avg heart rate" value={`${summary.avgHr} bpm`} />
              <StatTile tone="danger" icon={HeartPulse} label="Max heart rate" value={`${summary.maxHr} bpm`} />
            </div>
          )}

          <div className="mt-5">
            <Input
              label={`Distance on the monitor${sport === "rowing" ? " (metres)" : " (metres, optional)"}`}
              type="number"
              inputMode="numeric"
              placeholder="e.g. 5000"
              value={distanceInput}
              onChange={(e) => setDistanceInput(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted">
              {sport === "rowing"
                ? "The erg's own distance. With it the session gets a 500m split and a rowing score; without it only time and heart rate are kept."
                : "Optional. The monitor's distance, if you want it on the session."}
            </p>
          </div>
          <div className="mt-3">
            <Select
              label="Session type"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as SessionType)}
              options={SESSION_TYPES}
            />
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <div className="mt-5 flex gap-2.5">
            <Button variant="endurance" size="lg" className="flex-1" loading={saving} onClick={handleSave}>
              Save session
            </Button>
            <Button variant={confirmingDiscard ? "destructive" : "ghost"} size="lg" onClick={handleDiscard}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
              {confirmingDiscard ? "Really discard" : "Discard"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const SportIcon = meta.icon;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="The Engine" title="Record indoors" subtitle="Time, heart rate and calories as you go — on a rowing machine or bike erg." />

      {recovered && (
        <Card padding="md" className="border-warning/30">
          <p className="micro-label text-warning">Session in progress</p>
          <p className="mt-1 text-sm text-foreground/90">
            A {LIVE_SPORTS.find((s) => s.value === recovered.sport)?.label.toLowerCase()} session started at{" "}
            {new Date(recovered.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} was still running
            when the app closed. Pick it up where you left off, or discard it.
          </p>
          <div className="mt-3 flex gap-2.5">
            <Button variant="endurance" onClick={handleRejoin}>
              Resume session
            </Button>
            <Button variant={confirmingDiscard ? "destructive" : "ghost"} onClick={handleDiscard}>
              {confirmingDiscard ? "Really discard" : "Discard"}
            </Button>
          </div>
        </Card>
      )}

      <Card padding="md" className="overflow-hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro-label text-muted">Live session</p>
            <h2 className="headline-tight mt-1 text-2xl font-bold">Record a {meta.noun}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              The clock runs here; the distance comes off the machine&apos;s monitor at the end. Connect a Bluetooth strap
              or watch for a calories figure built from your own heart rate.
            </p>
          </div>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <SportIcon className="h-6 w-6" aria-hidden />
          </span>
        </div>

        <div className="mt-5">
          <p className="micro-label mb-2 text-muted">Machine</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Machine">
            {LIVE_SPORTS.map((option) => {
              const Icon = option.icon;
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
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <Select label="Session type" value={sessionType} onChange={(e) => setSessionType(e.target.value as SessionType)} options={SESSION_TYPES} />
        </div>
      </Card>

      <Card padding="md">
        <p className="micro-label mb-3 text-muted">Heart rate</p>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hrDeviceName ? "bg-danger/15 text-danger" : "bg-white/[0.06] text-muted"}`}>
            <HeartPulse className="h-5 w-5" aria-hidden fill={hrDeviceName ? "currentColor" : "none"} />
          </span>
          <div className="min-w-0 flex-1">
            {hrDeviceName ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Heart rate connected</p>
                  <p className="truncate text-xs text-muted">
                    {hrDeviceName}
                    {liveBpm != null ? ` · ${liveBpm} bpm` : ""}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={handleDisconnectHeartRate}>
                  Disconnect
                </Button>
              </div>
            ) : native ? (
              <>
                <p className="text-sm font-semibold">Connect a strap or watch</p>
                <p className="text-xs leading-relaxed text-muted">
                  Bluetooth works with Garmin watches and Polar or Wahoo chest straps. Without one the calories are a
                  rough estimate from the sport and your bodyweight.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" loading={connectingHr} onClick={handleConnectHeartRate}>
                    <Bluetooth className="mr-1.5 h-4 w-4" aria-hidden />
                    Connect over Bluetooth
                  </Button>
                </div>
                {hrError && <p className="mt-2 text-xs text-danger">{hrError}</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold">Heart rate needs the app</p>
                <p className="text-xs leading-relaxed text-muted">
                  A browser cannot read a chest strap. The timer and a rough calories estimate still work here; for heart
                  rate, record from the Split Index app.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button variant="endurance" size="lg" className="w-full" onClick={handleStart} disabled={Boolean(recovered)}>
        <Play className="mr-2 h-4 w-4" aria-hidden />
        Start {meta.label.toLowerCase()}
      </Button>
    </div>
  );
}
