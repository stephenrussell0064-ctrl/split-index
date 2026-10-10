"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";
import { runHealthSync, shouldAutoSync } from "@/lib/health/sync-client";

/**
 * Sync Apple Health when the app opens and when it comes back to the front.
 *
 * Renders nothing. The app is a WebView, so there is no JavaScript running
 * while it is in the background — foreground is the only moment an import
 * can happen, and this is that moment. Throttled to once a quarter hour and
 * skipped entirely on devices that have never connected (a per-device hint;
 * the server is still the truth and a stale hint costs one request).
 *
 * A failure is swallowed. The athlete did not ask for this sync; the card on
 * the Recovery page is where errors are shown to someone who did.
 */
export function HealthAutoSync() {
  const native = useIsNativeShell();
  const router = useRouter();

  useEffect(() => {
    if (!native) return;
    let running = false;

    const attempt = () => {
      if (running || !shouldAutoSync()) return;
      running = true;
      runHealthSync()
        .then((result) => {
          const changed =
            result.workouts.imported + result.hrvDays + result.restingHrDays + result.sleepNights + result.bodyMass > 0;
          if (changed) router.refresh();
        })
        .catch(() => {
          /* not connected, or no signal: the card reports, this does not */
        })
        .finally(() => {
          running = false;
        });
    };

    attempt();
    const onVisible = () => {
      if (document.visibilityState === "visible") attempt();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [native, router]);

  return null;
}
