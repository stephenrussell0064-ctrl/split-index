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
      // A fixed launchShowDuration hides the splash on a timer regardless of
      // whether the remote page (server.url, over the network) has actually
      // loaded yet — that gap showed as a blank black screen after the logo
      // disappeared. autoHide: false keeps the native splash up until
      // LaunchOverlay (src/components/providers/launch-overlay.tsx) calls
      // SplashScreen.hide() itself, once there's an animated JS screen ready
      // to take over — no gap, no fixed guess at how long loading will take.
      launchAutoHide: false,
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
