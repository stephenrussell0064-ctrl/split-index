"use client";

import { useEffect } from "react";
import { isNativePlatform } from "@/lib/native/platform";

/**
 * Keeps the native status bar legible when the app shell switches themes.
 *
 * The Engine (`data-mode="cardio"`) is the one light surface in an otherwise
 * dark app — `--cardio-bg` is #f7fbff. capacitor.config.ts sets the status bar
 * once, statically, to `style: "DARK"`, which in Capacitor's vocabulary means
 * "light text, for a dark background". Correct everywhere except The Engine,
 * where white glyphs land on near-white and the clock, Wi-Fi and battery all
 * but disappear. The app draws under the status bar (`contentInset: "never"`),
 * so there is no bar of its own colour to save it.
 *
 * Style.Light is the inverse — dark text, for a light background — so cardio
 * gets Light and everything else keeps Dark.
 *
 * The plugin is imported dynamically rather than at module scope: this
 * component mounts inside the shell on web too, where @capacitor/status-bar
 * has a web fallback that would otherwise be pulled into the browser bundle
 * for a call that never happens.
 */
export function StatusBarModeSync({ mode }: { mode: string }) {
  useEffect(() => {
    if (!isNativePlatform()) return;

    let cancelled = false;
    void (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        if (cancelled) return;
        await StatusBar.setStyle({
          style: mode === "cardio" ? Style.Light : Style.Dark,
        });
      } catch {
        // A status bar that failed to restyle is a cosmetic problem; it must
        // never take the shell down with it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  return null;
}
