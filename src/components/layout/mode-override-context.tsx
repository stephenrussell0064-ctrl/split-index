"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * The gym ("The Lab", dark theme) vs cardio ("The Engine", light theme)
 * shell theming in app-shell.tsx is normally derived purely from the URL
 * pathname (/gym vs /cardio). That breaks on the generic log/edit activity
 * pages (/activities/new, /activities/[id]/edit) — one page hosts both gym
 * and cardio sport selection, so the pathname never encodes which one is
 * active, and the shell was stuck on the dark "neutral" default even after
 * picking a cardio sport (user-reported bug). This context lets a page
 * whose pathname can't encode a mode register an override based on
 * whatever's actually selected client-side; AppShell falls back to it only
 * when the pathname itself doesn't already imply a mode.
 */
type ModeOverride = "gym" | "cardio" | null;

const ModeOverrideContext = createContext<{
  override: ModeOverride;
  setOverride: (mode: ModeOverride) => void;
} | null>(null);

export function ModeOverrideProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<ModeOverride>(null);
  return (
    <ModeOverrideContext.Provider value={{ override, setOverride }}>
      {children}
    </ModeOverrideContext.Provider>
  );
}

function useModeOverrideContext() {
  const ctx = useContext(ModeOverrideContext);
  if (!ctx) {
    throw new Error("useModeOverrideContext must be used within a ModeOverrideProvider (AppShell)");
  }
  return ctx;
}

/** Read by AppShell — the current override, if any. */
export function useModeOverride(): ModeOverride {
  return useModeOverrideContext().override;
}

/**
 * Called by a page whose pathname doesn't encode a mode (generic log/edit
 * forms) to theme the shell off the currently-selected sport instead.
 * Automatically clears itself on unmount so leaving the page doesn't leave
 * a stale override behind for whatever's rendered next.
 */
export function useSetModeOverride(mode: ModeOverride): void {
  const { setOverride } = useModeOverrideContext();
  useEffect(() => {
    setOverride(mode);
    return () => setOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}
