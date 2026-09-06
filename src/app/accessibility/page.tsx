import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibility · Split Index",
  description:
    "How accessible Split Index currently is, what does not yet meet the standard, and how to tell us about a problem.",
};

/**
 * WP12.8 — the accessibility statement.
 *
 * "A statement that overclaims is worse than none — 'partially conformant,
 * these areas are not yet' is the correct wording if that is the truth."
 *
 * It is the truth. An automated pass and a contrast audit have been done; a
 * full keyboard-only and screen-reader walkthrough of every journey has not.
 * The Known issues section below says so specifically enough to be checkable,
 * because a vague statement is a way of claiming credit without earning it.
 *
 * Update the review date whenever this is re-audited, not whenever the page is
 * edited.
 */

const LAST_REVIEWED = "6 September 2026";

export default function AccessibilityPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Accessibility statement</h1>
      <p className="mt-3 text-sm text-muted">Last reviewed: {LAST_REVIEWED}</p>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">What we are aiming for</h2>
        <p>
          Split Index aims to meet{" "}
          <a
            className="text-accent underline underline-offset-4"
            href="https://www.w3.org/TR/WCAG22/"
            target="_blank"
            rel="noreferrer noopener"
          >
            WCAG 2.2 level AA
          </a>
          . We are not there yet. This page says where we are, honestly, and is
          updated when we re-audit rather than when we change the wording.
        </p>
      </section>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">Current status</h2>
        <p>
          <strong>Partially conformant with WCAG 2.2 AA.</strong> Parts of the
          app meet the standard and parts do not; the specific gaps are listed
          below.
        </p>
      </section>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">What we have fixed</h2>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Colour contrast.</strong> Every brand colour pairing is now
            measured against the 4.5:1 text and 3:1 non-text thresholds, and the
            measurement runs as an automated test so the palette cannot drift
            back. The blue used on our light &ldquo;Engine&rdquo; screens
            measured 2.50:1 — below both thresholds — and now has a tuned
            variant at 5.26:1 for text and 3.52:1 for icons and borders. The
            label on primary buttons in that mode measured 2.60:1 against its
            own button and is now 5.47:1.
          </li>
          <li>
            <strong>Locked premium panels.</strong> These used to render the real
            numbers behind a blur, which meant a screen reader read them out.
            They now render nothing — a shaped placeholder and the reason it is
            locked.
          </li>
          <li>
            <strong>Skip link.</strong> A &ldquo;Skip to main content&rdquo; link
            is the first thing you reach with the keyboard on every page, so you
            do not have to tab through the whole navigation.
          </li>
          <li>
            <strong>Reduced motion.</strong> Animations, page transitions and the
            loading screens respect your system&rsquo;s{" "}
            <code className="rounded bg-white/[0.06] px-1">prefers-reduced-motion</code>{" "}
            setting.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">Known issues</h2>
        <p>
          These do not currently meet WCAG 2.2 AA. We have listed them
          specifically rather than generally so you can tell whether one affects
          you.
        </p>
        <ul className="ml-5 list-disc space-y-2">
          <li>
            <strong>Charts do not yet have a text equivalent.</strong> Our graphs
            each have a plain-English explanation, but the underlying figures are
            not exposed as a table to assistive technology. If you use a screen
            reader, the trend charts on the analytics page will not be readable.
            (WCAG 1.1.1.)
          </li>
          <li>
            <strong>Some states are still signalled by colour alone.</strong>{" "}
            Parts of the interface distinguish the strength and endurance sides
            of the app, and some status indicators, using colour without a
            matching label or icon. (WCAG 1.4.1.)
          </li>
          <li>
            <strong>
              A full keyboard-only and screen-reader walkthrough has not been
              completed.
            </strong>{" "}
            We have audited colour contrast thoroughly and run automated checks,
            but automated tooling finds roughly a third of real problems. Until
            a manual pass over onboarding, logging a session, the dashboard, the
            leaderboard, the analytics page and checkout is done, we cannot claim
            those journeys are fully operable without a mouse.
          </li>
          <li>
            <strong>Form errors are not always tied to their field.</strong> Some
            validation messages are shown near a field without being
            programmatically associated with it, so a screen reader may not
            announce them when you reach the input. (WCAG 3.3.1.)
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">Telling us about a problem</h2>
        <p>
          If something here stops you doing what you came to do, we want to know
          — including if it is not on the list above.
        </p>
        <p>
          Email{" "}
          <a className="text-accent underline underline-offset-4" href="mailto:accessibility@splitindex.co.uk">
            accessibility@splitindex.co.uk
          </a>
          . We aim to reply within <strong>5 working days</strong>. Please say
          what you were trying to do, what happened, and what you were using —
          browser, phone, and any assistive technology.
        </p>
        <p className="text-sm text-muted">
          If you are not happy with our response, the Equality Advisory and
          Support Service (EASS) can advise on your rights under the Equality Act
          2010.
        </p>
      </section>

      <section className="mt-10 space-y-4 leading-relaxed">
        <h2 className="text-xl font-semibold">How this was assessed</h2>
        <p>
          Self-assessed. Colour contrast was measured programmatically against
          every brand pairing the product renders, and those measurements run as
          part of our automated test suite on every change. The remaining checks
          were a code review against WCAG 2.2 AA. No external audit has been
          carried out.
        </p>
      </section>

      <p className="mt-12 text-sm">
        <Link className="text-accent underline underline-offset-4" href="/">
          Back to Split Index
        </Link>
      </p>
    </main>
  );
}
