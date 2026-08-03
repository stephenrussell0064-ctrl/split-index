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
    url: "https://splitindex.co.uk",
    cleartext: false,
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
      launchShowDuration: 400,
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
