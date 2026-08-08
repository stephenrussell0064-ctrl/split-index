import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor-conversion brief, Part 1: the native shell loads the real,
// already-deployed Next.js app over the network (server.url) rather than
// bundling a `next export` static build. This app has dozens of server-side
// API routes, Supabase-backed SSR pages, auth callbacks, and Stripe
// webhooks — none of that survives a static export, and none of it needs
// to: pointing the WebView at the live production domain preserves 100% of
// existing server-side behavior unchanged, which is the whole point of
// "wrap it, don't rewrite it" for an app this size.
const config: CapacitorConfig = {
  appId: "co.uk.splitindex.app",
  appName: "Split Index",
  webDir: "public",
  server: {
    // The apex domain 308-redirects to www at the edge (Vercel) — pointing
    // straight at the canonical host avoids that redirect firing as the very
    // first thing the WebView does. allowNavigation covers both hosts anyway
    // so any other same-site redirect (Stripe/Supabase/OAuth callbacks built
    // from NEXT_PUBLIC_APP_URL, which is still the apex) is followed inside
    // the app rather than kicked out to Safari — Capacitor's default behavior
    // for any navigation to a host it doesn't recognize.
    //
    // /login rather than the bare marketing homepage — someone opening the
    // native app has already downloaded it, so there's nothing left to sell
    // them; /login itself redirects straight to /dashboard if they're
    // already signed in, so this only actually shows for a signed-out user.
    url: "https://www.splitindex.co.uk/login",
    cleartext: false,
    allowNavigation: ["splitindex.co.uk", "www.splitindex.co.uk", "*.splitindex.co.uk"],
    // User-reported: at a race with no signal, the app couldn't open at
    // all — the WebView had nothing to fall back to when server.url
    // failed to load. errorPath points it at a locally-bundled static
    // page (public/offline.html, ships inside the app package since
    // webDir is "public") instead of a blank/frozen screen. It has no
    // Capacitor plugin access (Capacitor's own documented constraint for
    // this specific config on Android), so it can't launch GPS tracking
    // itself — its only job is "don't look broken" plus a retry button.
    // Native background GPS tracking (lib/native/gps-tracking.ts) and the
    // offline submit queue (lib/activities/offline-queue.ts) already don't
    // depend on the WebView being reachable, so a session already started
    // before losing signal is unaffected either way.
    errorPath: "offline.html",
  },
  ios: {
    // Lets the web content draw under the status bar/notch; the app itself
    // handles safe-area insets via CSS (env(safe-area-inset-*)) so content
    // still sits correctly rather than looking like a bare wrapped website.
    contentInset: "never",
  },
  android: {
    // Required by @capacitor-community/background-geolocation — without
    // this, Android silently stops delivering location updates after ~5
    // minutes in the background (github.com/capacitor-community/background-geolocation/issues/89),
    // which would make a real lock-screen GPS test fail for a config
    // reason rather than a real bug.
    useLegacyBridge: true,
  },
  plugins: {
    SplashScreen: {
      // Verified live in the iOS Simulator while building the errorPath
      // fallback below: launchAutoHide: false (no timer at all) means the
      // native splash only ever hides when LaunchOverlay
      // (src/components/providers/launch-overlay.tsx) calls
      // SplashScreen.hide() — which only runs once the real app's JS has
      // loaded. When server.url can't be reached at all (no signal), that
      // JS never loads, so the splash sat forever on top of the errorPath
      // page below, hiding it completely — the exact "app looks frozen"
      // symptom this was supposed to fix, just moved one layer down.
      // launchAutoHide: true + a generous launchShowDuration restores a
      // dead-man's-switch: LaunchOverlay's explicit hide() still wins
      // immediately on any normal load (well under 8s), so the online
      // experience is unchanged; offline.html only becomes visible once
      // the timer fires if nothing ever called hide() first.
      launchAutoHide: true,
      launchShowDuration: 8000,
      backgroundColor: "#0a0a0f",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0a0a0f",
    },
  },
};

export default config;
