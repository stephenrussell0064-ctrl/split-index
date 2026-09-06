"use client";

import { useEffect, useRef } from "react";

/**
 * The keyboard and screen-reader half of a modal.
 *
 * The app had four of them — compare, delete, merge, and the report/block sheet
 * — and between them: one `role="dialog"`, no focus trap, no focus restore, and
 * `grep '"Escape"' src/` returned zero matches in the entire codebase. So a
 * modal opened on a keyboard could be tabbed straight out of into the page
 * behind it, was announced as a plain group of controls, and could only be
 * closed by finding and clicking its X.
 *
 * Everything here is behaviour that has no visual signature, which is exactly
 * why it was missing: nothing about the rendered result looked wrong.
 *
 * Attach the returned ref to the dialog's own container, and spread the
 * returned props onto it:
 *
 *   const { dialogRef, dialogProps } = useDialog(onClose);
 *   <div ref={dialogRef} {...dialogProps}>…</div>
 */
export function useDialog(onClose: () => void, options: { label?: string } = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Kept in a ref so the effect below never re-runs (and never re-steals focus)
  // just because the parent re-rendered with a new closure. Synced in its own
  // effect rather than during render — writing a ref while rendering is what
  // this project's lint rule forbids, and it is forbidden for a reason: it
  // makes the component impure and misbehaves under concurrent rendering.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Where focus was before the dialog opened, so it can be handed back. A
    // dialog that closes and drops focus to the top of the document makes a
    // keyboard user re-navigate the whole page to get back to where they were.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Move focus INTO the dialog. Without this the first Tab goes to whatever
    // followed the trigger in the page behind.
    const first = focusable()[0];
    (first ?? container).focus?.();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // The trap. Tab off the last control wraps to the first, Shift+Tab off
      // the first wraps to the last, so focus cannot leave the dialog while it
      // is open — which is the whole difference between a dialog and a div.
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === firstItem || active === container)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only if focus is still somewhere in the dialog — if the close action
      // deliberately moved it (a delete that navigates away), leave it alone.
      if (!previouslyFocused) return;
      if (container.contains(document.activeElement)) previouslyFocused.focus?.();
    };
  }, []);

  /*
    Destructured names rather than `{ ref, props }`: the React Compiler lint
    rule reads `dialog.ref` in JSX as a ref access during render and rejects it,
    even though passing a RefObject to `ref=` is exactly what one is for.
    Returning distinctly-named values keeps the rule satisfied without pretending
    it is wrong about anything else.
  */
  return {
    dialogRef: ref,
    dialogProps: {
      role: "dialog" as const,
      "aria-modal": true,
      "aria-label": options.label,
      tabIndex: -1,
    },
  };
}
