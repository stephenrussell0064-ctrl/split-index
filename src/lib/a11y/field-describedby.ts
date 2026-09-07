/**
 * N7 item 3 — tie a field's error and hint to the field itself.
 *
 * WHAT `role="alert"` DOES AND DOES NOT DO
 * ---------------------------------------
 * The error text already carries `role="alert"`, so it is announced at the
 * moment it appears. That is a live region, and a live region only fires on
 * change. It does nothing for the two cases that matter just as much:
 *
 *   - the user tabs BACK to the field afterwards, and
 *   - the user arrives at a form that is already showing errors — a failed
 *     submit re-render, or a server-rendered validation pass.
 *
 * In both, the input announces its label and its value and says nothing about
 * why it is rejected. WCAG 3.3.1 asks for the error to be identified, and being
 * identified somewhere else on the page is not the same as being identified.
 * `aria-describedby` is what makes the association permanent.
 *
 * WHY `aria-describedby` AND NOT `aria-errormessage`
 * -------------------------------------------------
 * `aria-errormessage` (ARIA 1.2) is the semantically precise answer and is the
 * one that reads better on paper. Support is materially worse — several screen
 * reader and browser pairings ignore it entirely, and a user of one of those
 * gets nothing at all, which is the state we are trying to leave.
 * `aria-describedby` plus `aria-invalid` is the combination that is actually
 * announced everywhere, so that is what ships. Revisit when support catches up;
 * the change would be one line in each of the three components.
 *
 * This is a separate module rather than a helper inside input.tsx so it can be
 * tested for real. This project has no React testing library, so anything left
 * inside a component could only be checked by scanning the source for the
 * attribute — which proves the attribute is written, not that it points at
 * anything. The merging and the emptiness handling below are where the actual
 * bugs live, and they are ordinary functions.
 */

/**
 * The `aria-describedby` value for a form control: the caller's own value, then
 * the hint, then the error — in the order a screen reader should read them.
 *
 * Returns `undefined` rather than `""` when there is nothing to point at.
 * An empty `aria-describedby` is not harmless: it is a reference to an element
 * with no id, and some screen readers announce the failure.
 *
 * `caller` is preserved because a field may already be described by something
 * the component knows nothing about — a shared unit note, a character counter.
 * Overwriting it would fix this finding by causing a quieter version of it.
 */
export function fieldDescribedBy(options: {
  caller?: string;
  hintId?: string;
  errorId?: string;
  hasHint?: boolean;
  hasError?: boolean;
}): string | undefined {
  const { caller, hintId, errorId, hasHint, hasError } = options;

  const ids = [
    caller?.trim() || null,
    // The hint is hidden while an error is showing — the components swap one
    // for the other — so pointing at it would reference a removed node.
    hasHint && !hasError ? hintId : null,
    hasError ? errorId : null,
  ].filter((id): id is string => Boolean(id));

  return ids.length > 0 ? ids.join(" ") : undefined;
}

/**
 * `aria-invalid` for a control. `undefined` rather than `false` when valid:
 * `aria-invalid="false"` is legal and is also a claim, and a field the user has
 * not reached yet has not been judged.
 */
export function fieldInvalid(hasError: boolean): true | undefined {
  return hasError ? true : undefined;
}
