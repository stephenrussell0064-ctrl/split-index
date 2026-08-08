"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

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
 * forms, and — as a fallback for entry points without a `?zone=` query
 * param, see app-shell.tsx — activity detail) to theme the shell off the
 * currently-selected sport instead. Automatically clears itself on unmount
 * so leaving the page doesn't leave a stale override behind for whatever's
 * rendered next.
 *
 * useLayoutEffect, not useEffect: this only ever fires post-hydration
 * anyway (an SSR'd page still paints once with no override applied, since
 * the server can't run this hook), but useLayoutEffect flushes the mode
 * change to the DOM before the browser paints that hydrated frame, instead
 * of after — closing a second, easily-missed flash where the page stayed
 * on the wrong theme for an extra tick post-hydration before starting its
 * transition. Real but narrower gap than the query-param fix in
 * app-shell.tsx actually closes; kept as a fallback, not the primary fix.
 */
export function useSetModeOverride(mode: ModeOverride): void {
  const { setOverride } = useModeOverrideContext();
  useLayoutEffect(() => {
    setOverride(mode);
    return () => setOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}
