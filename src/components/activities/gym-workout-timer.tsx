"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const REST_PRESETS_SECONDS = [60, 90, 120, 180];

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

/**
 * Built-in gym workout timer (user feedback: "I want the gym logging to be
 * focused around you working out at the same time as you logging"). Two
 * independent clocks in one widget: a workout stopwatch (start it when you
 * walk in, hand its elapsed time to the duration field when you're done —
 * one tap instead of estimating hours/minutes/seconds after the fact), and
 * a rest timer between sets (the actual "timing sets" ask) with one-tap
 * presets and an audible+vibration alert so you don't have to keep checking
 * the screen mid-set.
 */
export function GymWorkoutTimer({
  onUseDuration,
}: {
  onUseDuration: (totalSeconds: number) => void;
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  function resetStopwatch() {
    setRunning(false);
    setElapsed(0);
  }

  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const alertFiredRef = useRef(false);

  useEffect(() => {
    if (restRemaining === null) return;
    if (restRemaining <= 0) {
      if (!alertFiredRef.current) {
        alertFiredRef.current = true;
        playRestOverAlert();
      }
      return;
    }
    const t = setTimeout(() => setRestRemaining((r) => (r !== null ? r - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [restRemaining]);

  function startRest(seconds: number) {
    alertFiredRef.current = false;
    setRestRemaining(seconds);
  }

  const restActive = restRemaining !== null;
  const restDone = restActive && restRemaining <= 0;

  return (
    <div className="mb-5 space-y-3 rounded-2xl border border-gym-border/30 bg-gym-bg/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            aria-label={running ? "Pause workout timer" : "Start workout timer"}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
              running ? "bg-warning/20 text-warning" : "bg-gym-accent/20 text-gym-accent"
            )}
          >
            {running ? (
              <Pause className="h-4.5 w-4.5" />
            ) : (
              <Play className="h-4.5 w-4.5" fill="currentColor" />
            )}
          </button>
          <div>
            <p className="micro-label text-gym-muted">Workout time</p>
            <p className="index-display text-2xl font-bold tabular-nums text-gym-text">
              {formatMMSS(elapsed)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {elapsed > 0 && (
            <button
              type="button"
              onClick={() => onUseDuration(elapsed)}
              className="rounded-full border border-gym-accent/30 px-3 py-1.5 text-xs font-medium text-gym-accent transition-colors hover:bg-gym-accent/10"
            >
              Use as duration
            </button>
          )}
          <button
            type="button"
            onClick={resetStopwatch}
            aria-label="Reset workout timer"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gym-muted transition-colors hover:bg-white/5 hover:text-gym-text"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-t border-gym-border/20 pt-3">
        {restActive ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TimerIcon className={cn("h-4 w-4", restDone ? "text-danger" : "text-gym-accent")} />
              <p
                className={cn(
                  "index-display text-xl font-bold tabular-nums",
                  restDone ? "text-danger" : "text-gym-text"
                )}
              >
                {restDone ? "Rest over!" : formatMMSS(restRemaining)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRestRemaining(null)}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-gym-muted transition-colors hover:text-gym-text"
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
                className="rounded-full border border-gym-border/40 px-3 py-1.5 text-xs font-medium text-gym-text/90 transition-colors hover:border-gym-accent/40 hover:text-gym-accent"
              >
                {s}s
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
