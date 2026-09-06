"use client";

import { MotionConfig } from "framer-motion";

/**
 * Honour iOS "Reduce Motion" across every animation in the app.
 *
 * `globals.css` already collapses CSS animations and transitions to 0.01ms
 * under `prefers-reduced-motion: reduce`, which reads as complete coverage and
 * is not: Framer Motion does not animate through CSS. It writes `transform`
 * to the element on every frame from its own JS loop, so a blanket
 * `transition-duration: 0.01ms !important` cannot touch it. 71 files in this
 * app animate that way. 45 of them call `useReducedMotion()` themselves and
 * behave; the other 26 — the whole social tab, the analytics panels, the
 * onboarding score reveal, the log launcher, the app shell itself — slid,
 * scaled and sprang regardless of the setting.
 *
 * That is a real accessibility failure and, for a user with vestibular
 * sensitivity, a physical one: Settings › Accessibility › Motion › Reduce
 * Motion is the switch they use to make apps safe, and this app quietly
 * ignored it. Apple's Human Interface Guidelines require respecting it, and
 * App Review does check.
 *
 * ONE PROVIDER RATHER THAN 26 EDITS. `reducedMotion="user"` puts the
 * preference into Framer Motion's own context, so every `motion.*` element
 * beneath it — including ones added later, which is the point — drops
 * transform and layout animation when the setting is on. Opacity and colour
 * still animate: Reduce Motion is about movement, not about the screen
 * becoming static, and keeping the fade means content that starts at
 * `opacity: 0` still arrives instead of stranding.
 *
 * The 45 components that handle it themselves keep working unchanged; this
 * sits underneath them, it does not override them.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
