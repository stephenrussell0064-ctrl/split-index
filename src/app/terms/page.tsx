import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of Split Index fitness analytics.",
};

const EFFECTIVE_DATE = "July 2026";
const CONTACT_EMAIL = "support@splitindex.co.uk";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#050508] text-foreground">
      <header className="border-b border-white/[0.06] glass-strong">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BrandMark variant="compact" href="/" iconSize={30} wordmarkSize="sm" />
          <Link
            href="/"
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
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
              <p className="mt-3">
                Premium features are billed via Stripe on a recurring basis unless cancelled.
                Refunds are handled according to applicable consumer law and our billing
                provider&apos;s policies. You may cancel at any time from account settings.
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

      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-sm text-muted">
        <p>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
        </p>
        <p className="mt-2">© {new Date().getFullYear()} Split Index</p>
      </footer>
    </div>
  );
}
