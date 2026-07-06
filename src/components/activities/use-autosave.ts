"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SportType } from "@/types";
import { isStateDirty, type WorkoutFormState } from "./form-state";

export type DraftStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 900;
const SAVED_VISIBLE_MS = 2200;

/**
 * Debounced draft autosave. Persists the raw (string-based) form state to
 * PUT /api/activities/draft, keyed per user+sport server-side.
 */
export function useDraftAutosave(
  sport: SportType | null,
  state: WorkoutFormState | null,
  enabled: boolean
) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const skipNextRef = useRef(true);
  const pendingRef = useRef<(() => void) | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Let the "Draft saved" indicator fade back out on its own.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setStatus((s) => (s === "saved" ? "idle" : s));
      }, SAVED_VISIBLE_MS);
    } catch {
      setStatus("error");
    }
  }, []);

  // When the sport changes, don't autosave the freshly hydrated state —
  // only user edits after that point.
  useEffect(() => {
    skipNextRef.current = true;
  }, [sport]);

  useEffect(() => {
    if (!enabled || !sport || !state) return;
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

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  /** Immediately run any pending save (used when switching sports / leaving). */
  const flush = useCallback(() => {
    pendingRef.current?.();
  }, []);

  return { status, flush };
}
