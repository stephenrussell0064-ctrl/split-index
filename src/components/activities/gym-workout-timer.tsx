"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Play, Pause, RotateCcw, Timer as TimerIcon, X } from "lucide-react";
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
  /**
   * The custom-rest field is opened on demand and takes the presets' place on
   * the same line, rather than sitting there permanently as a third row.
   *
   * User feedback: "I want the timer banner at the top ... to be much smaller
   * as currently [it takes] up way too much of the screen and this disrupts
   * the dynamic when logging activities." A labelled input and a Go button,
   * always on screen, was the single biggest piece of that banner and the one
   * used least often. It is still one tap away and still on screen — the "+"
   * pill sits at the end of the preset row — not buried in a menu.
   */
  const [customRestOpen, setCustomRestOpen] = useState(false);
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
    setCustomRestOpen(false);
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

  /**
   * Two fixed rows, ~88px, down from 181px — 22% of a 375×812 phone, measured.
   *
   * User feedback: "I want the timer banner at the top ... to be much smaller
   * as currently [it takes] up way too much of the screen and this disrupts
   * the dynamic when logging activities."
   *
   * What went, and where it went instead — nothing is behind a menu:
   *  · The 14×14 play button and the 3xl clock are now a 9×9 button and an xl
   *    clock on ONE line with the reset control, instead of a 56px-tall block
   *    of their own.
   *  · The rest presets keep their own line but it is a single non-wrapping
   *    scroll strip, so it costs a constant 32px whatever is in it.
   *  · The custom-rest input and its Go button now open on demand from the
   *    "Custom" pill at the end of that strip, in the strip's own place.
   *  · "Use as duration" takes over the slot holding the word "Workout" the
   *    moment there is time to hand over, so it costs no height at all and the
   *    timer does not change size when the clock passes 0:00.
   *
   * The second row swaps between presets and the live rest countdown; both are
   * h-8, so a rest starting or ending never moves the exercise list under it.
   */
  return (
    <div className="rounded-2xl border border-gym-border/40 bg-gym-bg/80 px-2.5 py-2 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleRunning}
          aria-label={running ? "Pause workout timer" : "Start workout timer"}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
            running
              ? "bg-warning/20 text-warning shadow-[0_0_0_2px_rgba(234,179,8,0.15)]"
              : "bg-gym-accent/20 text-gym-accent shadow-[0_0_0_2px_rgba(0,230,95,0.12)]"
          )}
        >
          {running ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" fill="currentColor" />
          )}
        </button>
        <p className="index-display text-xl font-bold leading-none tabular-nums text-gym-text">
          {formatElapsed(elapsed)}
        </p>
        {/* One slot, two occupants, same row height either way: the word that
            says what the clock is, until there is time on it worth handing to
            the duration field.

            "Use as duration" was tried in the rest strip below — it fits, but
            that strip scrolls horizontally, and behind five rest pills the
            button was off the right-hand edge and effectively gone. It belongs
            next to the number it is offering. */}
        {elapsed > 0 ? (
          <button
            type="button"
            onClick={() => onUseDuration(elapsed)}
            title="Fill this workout's total duration from the timer"
            className="flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-gym-accent/30 px-2 text-[11px] font-semibold text-gym-accent transition-colors hover:bg-gym-accent/10"
          >
            <ArrowDownToLine className="h-3 w-3" aria-hidden />
            Use as duration
          </button>
        ) : (
          <span className="micro-label text-gym-muted/70">Workout</span>
        )}
        {/*
          User feedback: "The reset button at the top of the lab to reset the
          exercises selected should be clearer as to what it is resetting and
          more clear to the user to click."

          It resets the TIMER — not the exercises — and it said so nowhere: a
          bare circular arrow, sat next to the clock, which is exactly what an
          athlete reads as "reset something about this workout". It now carries
          the word "Timer" beside the icon, so the only unlabelled reset on the
          screen is gone. The control that really does clear the exercises is
          in the page header and now says "Clear workout" (see
          activity-form.tsx), so the two can no longer be confused for each
          other.
        */}
        <button
          type="button"
          onClick={resetStopwatch}
          aria-label="Reset the workout timer — this does not clear your exercises"
          title="Reset the workout timer. Your logged exercises are not affected."
          className="ml-auto flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-gym-border/50 px-2.5 text-[11px] font-semibold text-gym-muted transition-colors hover:bg-white/5 hover:text-gym-text"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset timer
        </button>
      </div>

      <div className="mt-1.5 flex h-8 items-center gap-1.5 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {restActive ? (
          <>
            <TimerIcon
              className={cn("h-4 w-4 shrink-0", restDone ? "text-danger" : "text-gym-accent")}
              aria-hidden
            />
            <p
              className={cn(
                "index-display shrink-0 text-base font-bold tabular-nums",
                restDone ? "text-danger" : "text-gym-text"
              )}
            >
              {restDone ? "Rest over!" : formatMMSS(restRemaining ?? 0)}
            </p>
            <button
              type="button"
              onClick={dismissRest}
              className="ml-auto shrink-0 rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-gym-muted transition-colors hover:text-gym-text"
            >
              Dismiss
            </button>
          </>
        ) : customRestOpen ? (
          <>
            {/* User feedback: "allow for custom time of rest on timer in the lab" */}
            <input
              type="number"
              inputMode="numeric"
              autoFocus
              aria-label="Custom rest in seconds"
              min={MIN_CUSTOM_REST_SECONDS}
              max={MAX_CUSTOM_REST_SECONDS}
              placeholder="Seconds"
              value={customRestInput}
              onChange={(e) => setCustomRestInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startCustomRest()}
              className="h-7 w-24 shrink-0 rounded-full border border-gym-border/50 bg-white/[0.02] px-3 text-xs text-gym-text placeholder:text-gym-muted/60 focus:border-gym-accent/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={startCustomRest}
              disabled={!customRestInput}
              className="shrink-0 rounded-full border border-gym-accent/30 px-3 py-1 text-[11px] font-semibold text-gym-accent transition-colors hover:bg-gym-accent/10 disabled:opacity-40"
            >
              Start rest
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomRestOpen(false);
                setCustomRestInput("");
              }}
              aria-label="Back to the rest presets"
              className="shrink-0 rounded-full p-1.5 text-gym-muted transition-colors hover:text-gym-text"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <>
            <span className="micro-label shrink-0 text-gym-muted/70">Rest</span>
            {REST_PRESETS_SECONDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => startRest(s)}
                className="shrink-0 rounded-full border border-gym-border/50 bg-white/[0.02] px-2.5 py-1 text-[11px] font-semibold text-gym-text/90 transition-colors hover:border-gym-accent/40 hover:text-gym-accent"
              >
                {s}s
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomRestOpen(true)}
              aria-label="Custom rest time"
              title="Custom rest time"
              className="shrink-0 rounded-full border border-gym-border/50 bg-white/[0.02] px-2.5 py-1 text-[11px] font-semibold text-gym-text/90 transition-colors hover:border-gym-accent/40 hover:text-gym-accent"
            >
              Custom
            </button>
          </>
        )}
      </div>
    </div>
  );
}
