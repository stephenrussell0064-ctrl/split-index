"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  isLiveActivitySupported,
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  getLiveActivityState,
} from "@/lib/native/live-activity";

const REST_PRESETS_SECONDS = [60, 90, 120, 180];
const MIN_CUSTOM_REST_SECONDS = 5;
const MAX_CUSTOM_REST_SECONDS = 3600;

/**
 * Survives an in-app tab switch (user feedback: "if you click off the lab
 * onto another tab within split index... it stops the timer and resets all
 * your logged details"). sessionStorage, not the server — this is
 * ephemeral in-progress state, not permanent training data, and needs to
 * survive a component unmount/remount within the same browser tab, not a
 * full app relaunch (workout_drafts already covers the actual logged sets
 * across a real relaunch — see use-autosave.ts).
 */
const STORAGE_KEY = "split-index-gym-timer";

interface PersistedTimerState {
  running: boolean;
  pausedElapsedMs: number;
  effectiveStartMs: number | null;
  restEndMs: number | null;
  hasLiveActivity: boolean;
}

function loadPersistedState(): PersistedTimerState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedTimerState;
  } catch {
    return null;
  }
}

/** Exported so activity-form.tsx can clear a just-finished workout's timer state on successful save — otherwise the next fresh workout would restore stale elapsed time from the one that just got submitted. */
export function clearPersistedGymTimerState() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort — a lost persisted state just means the next mount starts fresh.
  }
}

/**
 * Web Audio + Vibration API alert — no new native dependency (unlike the
 * GPS run tracking work, this doesn't need a Capacitor plugin: a plain
 * oscillator beep works in every WebView including iOS, where
 * navigator.vibrate is unsupported; Android gets both).
 */
