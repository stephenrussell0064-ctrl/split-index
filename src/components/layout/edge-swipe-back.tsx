"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useReducedMotion } from "framer-motion";
import { navigateBack } from "@/lib/utils/navigate-back";

/** Matches iOS's own edge-swipe hit zone (roughly 20px), not the whole screen — a swipe starting anywhere else is a normal scroll/interaction, not a back gesture. */
const EDGE_ZONE_PX = 24;
const SWIPE_THRESHOLD_PX = 80;
/** px/ms — a fast flick counts even if it didn't travel the full threshold distance. */
const VELOCITY_THRESHOLD = 0.4;

/**
 * iOS-style edge-swipe-to-go-back, layered onto the same back-navigable
 * pages as the top-bar BackButton (see app-shell.tsx's `showBackButton` /
 * TOP_LEVEL_ROUTES) — never on /gym or /cardio, which already use a
 * whole-page horizontal swipe to switch between the two
 * (train-zone-swipe.tsx).
 *
 * Deliberately plain pointer events rather than framer-motion's `drag` prop:
 * `drag` has no built-in edge-origin detection, and conditionally toggling
 * it on/off based on where a touch started is a known-fragile pattern (the
 * capability needs to already be listening before the gesture begins).
 * Tracking coordinates manually — and only ever reading them, never calling
 * preventDefault — means this can't fight normal vertical scrolling either.
 */
export function EdgeSwipeBack({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const stateRef = useRef<{ startX: number; startTime: number } | null>(null);

  const active = enabled && !reducedMotion;

  function handlePointerDown(e: React.PointerEvent) {
    if (!active || e.pointerType === "mouse") return;
    if (e.clientX > EDGE_ZONE_PX) return;
    stateRef.current = { startX: e.clientX, startTime: performance.now() };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const state = stateRef.current;
    if (!state) return;
    const delta = Math.max(0, e.clientX - state.startX);
    x.set(delta * 0.5);
  }

  function endGesture(e: React.PointerEvent) {
    const state = stateRef.current;
    stateRef.current = null;
    x.set(0);
    if (!state) return;
    const delta = e.clientX - state.startX;
    const elapsed = Math.max(1, performance.now() - state.startTime);
    const velocity = delta / elapsed;
    if (delta > SWIPE_THRESHOLD_PX || velocity > VELOCITY_THRESHOLD) {
      navigateBack(router);
    }
  }

  if (!active) return <>{children}</>;

  return (
    <motion.div
      style={{ x }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={() => {
        stateRef.current = null;
        x.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}
