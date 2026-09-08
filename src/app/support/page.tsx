import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { mainContentProps } from "@/lib/a11y/main-content";

export const metadata: Metadata = {
  title: "Support · Split Index",
  description:
    "Get help with Split Index — account and sign-in, subscriptions, device connections, your data, and how to report content or behaviour.",
};

/**
 * The public support page.
 *
 * This is the URL given to Apple as the App Store "Support URL", so it has two
 * jobs beyond being useful. App Review fetches it and checks a real person can
 * be reached from it — a `mailto:` alone is not accepted as the Support URL,
 * which is why this exists as a page rather than a link on the homepage. And
 * Guideline 1.2 requires an app carrying user-generated content to publish
 * contact information for reports of abuse, which is the "Reporting content or
 * behaviour" section below.
 *
 * Deliberately says nothing about subscribing on the web. Guideline 3.1.1(a)
 * prohibits steering UK-storefront customers toward non-IAP purchasing, and
 * this page is App Store metadata by virtue of being the Support URL, so it
 * describes managing an existing subscription and never where to buy one.
 */

const SUPPORT_EMAIL = "support@splitindex.co.uk";
const PRIVACY_EMAIL = "privacy@splitindex.co.uk";
const RESPONSE_TARGET = "two working days";

export default function SupportPage() {
  return (
    <div className="min-h-dvh bg-[#050508] text-foreground">
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

      <main {...mainContentProps} className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
          <header className="mb-10 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">Support</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Email{" "}
              <a className="text-accent hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              and a human will reply, normally within {RESPONSE_TARGET}. Tell us
              your account email, your device and iOS version, and what you
              expected to happen — it saves a round trip.
            </p>
          </header>

          <div className="space-y-8 text-sm leading-relaxed text-foreground/90 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-accent [&_a]:hover:underline">
            <section>
              <h2>Account and sign-in</h2>
              <ul className="mt-3">
                <li>
                  <strong>Forgotten password:</strong> use{" "}
                  <Link href="/forgot-password">Forgot password</Link> on the sign-in
                  screen. The reset link is sent to your account email.
                </li>
                <li>
                  <strong>No confirmation email:</strong> check spam, then email us —
                  we can confirm the address manually.
                </li>
                <li>
                  <strong>Signed in with Google:</strong> use the same Google button
                  each time. Signing up separately with an email and password creates
                  a second, empty account.
                </li>
              </ul>
            </section>

            <section>
              <h2>Subscriptions and billing</h2>
              <p className="mt-3">
                Premium unlocks the AI Coach, the Injury Risk Index, full Strength
                and cardio analysis, 90-day trends, projections, global leaderboards
                and data export.
              </p>
              <ul className="mt-3">
                <li>
                  <strong>Managing or cancelling:</strong> if you subscribed in the
                  iPhone app, your subscription is held by Apple. Open the Settings
                  app, tap your name, then Subscriptions. Cancelling there stops the
                  renewal and you keep access until the period ends.
                </li>
                <li>
                  <strong>Refunds for App Store purchases</strong> are handled by
                  Apple at{" "}
                  <a
                    href="https://reportaproblem.apple.com"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    reportaproblem.apple.com
                  </a>
                  . We cannot issue them on Apple&apos;s behalf, but tell us what
                  went wrong and we will fix the underlying problem.
                </li>
                <li>
                  <strong>Restoring a purchase:</strong> if Premium does not appear
                  after reinstalling or changing device, open Settings → Billing in
                  the app and tap <em>Restore purchases</em>.
                </li>
                <li>
                  <strong>Charged but still on Free:</strong> email us with the date
                  and we will reconcile it against the purchase record.
                </li>
              </ul>
            </section>

            <section>
              <h2>Tracking, devices and sensors</h2>
              <ul className="mt-3">
                <li>
                  <strong>GPS stops when the screen locks:</strong> Split Index needs
                  Location set to <em>Always</em> to keep recording a locked-screen
                  run. iOS Settings → Split Index → Location.
                </li>
                <li>
                  <strong>Heart rate straps and rowing machines:</strong> we connect
                  to standard Bluetooth devices, including Garmin and Polar straps
                  and the Concept2 PM5. Wake the device and make sure no other app
                  holds the connection — Bluetooth sensors pair with one app at a
                  time.
                </li>
                <li>
                  <strong>Apple Health heart rate:</strong> grant access in iOS
                  Settings → Privacy &amp; Security → Health → Split Index. If you
                  declined the first prompt, iOS will not ask again and it must be
                  enabled there.
                </li>
                <li>
                  <strong>A session did not upload:</strong> sessions recorded
                  without signal are queued on the device and sent when you are back
                  online. Reopen the app while connected. If it has not cleared,
                  email us before deleting the app — uninstalling discards the queue.
                </li>
              </ul>
            </section>

            <section>
              <h2>Your data</h2>
              <ul className="mt-3">
                <li>
                  <strong>Exporting:</strong> Premium accounts can export activities
                  as CSV or JSON from Settings.
                </li>
                <li>
                  <strong>Deleting your account:</strong> email{" "}
                  <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from your
                  account address and we will delete your account and its data.
                </li>
                <li>
                  <strong>What we collect and why</strong> is set out in the{" "}
                  <Link href="/privacy">Privacy Policy</Link>, including location,
                  health and sensor data.
                </li>
              </ul>
            </section>

            <section>
              <h2>Reporting content or behaviour</h2>
              <p className="mt-3">
                Split Index has social features — comments, leaderboards and public
                profiles — so some of what you see is written by other people. We do
                not allow harassment, abuse, impersonation, or content that is
                sexual, violent, hateful or otherwise objectionable.
              </p>
              <p className="mt-3">
                To report a comment, profile or username, email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the word
                &quot;Report&quot; in the subject, plus the username involved and
                what you saw. We aim to review reports within 24 hours and will
                remove content and suspend accounts where our rules have been
                broken. If you are in immediate danger, contact your local emergency
                services first.
              </p>
            </section>

            <section>
              <h2>Scores and training guidance</h2>
              <p className="mt-3">
                Split Index is an analytics tool, not a medical device, and nothing
                in the app is medical advice. Scores, the Injury Risk Index and any
                coaching output are estimates from the data you log. If something
                hurts, or you are unsure whether training is safe for you, speak to a
                qualified clinician. How the scores are calculated is documented in{" "}
                <Link href="/how-scoring-works">How scoring works</Link>.
              </p>
            </section>

            <section>
              <h2>Accessibility</h2>
              <p className="mt-3">
                We aim for WCAG 2.2 level AA and are not there yet. The{" "}
                <Link href="/accessibility">accessibility statement</Link> says
                honestly where we fall short. If something in the app is unusable for
                you, email us and we will treat it as a bug, not a request.
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-sm text-muted">
        <p>© {new Date().getFullYear()} Split Index. All rights reserved.</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link href="/accessibility" className="hover:text-foreground transition-colors">
            Accessibility
          </Link>
        </p>
      </footer>
    </div>
  );
}
