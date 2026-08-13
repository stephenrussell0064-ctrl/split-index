"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

interface ModeOverrideEntry {
  id: string;
  mode: ModeOverride;
}

const ModeOverrideContext = createContext<{
  override: ModeOverride;
  register: (id: string, mode: ModeOverride) => void;
  unregister: (id: string) => void;
} | null>(null);

/**
 * Overrides are held as a registration list keyed by an id per calling
 * component, NOT as one shared value, and the most recently registered
 * entry wins.
 *
 * Why: two pages are mounted at once during a route transition. The shell's
 * AnimatePresence crossfade keeps the outgoing page mounted for the length
 * of its exit animation (~200ms) after the incoming page has already
 * mounted and run its effects (and React's Activity-based route
 * preservation, if enabled, likewise runs a hidden route's effect cleanups
 * after the new route is live). With a single shared value, the outgoing
 * page's cleanup ran *last* and blew away the override the incoming page
 * had just set — so opening the edit form for a cardio activity from the
 * activity detail page (itself a mode-override page) correctly went light
 * and then snapped back to the dark "neutral" default a frame later.
 * That's the user-reported "editing a run renders in the dark Lab UI".
 *
 * Scoping each registration to its own id means an unmounting page only
 * ever removes its own entry, leaving whatever the newer page registered
 * intact — and a route that Activity later re-shows re-registers, moving
 * itself back to the end of the list where it belongs.
 */
export function ModeOverrideProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ModeOverrideEntry[]>([]);

  const register = useCallback((id: string, mode: ModeOverride) => {
    setEntries((prev) => {
      const existing = prev.find((entry) => entry.id === id);
      if (existing) {
        if (existing.mode === mode) return prev;
        // Updated in place: a sport switch inside an already-registered
        // form shouldn't jump the queue ahead of a newer page.
        return prev.map((entry) => (entry.id === id ? { id, mode } : entry));
      }
      return [...prev, { id, mode }];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setEntries((prev) =>
      prev.some((entry) => entry.id === id) ? prev.filter((entry) => entry.id !== id) : prev
    );
  }, []);

  const override = entries.length > 0 ? entries[entries.length - 1].mode : null;

  const value = useMemo(
    () => ({ override, register, unregister }),
    [override, register, unregister]
  );

  return <ModeOverrideContext.Provider value={value}>{children}</ModeOverrideContext.Provider>;
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
 * currently-selected sport instead. Automatically deregisters on unmount
 * so leaving the page doesn't leave a stale override behind for whatever's
 * rendered next.
 *
 * Passing `null` is a real registration too ("this page explicitly wants no
 * mode"), not an absence of one — so the neutral sport picker takes the
 * shell back to neutral immediately rather than inheriting the theme of the
 * page still crossfading out behind it.
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
  const { register, unregister } = useModeOverrideContext();
  // useId, not a module counter: stable for the life of this component
  // instance (including across an Activity hide/show cycle) and unique
  // between the two pages that are briefly mounted together mid-transition.
  const id = useId();

  useLayoutEffect(() => {
    register(id, mode);
  }, [id, mode, register]);

  // Deregistration is its own effect so a mode change (switching sport
  // inside the form) updates the existing entry rather than briefly
  // removing it — only genuinely leaving the page drops the registration.
  useLayoutEffect(() => {
    return () => unregister(id);
  }, [id, unregister]);
}
