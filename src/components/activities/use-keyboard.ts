"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * How much of the screen the on-screen keyboard is currently covering, in CSS
 * pixels. 0 when it is closed (or when there is no visualViewport to ask).
 *
 * User complaint: "loses my place... keyboard covering fields." This is the
 * mechanism behind it, and it is specifically a WebView problem:
 *
 * On Android the keyboard resizes the LAYOUT viewport, so a `position: sticky;
 * bottom: 0` bar rides up with it on its own and everything is fine. On iOS
 * (WKWebView, which is what Capacitor runs) the keyboard does NOT resize the
 * layout viewport — only the VISUAL viewport shrinks. Layout is unchanged, so
 * the sticky submit bar stays pinned to a bottom edge that is now underneath
 * the keyboard, and any field in the lower half of the form is typed into
 * blind.
 *
 * `window.visualViewport` is the only thing that reports this. The value is
 * the gap between the bottom of the layout viewport and the bottom of the
 * visible one; on Android it comes out at ~0 precisely because the layout
 * viewport already shrank, so the same code is correct on both without a
 * platform check.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const read = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      // Small non-zero values are just browser chrome (URL bar) rounding, not
      // a keyboard — treating those as "keyboard open" would jitter the submit
      // bar on every scroll.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  return inset;
}

/**
 * Keep whatever is being typed into inside the part of the screen the keyboard
 * hasn't eaten.
 *
 * The browser's own "scroll the focused input into view" only guarantees the
 * field is inside the LAYOUT viewport, which on iOS is exactly the thing the
 * keyboard doesn't shrink — so it does nothing about a field the keyboard is
 * sitting on top of. This listens for focus anywhere inside the form and, once
 * the keyboard has finished animating, scrolls the field to the middle of the
 * space that is actually still visible. Only when it needs to: a field already
 * in clear view is left alone, because an unrequested scroll is its own kind
 * of losing your place.
 *
 * `focusin` (not `focus`) because focus doesn't bubble, and one listener on the
 * form beats one per input across a forty-row workout.
 */
export function useKeyboardSafeFocus(
  containerRef: RefObject<HTMLElement | null>,
  /** Room to leave below the field — the sticky submit bar sits there. */
  bottomGuard = 96
) {
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;

      if (timer) clearTimeout(timer);
      // The keyboard animates in over roughly a quarter of a second; measuring
      // before it lands reads the pre-keyboard viewport and scrolls nowhere.
      timer = setTimeout(() => {
        const vv = window.visualViewport;
        const visibleTop = vv ? vv.offsetTop : 0;
        const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const rect = target.getBoundingClientRect();
        const covered = rect.bottom > visibleBottom - bottomGuard;
        const above = rect.top < visibleTop + 8;
        if (!covered && !above) return;
        target.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }, 280);
    };

    node.addEventListener("focusin", onFocusIn);
    return () => {
      node.removeEventListener("focusin", onFocusIn);
      if (timer) clearTimeout(timer);
    };
  }, [containerRef, bottomGuard]);
}
