/**
 * Whether the tab-bar tour is showing — a tiny store the app shell subscribes
 * to, and that onboarding (and the Help page) can switch on from anywhere.
 *
 * A store rather than a query param or a localStorage flag, because the shell
 * stays mounted across the navigation from /onboarding to /dashboard. The
 * flow calls `startTour()` and pushes the route; the overlay is already on
 * screen when the dashboard arrives. A `?tour=1` param would need
 * useSearchParams in the shell, which forces every page out of static
 * prerendering (see the comment in app-shell.tsx).
 *
 * `useSyncExternalStore`, not setState-in-effect: the server snapshot is
 * always "not showing", so there is no hydration mismatch and no lint rule
 * tripped.
 */

const DONE_KEY = "split-index-tour-done";

let active = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isTourActive(): boolean {
  return active;
}

export function tourServerSnapshot(): boolean {
  return false;
}

export function startTour(): void {
  if (active) return;
  active = true;
  emit();
}

export function endTour(): void {
  if (!active) return;
  active = false;
  try {
    localStorage.setItem(DONE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the tour is simply offered again next time */
  }
  emit();
}

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Test seam: reset module state between cases. */
export function _resetTourForTests(): void {
  active = false;
  listeners.clear();
}
