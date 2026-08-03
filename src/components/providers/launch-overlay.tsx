"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNativePlatform } from "@/lib/native/platform";
import { BrandMark } from "@/components/brand/brand-mark";

const MIN_VISIBLE_MS = 700;

/**
 * Bridges the gap between the native static splash (hidden the instant this
 * mounts — capacitor.config.ts sets SplashScreen.launchAutoHide: false so it
 * doesn't hide itself on a fixed timer regardless of load state) and the
 * real app content, which on server.url mode is still being fetched over
 * the network at this point. Without something here, that gap reads as a
 * blank black screen; a branded animated screen instead makes the wait feel
 * intentional rather than broken.
 */
export function LaunchOverlay() {
  const [visible, setVisible] = useState(() => isNativePlatform());
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isNativePlatform()) return;

    const start = Date.now();
    SplashScreen.hide().catch(() => {});

    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - start));
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed inset-0 z-[999] flex items-center justify-center bg-background"
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
