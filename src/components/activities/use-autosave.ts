"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SportType } from "@/types";
import { isStateDirty, type WorkoutFormState } from "./form-state";

export type DraftStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 900;

/**
 * Debounced draft autosave. Persists the raw (string-based) form state to
 * PUT /api/activities/draft, keyed per user+sport server-side.
 *
 * User complaint: "unclear whether it saved." The indicator used to announce
 * "Draft saved" for 2.2 seconds and then erase itself back to nothing — so for
 * all but two seconds in every minute of logging, the screen said nothing
 * about whether the work was safe, which reads exactly like not being saved at
 * all. `lastSavedAt` is exposed so the UI can keep telling the truth
 * continuously ("Saved · 40s ago") instead of flashing it once, and `retry`
 * gives a failed save a way back that isn't "type another character and hope".
 */
export function useDraftAutosave(
  sport: SportType | null,
  state: WorkoutFormState | null,
  enabled: boolean
) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const skipNextRef = useRef(true);
  const pendingRef = useRef<(() => void) | null>(null);
  // What we would save right now — kept in a ref so `retry` can fire without
  // being rebuilt (and re-subscribed to) on every keystroke.
  const latestRef = useRef<{ sport: SportType; state: WorkoutFormState } | null>(null);

  const persist = useCallback(async (saveSport: SportType, saveState: WorkoutFormState) => {
    setStatus("saving");
    try {
      const res = await fetch("/api/activities/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport: saveSport, formData: saveState }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("saved");
      setLastSavedAt(Date.now());
    } catch {
      setStatus("error");
    }
  }, []);

  // When the sport changes, don't autosave the freshly hydrated state —
  // only user edits after that point. Declared BEFORE the autosave effect
  // below so it has already run by the time that one fires for the new sport.
  useEffect(() => {
    skipNextRef.current = true;
  }, [sport]);

  // Nor keep claiming the PREVIOUS sport's draft is saved while looking at
  // this one's blank form. Adjusted during render on a prop change rather than
  // in an effect: this project lints setState-in-effect (see app-shell.tsx for
  // the same pattern), and there's no external system to synchronize with.
  const [trackedSport, setTrackedSport] = useState(sport);
  if (sport !== trackedSport) {
    setTrackedSport(sport);
    setStatus("idle");
    setLastSavedAt(null);
  }

  useEffect(() => {
    if (!enabled || !sport || !state) return;
    latestRef.current = { sport, state };
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    if (!isStateDirty(state)) return;

    const run = () => {
      pendingRef.current = null;
      void persist(sport, state);
    };
    pendingRef.current = run;
    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      pendingRef.current = null;
    };
  }, [sport, state, enabled, persist]);

  /** Immediately run any pending save (used when switching sports / leaving). */
  const flush = useCallback(() => {
    pendingRef.current?.();
  }, []);

  /** Re-attempt after a failure, from whatever is on screen now. */
  const retry = useCallback(() => {
    const latest = latestRef.current;
    if (!latest) return;
    void persist(latest.sport, latest.state);
  }, [persist]);

  return { status, lastSavedAt, flush, retry };
}
