"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNativePlatform } from "@/lib/native/platform";
import { rememberRoute, resolveRestoreTarget } from "@/lib/native/last-route";

/**
 * Keeps the native app's idea of "where I was" alive across the app process
 * being destroyed and rebuilt, which iOS does routinely to a backgrounded app.
 * See src/lib/native/last-route.ts for why that is unavoidable and what it
 * costs the athlete.
 *
 * Only the PATH is restored, never the query string. A screen is where the
 * athlete was; a query string is as likely to carry a one-shot token or an
 * error code that has no business being replayed minutes later.
 */

/**
 * Once per document, not once per mount. A fresh JavaScript context is exactly
 * what a cold launch produces, so module scope is the honest place to record
 * "this document has already had its one chance to be redirected" — and it is
 * also what stops the restore from firing on an in-app navigation to /login,
 * i.e. signing out, which happens inside the same context.
 *
 * The DECISION is memoised rather than a bare "already ran" boolean, because
 * StrictMode mounts every effect twice in development. A boolean set on the
 * first pass would make the second pass believe the restore had already
 * happened and skip it — turning the whole feature off in dev, which is
 * precisely where it would be tested.
 */
let restoreDecision: Promise<string | null> | null = null;

/** Set once the replace has actually been issued, so a remount can't re-issue it. */
let navigationStarted = false;

/**
 * The route a restore is currently navigating to, if any. Held here rather
 * than in state because the effect that settles it is a different effect from
 * the one that sets it, and neither should re-run because of the other.
 */
let pendingTarget: string | null = null;

let settle: () => void = () => {};
const settled = new Promise<void>((resolve) => {
  settle = resolve;
});

/**
 * Resolves once the restore decision has been made and any resulting
 * navigation has landed. LaunchOverlay holds the splash until this settles so
 * a restored session never flashes the dashboard on its way somewhere else.
 *
 * Always resolves: the caller passes a cap, and a document where this provider
 * never mounts at all must not be able to hang the splash on screen forever.
 */
export function whenRouteRestoreSettled(timeoutMs: number): Promise<void> {
  return Promise.race([
    settled,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function RouteRestore() {
  const pathname = usePathname();
  const router = useRouter();

  // The restore decision. Deliberately not keyed on `pathname`: it runs once,
  // against wherever this document first landed, and never again.
  useEffect(() => {
    if (!isNativePlatform()) {
      settle();
      return;
    }

    // Resolved against wherever this document FIRST landed, once, and reused
    // by any remount. resolveRestoreTarget also clears the stored route on an
    // auth landing, which must likewise happen only once.
    restoreDecision ??= resolveRestoreTarget(window.location.pathname);

    let cancelled = false;
    void restoreDecision.then((target) => {
      if (cancelled) return;
      if (!target) {
        // "Stay put" — the common case, and there is nothing to wait for.
        settle();
        return;
      }
      // A remount arriving after the replace was issued must not issue it
      // again, and must not settle either: the navigation is still in flight
      // and the effect below owns settling it.
      if (navigationStarted) return;
      navigationStarted = true;
      // Stays unsettled until the navigation actually lands, below, so the
      // splash covers the dashboard the athlete is only passing through.
      pendingTarget = target;
      router.replace(target);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Record where we are now, on every route change including the restored one.
  useEffect(() => {
    if (!isNativePlatform() || !pathname) return;
    if (pendingTarget && pathname === pendingTarget) {
      pendingTarget = null;
      settle();
    }
    void rememberRoute(pathname);
  }, [pathname]);

  return null;
}
