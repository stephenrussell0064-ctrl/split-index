"use client";

/**
 * A one-line broadcast that this athlete's entitlement has changed.
 *
 * WHY. `AppTopBar` reads the profile once, in a `useEffect` with an empty
 * dependency array, and renders either the Premium badge or an "Upgrade" link
 * from it. That effect never runs again for the life of the mounted component.
 * `router.refresh()` after a purchase re-renders server components, which the
 * top bar is not one of — so an athlete who had just paid kept looking at a
 * button inviting them to upgrade, on the screen congratulating them for
 * upgrading. Nothing was broken server-side; the header simply had no reason
 * to look again.
 *
 * A plain DOM event rather than a context or a store: the producer (the
 * checkout flow) and the consumer (the header) sit in different trees with no
 * common provider between them, and adding one to carry a single boolean that
 * changes at most a few times per account would be the larger change.
 */

const EVENT = "splitindex:entitlement-changed";

/** Call once the server is known to agree that the athlete is premium. */
export function notifyEntitlementChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Returns an unsubscribe function, for use as an effect cleanup. */
export function subscribeToEntitlementChanges(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
