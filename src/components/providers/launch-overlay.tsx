"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNativePlatform } from "@/lib/native/platform";
import { BrandMark } from "@/components/brand/brand-mark";
import { whenRouteRestoreSettled } from "@/components/providers/route-restore";

const MIN_VISIBLE_MS = 700;

/**
 * Upper bound on how long the splash will wait for RouteRestore. It exists so
 * a slow network, or a document where RouteRestore never mounts at all, can
 * only ever cost the launch a beat — never leave the splash stuck on screen.
 * The native splash's own dead-man's-switch (capacitor.config.ts
 * launchShowDuration) sits well beyond this.
 */
const MAX_RESTORE_WAIT_MS = 2500;

/**
 * Bridges the gap between the native static splash (hidden the instant this
 * mounts — capacitor.config.ts hands over to this explicit hide() on any
 * normal load, its launchAutoHide timer being only a fallback for when the
 * app's JS never loads at all) and the real app content, which on server.url
 * mode is still being fetched over the network at this point. Without
 * something here, that gap reads as a blank black screen; a branded animated
 * screen instead makes the wait feel intentional rather than broken.
 *
 * It also covers the route restore. A cold launch always lands on server.url
 * (/login, redirected to /dashboard for a signed-in athlete) and RouteRestore
 * then sends them back where they actually were — so the splash holds until
 * that has landed, and the dashboard they are merely passing through is never
 * on screen. See src/lib/native/last-route.ts.
 */
export function LaunchOverlay() {
  const [visible, setVisible] = useState(() => isNativePlatform());
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isNativePlatform()) return;

    const start = Date.now();
    SplashScreen.hide().catch(() => {});

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void whenRouteRestoreSettled(MAX_RESTORE_WAIT_MS).then(() => {
      if (cancelled) return;
      // The minimum is measured from the start, not from here, so waiting for
      // the restore doesn't add to it — a launch with nothing to restore is
      // exactly as long as it was before.
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - start));
      timer = setTimeout(() => setVisible(false), remaining);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          // #1B241D, not bg-background, to match the NATIVE splash this hands
          // over from. The two run back to back — native splash, then this —
          // and bg-background (#060606) against the splash ground read as a
          // visible colour jump mid-launch. The fade-out then carries it down
          // to the app's own background, where a change is invisible because
          // the overlay is already dissolving.
          className="fixed inset-0 z-[999] flex items-center justify-center bg-[#1B241D]"
        >
          <div className="relative flex items-center justify-center">
            {!reducedMotion && (
              <motion.div
                aria-hidden
                className="absolute h-36 w-36 rounded-full bg-accent/25 blur-2xl"
                animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0.7, 0.35] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <motion.div
              initial={reducedMotion ? false : { scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <BrandMark variant="full" logoHeight={44} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
