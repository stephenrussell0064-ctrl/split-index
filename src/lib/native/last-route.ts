import { Preferences } from "@capacitor/preferences";

/**
 * Remembers which screen the athlete was on, so a backgrounded app that iOS
 * has since reclaimed comes back where they left it.
 *
 * WHY THIS HAS TO EXIST. The native shell loads the real app over the network
 * (capacitor.config.ts server.url) rather than bundling it, and that URL is a
 * fixed entry point: "https://www.splitindex.co.uk/login". Nothing about that
 * is per-session. So whenever iOS destroys the app process behind a
 * backgrounded app — routine after a few minutes, and entirely at the system's
 * discretion — the next tap on the icon is a COLD LAUNCH, and Capacitor loads
 * server.url again: /login, which redirects a signed-in athlete to /dashboard.
 * Mid-session on the gym screen, background it, come back, and you are on the
 * dashboard. That is the athlete's report, verbatim: "the app refreshes rather
 * than going back to where I swiped off of it."
 *
 * Reproduced on the iOS Simulator against the live app, not reasoned about:
 * navigated to /privacy, killed the app process, relaunched — landed on /login.
 *
 * WHAT THIS DOES NOT FIX, deliberately. There is a second, separate teardown:
 * iOS killing just the WKWebView's content process while the app itself lives.
 * Capacitor handles that one by reloading the CURRENT url
 * (WebViewDelegationHandler.webViewWebContentProcessDidTerminate), so the route
 * already survives it — verified the same way, by killing the WebContent
 * process directly and watching the app come back on /privacy at the same
 * scroll offset. Neither teardown can be prevented from inside the app; both
 * destroy all JavaScript state either way. This module only restores WHERE the
 * athlete was, not what was on the screen. In-progress logging is covered
 * separately by the draft autosave, and a running GPS session by its own
 * Preferences persistence, both of which exist for exactly this reason.
 */

const KEY = "split-index:last-route";

/**
 * Old enough and "carry on where you left off" becomes "why am I on yesterday's
 * screen?" — a fresh open next morning should start at the dashboard. Short
 * enough to be clearly about resuming, long enough to cover a real gym session
 * with the phone in a pocket between sets.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface StoredRoute {
  path: string;
  at: number;
}

/**
 * The signed-in app's own routes — the only places worth returning someone to.
 * Marketing and legal pages are reachable from the login screen and are not
 * somewhere an athlete is "working", so landing back on /privacy would be
 * stranger than landing on the dashboard.
 *
 * /admin is excluded on purpose: it is not part of the athlete's session, and
 * silently reopening an admin screen is not a behaviour to add by accident.
 */
const RESTORABLE_PREFIXES = [
  "/dashboard",
  "/activities",
  "/gym",
  "/cardio",
  "/analytics",
  "/reports",
  "/social",
  "/profile",
  "/settings",
  "/hybrid-plan",
  "/interference",
  "/onboarding",
];

/**
 * Landing HERE on a fresh document means the athlete is signed out or midway
 * through signing in, and any route stored from a previous session is stale by
 * definition. Restoring into it would either bounce off the server's own auth
 * redirect or fight /auth/callback, which deliberately routes a brand-new user
 * to onboarding rather than wherever they last were.
 */
function isAuthPath(path: string): boolean {
  return path === "/login" || path.startsWith("/auth/") || path.startsWith("/login/");
}

/** Whether a path is one we would ever hand back to the athlete. */
export function isRestorablePath(path: string): boolean {
  if (isAuthPath(path)) return false;
  return RESTORABLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** Record where the athlete is now. Silent on failure — this is a convenience. */
export async function rememberRoute(path: string): Promise<void> {
  try {
    if (!isRestorablePath(path)) return;
    const entry: StoredRoute = { path, at: Date.now() };
    await Preferences.set({ key: KEY, value: JSON.stringify(entry) });
  } catch {
    // A route we failed to remember costs the athlete one dashboard landing.
    // Never worth surfacing, and never worth breaking navigation over.
  }
}

export async function forgetRoute(): Promise<void> {
  try {
    await Preferences.remove({ key: KEY });
  } catch {
    // As above.
  }
}

/**
 * Decide where a freshly loaded document should actually be, given where it
 * landed. Returns null whenever the answer is "stay put" — which is the common
 * case and must stay cheap and quiet.
 *
 * Clearing on an auth landing is what keeps this from interfering with sign-in.
 * A signed-out cold launch lands on /login, wipes the stored route, and so by
 * the time an OAuth round-trip or an email sign-in finishes there is nothing
 * left to restore and the server's own post-auth routing wins uncontested.
 */
export async function resolveRestoreTarget(landedOn: string): Promise<string | null> {
  try {
    if (isAuthPath(landedOn)) {
      await forgetRoute();
      return null;
    }

    const { value } = await Preferences.get({ key: KEY });
    if (!value) return null;

    const entry = JSON.parse(value) as Partial<StoredRoute>;
    if (typeof entry?.path !== "string" || typeof entry?.at !== "number") return null;
    if (Date.now() - entry.at > MAX_AGE_MS) return null;
    if (!isRestorablePath(entry.path)) return null;

    // Already there. This is the WKWebView content-process reload: Capacitor
    // reloads the current url, so the route came back on its own and there is
    // nothing to do.
    if (entry.path === landedOn) return null;

    return entry.path;
  } catch {
    return null;
  }
}
