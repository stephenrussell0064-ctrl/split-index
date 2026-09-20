import type { useRouter } from "next/navigation";

/**
 * The home of the training zone a pathname sits inside, or null for pages
 * outside both zones. Exact zone roots (/gym, /cardio) are not "inside" a
 * zone — they are the zone, and have no back button to begin with.
 */
export function zoneHomeFor(pathname: string): "/gym" | "/cardio" | null {
  if (pathname.startsWith("/gym/")) return "/gym";
  if (pathname.startsWith("/cardio/")) return "/cardio";
  return null;
}

/**
 * Shared "go back" logic for both the top-bar BackButton and the edge-swipe
 * gesture (app-shell.tsx).
 *
 * Pages under The Lab (/gym/...) and The Engine (/cardio/...) go back to
 * their zone's home, always, rather than to whatever the browser history
 * happens to hold. User report: from the GPS tracking screen, Back did not
 * return to The Engine. The history entry behind a page can be anything —
 * the WebView reloaded underneath the app, a deep link, a page that replaced
 * itself — and `router.back()` on the wrong entry goes somewhere surprising
 * or nowhere at all. "Back to the Engine" names a destination, so it is
 * navigated to as one.
 *
 * Everywhere else, a direct link/deep-link into a sub-page (shared URL,
 * browser refresh) has no in-app history to go back to, so `router.back()`
 * alone would just leave the app/close the tab. `window.history.length > 1`
 * means this tab has somewhere real to return to; otherwise fall back to the
 * dashboard.
 */
export function navigateBack(router: ReturnType<typeof useRouter>, pathname: string): void {
  const zoneHome = zoneHomeFor(pathname);
  if (zoneHome) {
    router.push(zoneHome);
    return;
  }
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
  } else {
    router.push("/dashboard");
  }
}
