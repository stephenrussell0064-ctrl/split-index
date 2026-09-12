import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { LegalBackLink } from "@/components/legal/legal-back-link";
import { LegalHomeLink } from "@/components/legal/legal-home-link";
import { mainContentProps } from "@/lib/a11y/main-content";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of Split Index fitness analytics.",
};

const EFFECTIVE_DATE = "July 2026";
const CONTACT_EMAIL = "support@splitindex.co.uk";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-dvh bg-[#050508] text-foreground">
      {/*
        The inset pad sits on the <header> rather than the inner row so the
        glass still fills the area behind the status bar; padding the row would
        leave a transparent strip above the blur.

        Without it the row renders UNDER the iOS status bar — the root layout
        sets viewportFit: "cover" so the web view draws edge-to-edge, and every
        surface inside AppShell compensates with this same pad. These two pages
        sit outside the (app) route group, so nothing was compensating, and the
        back control was not merely awkward to hit: it was physically beneath
        the status bar and could not be tapped at all.
      */}
      <header className="border-b border-white/[0.06] glass-strong pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandMark variant="compact" href="/" iconSize={30} wordmarkSize="sm" />
          <LegalBackLink />
        </div>
      </header>

      <main {...mainContentProps} className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
        {/* p-8 inside px-6 leaves 278px of text on a 390pt phone. */}
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-5 break-words sm:p-8 md:p-10">
          <header className="mb-10 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
            <p className="mt-2 text-sm text-muted">Effective date: {EFFECTIVE_DATE}</p>
          </header>

          <div className="prose-invert space-y-8 text-sm leading-relaxed text-muted">
            <section>
              <h2 className="text-lg font-semibold text-foreground">1. Agreement</h2>
              <p className="mt-3">
                By creating an account or using Split Index (&quot;the Service&quot;), you agree
                to these Terms. If you do not agree, do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">2. The Service</h2>
              <p className="mt-3">
                Split Index provides fitness analytics, workout logging, and estimated
                performance scores across strength and endurance activities. Scores are
                algorithmic estimates — not medical advice, clinical assessments, or
                guarantees of performance or health outcomes.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">3. Your responsibilities</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>You must provide accurate information when logging workouts.</li>
                <li>You are responsible for maintaining the security of your account credentials.</li>
                <li>You must not misuse the Service, attempt unauthorised access, or scrape data at scale.</li>
                <li>You use the Service at your own risk when exercising or training.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">4. Subscriptions &amp; billing</h2>
              {/*
                This said premium was "billed via Stripe" full stop. In the iOS
                app it is not: purchases there go through Apple's in-app
                purchase, which is the whole point of the platform branch in
                lib/native/use-checkout.ts. A reviewer opens these terms from
                inside the app, so a flat claim that a digital subscription is
                billed by a third-party processor reads as the Guideline 3.1.1
                violation the app specifically avoids — and it was untrue for
                every iOS subscriber besides.

                Naming the rail per platform is also what makes the refund
                sentence honest: Apple, not us, handles refunds for anything
                bought through the App Store, and telling an iOS subscriber to
                come to us for one sends them somewhere that cannot help.
              */}
              <p className="mt-3">
                Monthly and annual subscriptions renew automatically unless cancelled
                at least 24 hours before the end of the current period. Lifetime access
                is a single one-time payment and does not renew.
              </p>
              <p className="mt-3">
                Where you buy matters for how you cancel and how you are refunded. Purchases
                made in the iOS app are processed by Apple through in-app purchase: manage or
                cancel them in your Apple subscription settings, or from Settings inside the
                app, and refunds are handled by Apple under its own policies. Purchases made
                on the web are processed by Stripe and can be cancelled from account settings,
                with refunds handled by us according to applicable consumer law.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">5. Health disclaimer</h2>
              <p className="mt-3">
                Always consult a qualified medical or fitness professional before starting
                or changing an exercise programme, especially if you have underlying health
                conditions. Stop training and seek medical advice if you experience pain,
                dizziness, or other concerning symptoms.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">6. Data &amp; privacy</h2>
              <p className="mt-3">
                Our use of your personal data is described in our{" "}
                <Link href="/privacy" className="text-accent hover:underline">
                  Privacy Policy
                </Link>
                . You may request account deletion as described there.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">7. Limitation of liability</h2>
              <p className="mt-3">
                To the fullest extent permitted by law, Split Index is provided &quot;as is&quot;
                without warranties. We are not liable for indirect, incidental, or consequential
                damages arising from your use of the Service or reliance on score estimates.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">8. Changes &amp; contact</h2>
              <p className="mt-3">
                We may update these Terms from time to time. Material changes will be
                communicated via the Service or email where appropriate. Questions:{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-white/[0.06] px-4 pt-8 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))] text-center text-sm text-muted sm:px-6">
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center px-2 transition-colors hover:text-foreground"
          >
            Privacy Policy
          </Link>
          <LegalHomeLink />
        </p>
        <p className="mt-2">© {new Date().getFullYear()} Split Index</p>
      </footer>
    </div>
  );
}