function playRestOverAlert() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio unavailable (e.g. autoplay policy without prior user gesture) —
    // the visual "Rest over!" state and vibration below still fire.
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Workout stopwatch can run well past an hour — unlike the rest timer, it needs an hour segment or a long session reads as e.g. "127:30" instead of "2:07:30". */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Built-in gym workout timer (user feedback: "I want the gym logging to be
 * focused around you working out at the same time as you logging"). Two
 * independent clocks in one widget: a workout stopwatch (start it when you
 * walk in, hand its elapsed time to the duration field when you're done —
 * one tap instead of estimating hours/minutes/seconds after the fact), and
 * a rest timer between sets (the actual "timing sets" ask) with one-tap
 * presets and an audible+vibration alert so you don't have to keep checking
 * the screen mid-set.
 *
 * Both clocks are anchored to real wall-clock timestamps (epoch ms), not
 * incrementing counters — a plain `setInterval(() => setElapsed(e => e+1))`
 * silently drifts (or on iOS, stops advancing entirely) the moment the
 * WebView is backgrounded or the screen locks, which is exactly what made
 * both the in-app clock and the lock-screen Live Activity freeze (user
 * feedback: "gets stuck when I leave my phone locked... or when I click off
 * the app"). Re-deriving elapsed/remaining from `Date.now()` on every
 * render/tick means the displayed numbers are always correct the instant
 * the app is looked at again, and the native Live Activity ticks
 * independently on the OS side using the same reference timestamps (see
 * live-activity.ts / SplitIndexWidgetsLiveActivity.swift) — no more
 * per-second pushes required at all, only on real state changes.
 */
export function GymWorkoutTimer({
  onUseDuration,
}: {
  onUseDuration: (totalSeconds: number) => void;
}) {
  // Lazy useState initializers run exactly once (on first mount), so
  // calling loadPersistedState() separately in each is fine — no need to
  // cache it in a ref first.
  const [running, setRunning] = useState(() => loadPersistedState()?.running ?? false);
  /** Frozen total (ms) accumulated across all PAST running segments — the source of truth while paused. */
  const [pausedElapsedMs, setPausedElapsedMs] = useState(() => loadPersistedState()?.pausedElapsedMs ?? 0);
  /** Adjusted epoch ms for the CURRENT running segment (`now - pausedElapsedMs` at the moment of start/resume) — meaningless while paused. Plain state, not a ref: its value is read during render (to derive the displayed clock), and React refs aren't meant to be read outside effects/handlers. */
  const [effectiveStartMs, setEffectiveStartMs] = useState<number | null>(
    () => loadPersistedState()?.effectiveStartMs ?? null
  );
  /** Absolute epoch ms the rest countdown ends at; null when no rest is active. */
  const [restEndMs, setRestEndMs] = useState<number | null>(() => loadPersistedState()?.restEndMs ?? null);
  const [customRestInput, setCustomRestInput] = useState("");
  const liveActivityStartedRef = useRef(loadPersistedState()?.hasLiveActivity ?? false);
  const alertFiredRef = useRef(false);
  /** Bumped once a second purely to force a re-render while something is ticking — the actual numbers are always recomputed fresh from Date.now(), never accumulated from this. */
  const [, setTick] = useState(0);

  const now = Date.now(); // eslint-disable-line react-hooks/purity -- intentional: re-deriving from the wall clock every render is the fix for the drift/freeze bug this file's doc comment describes, not a bug itself
  const elapsedMs = running && effectiveStartMs != null ? now - effectiveStartMs : pausedElapsedMs;
  const elapsed = Math.floor(elapsedMs / 1000);
  const restRemaining = restEndMs !== null ? Math.ceil((restEndMs - now) / 1000) : null;
  const restActive = restEndMs !== null;
  const restDone = restActive && restRemaining !== null && restRemaining <= 0;
  const hasProgress = elapsed > 0 || restActive;

  function persistState(overrides: Partial<PersistedTimerState> = {}) {
    if (typeof window === "undefined") return;
    const state: PersistedTimerState = {
      running,
      pausedElapsedMs,
      effectiveStartMs,
      restEndMs,
      hasLiveActivity: liveActivityStartedRef.current,
      ...overrides,
    };
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Best-effort — losing persistence just means the next mount starts fresh.
    }
  }

  // Note: this component deliberately does NOT end the Live Activity on
  // unmount — doing so on every unmount (including a plain tab switch
  // within the app, which unmounts this component) was ending the Live
  // Activity before the user was actually finished with their workout.
  // Ending now happens explicitly: on Reset (resetStopwatch below) and on
  // a successful save (activity-form.tsx calls endLiveActivity() itself
  // once the workout is actually submitted) — see that file's submit
  // handler. This is also why the resync effect below always re-adopts
  // whatever's running on the native side instead of trusting only this
  // instance's own start history.

  // Forces a re-render every second while either clock is live — neither
  // clock's actual value comes from this tick (both are recomputed from
  // Date.now() above), so a throttled/delayed tick just means a stale
  // repaint until the next one fires, never a wrong number.
  useEffect(() => {
    if (!running && !restActive) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running, restActive]);

  // Fires the rest-over alert exactly once per rest, and reconciles the
  // Live Activity's `restDone` hint (native re-derives "done" from the date
  // itself too, but this keeps the JS-driven hint in step for consistency).
  useEffect(() => {
    if (!restDone) {
      alertFiredRef.current = false;
      return;
    }
    if (alertFiredRef.current) return;
    alertFiredRef.current = true;
    playRestOverAlert();
    if (liveActivityStartedRef.current) {
      updateLiveActivity({
        startDateEpochMs: effectiveStartMs ?? now,
        isPaused: !running,
        pausedElapsedSeconds: Math.round(pausedElapsedMs / 1000),
        restEndDateEpochMs: restEndMs ?? undefined,
        restDone: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only re-fires on the restDone transition itself
  }, [restDone]);

  // Reconciles local state with whatever the lock screen last did —
  // Pause/Resume and Add Rest/Skip Rest are interactive Live Activity
  // buttons (see GymTimerIntents.swift) that mutate the Activity directly
  // from the widget extension's process, with no way to call back into
  // this already-running app. Runs on mount AND whenever the app becomes
  // visible again — user feedback: "the buttons like pause and skip rest
  // don't work" turned out to be this resync never running at all after a
  // fresh remount, because it used to be gated behind "did THIS component
  // instance start the Live Activity," which is always false on a fresh
  // mount even when a real one is still running from before. It now always
  // asks the native side (see live-activity.ts's own fix) and ADOPTS
  // whatever it finds, rather than only trusting its own start history.
  useEffect(() => {
    if (!isLiveActivitySupported()) return;
    async function resync() {
      const snapshot = await getLiveActivityState();
      if (!snapshot.found) {
        liveActivityStartedRef.current = false;
        return;
      }
      liveActivityStartedRef.current = true;
      if (snapshot.isPaused) {
        setPausedElapsedMs(snapshot.pausedElapsedSeconds * 1000);
        setEffectiveStartMs(null);
        setRunning(false);
      } else {
        setEffectiveStartMs(snapshot.startDateEpochMs);
        setRunning(true);
      }
      setRestEndMs(snapshot.restEndDateEpochMs ?? null);
    }
    void resync();
    function onVisible() {
      if (document.visibilityState === "visible") void resync();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resync);
    };
  }, []);

  // Persists on every real state change (not the once-a-second tick) so a
  // tab switch mid-run/mid-rest restores exactly where it was left.
  useEffect(() => {
    persistState();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistState closes over the latest values itself; only these four should trigger a write
  }, [running, pausedElapsedMs, effectiveStartMs, restEndMs]);

  function toggleRunning() {
    const t = Date.now();
    if (running) {
      const frozenMs = effectiveStartMs != null ? t - effectiveStartMs : pausedElapsedMs;
      setPausedElapsedMs(frozenMs);
      setEffectiveStartMs(null);
      setRunning(false);
      if (liveActivityStartedRef.current) {
        updateLiveActivity({
          startDateEpochMs: t,
          isPaused: true,
          pausedElapsedSeconds: Math.round(frozenMs / 1000),
          restEndDateEpochMs: restEndMs ?? undefined,
          restDone,
        });
      }
      return;
    }
    const effectiveStart = t - pausedElapsedMs;
    setEffectiveStartMs(effectiveStart);
    setRunning(true);
    if (!liveActivityStartedRef.current && isLiveActivitySupported()) {
      liveActivityStartedRef.current = true;
      startLiveActivity("gymTimer", "Gym Workout", {
        startDateEpochMs: effectiveStart,
        isPaused: false,
        pausedElapsedSeconds: 0,
        restEndDateEpochMs: restEndMs ?? undefined,
      });
    } else if (liveActivityStartedRef.current) {
      updateLiveActivity({
        startDateEpochMs: effectiveStart,
        isPaused: false,
        restEndDateEpochMs: restEndMs ?? undefined,
        restDone,
      });
    }
  }

  // User feedback: "make it harder to reset timer, requires it to ask
  // confirmation to cancel." Only prompts when there's actually something
  // to lose — resetting an untouched 0:00 timer needs no confirmation.
  function resetStopwatch() {
    if (hasProgress && !window.confirm("Reset your workout timer? This clears your elapsed time and any active rest countdown.")) {
      return;
    }
    setRunning(false);
    setPausedElapsedMs(0);
    setEffectiveStartMs(null);
    setRestEndMs(null);
    liveActivityStartedRef.current = false;
    clearPersistedGymTimerState();
    endLiveActivity();
  }

  function startRest(seconds: number) {
    alertFiredRef.current = false;
    const t = Date.now(); // eslint-disable-line react-hooks/purity -- event handler, not render; anchors the rest countdown's end instant
    const endMs = t + seconds * 1000;
    setRestEndMs(endMs);
    if (liveActivityStartedRef.current) {
      updateLiveActivity({
        startDateEpochMs: effectiveStartMs ?? t,
        isPaused: !running,
        pausedElapsedSeconds: Math.round(pausedElapsedMs / 1000),
        restEndDateEpochMs: endMs,
        restDone: false,
      });
    }
  }

  function startCustomRest() {
    const seconds = Math.round(Number(customRestInput));
    if (!Number.isFinite(seconds) || seconds < MIN_CUSTOM_REST_SECONDS || seconds > MAX_CUSTOM_REST_SECONDS) {
      return;
    }
    startRest(seconds);
    setCustomRestInput("");
  }

  function dismissRest() {
    setRestEndMs(null);
    if (liveActivityStartedRef.current) {
      const t = Date.now();
      updateLiveActivity({
        startDateEpochMs: effectiveStartMs ?? t,
        isPaused: !running,
        pausedElapsedSeconds: Math.round(pausedElapsedMs / 1000),
        restEndDateEpochMs: undefined,
        restDone: false,
      });
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gym-border/40 bg-gym-bg/70 p-3.5 shadow-lg backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleRunning}
            aria-label={running ? "Pause workout timer" : "Start workout timer"}
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all",
              running
                ? "bg-warning/20 text-warning shadow-[0_0_0_3px_rgba(234,179,8,0.15)]"
                : "bg-gym-accent/20 text-gym-accent shadow-[0_0_0_3px_rgba(0,230,95,0.12)]"
            )}
          >
            {running ? (
              <Pause className="h-5.5 w-5.5" />
            ) : (
              <Play className="h-5.5 w-5.5" fill="currentColor" />
            )}
          </button>
          <div>
            <p className="micro-label text-gym-muted">Workout time</p>
            <p className="index-display text-3xl font-bold tabular-nums leading-tight text-gym-text">
              {formatElapsed(elapsed)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {elapsed > 0 && (
            <button
              type="button"
              onClick={() => onUseDuration(elapsed)}
              className="rounded-full border border-gym-accent/30 px-3.5 py-2 text-xs font-semibold text-gym-accent transition-colors hover:bg-gym-accent/10"
            >
              Use as duration
            </button>
          )}
          <button
            type="button"
            onClick={resetStopwatch}
            aria-label="Reset workout timer"
            className="flex h-10 w-10 items-center justify-center rounded-full text-gym-muted transition-colors hover:bg-white/5 hover:text-gym-text"
          >
            <RotateCcw className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-gym-border/20 pt-3">
        {restActive ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TimerIcon className={cn("h-4.5 w-4.5", restDone ? "text-danger" : "text-gym-accent")} />
              <p
                className={cn(
                  "index-display text-2xl font-bold tabular-nums",
                  restDone ? "text-danger" : "text-gym-text"
                )}
              >
                {restDone ? "Rest over!" : formatMMSS(restRemaining ?? 0)}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissRest}
              className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-medium text-gym-muted transition-colors hover:text-gym-text"
            >
              Dismiss
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="micro-label mr-1 text-gym-muted">Rest:</p>
            {REST_PRESETS_SECONDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => startRest(s)}
                className="rounded-full border border-gym-border/50 bg-white/[0.02] px-3.5 py-1.5 text-xs font-semibold text-gym-text/90 transition-colors hover:border-gym-accent/40 hover:text-gym-accent"
              >
                {s}s
              </button>
            ))}
            {/* User feedback: "allow for custom time of rest on timer in the lab" */}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_CUSTOM_REST_SECONDS}
                max={MAX_CUSTOM_REST_SECONDS}
                placeholder="Custom (s)"
                value={customRestInput}
                onChange={(e) => setCustomRestInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startCustomRest()}
                className="h-8 w-24 rounded-full border border-gym-border/50 bg-white/[0.02] px-3 text-xs text-gym-text placeholder:text-gym-muted/60 focus:border-gym-accent/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={startCustomRest}
                disabled={!customRestInput}
                className="rounded-full border border-gym-accent/30 px-3 py-1.5 text-xs font-semibold text-gym-accent transition-colors hover:bg-gym-accent/10 disabled:opacity-40"
              >
                Go
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
