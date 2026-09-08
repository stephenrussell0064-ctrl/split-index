/**
 * The skip link's target.
 *
 * WHY THIS IS A SHARED CONSTANT AND NOT A STRING WRITTEN TWICE
 * -----------------------------------------------------------
 * It was a string written twice, and the two halves were in different places:
 * `href="#main-content"` in the root layout, `id="main-content"` in app-shell.
 * The layout renders on EVERY page. The app shell renders only on the
 * authenticated ones.
 *
 * So on the landing page, /login, /signup, /privacy, /terms, /accessibility and
 * /how-scoring-works — every page a visitor sees before they have an account —
 * the first thing in the tab order was a link to an element that did not exist.
 * It focused nothing and scrolled nowhere, and nothing about it looked broken,
 * because a fragment link to a missing id is not an error in HTML.
 *
 * Confirmed against production, not inferred: `document.getElementById(
 * "main-content")` returned null on /, /login, /accessibility and /privacy. The
 * accessibility statement is one of the pages where it was broken, on the same
 * page as the sentence claiming it works.
 *
 * The constant does not stop a page from forgetting a `<main>` — that is what
 * skip-link.test.ts is for — but it does stop the link and the target from
 * drifting apart, which is the failure that has already happened once.
 */
export const MAIN_CONTENT_ID = "main-content";

/** `href` for the skip link. */
export const SKIP_LINK_HREF = `#${MAIN_CONTENT_ID}`;

/**
 * Spread onto a page's `<main>`.
 *
 * `tabIndex={-1}` is the part that is easy to leave off and is the reason the
 * link does anything at all: a `<main>` is not focusable by default, so without
 * it, browsers move the scroll position but leave focus at the top of the
 * document — the next Tab goes back to the skip link and the athlete is in a
 * loop.
 */
export const mainContentProps = { id: MAIN_CONTENT_ID, tabIndex: -1 } as const;
