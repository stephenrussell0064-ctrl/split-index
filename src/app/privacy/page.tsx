import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Split Index collects, uses, and protects your personal and fitness data.",
};

const EFFECTIVE_DATE = "September 2026";
const CONTACT_EMAIL = "privacy@splitindex.co.uk";

export default function PrivacyPolicyPage() {
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

      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
          <header className="mb-10 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="mt-2 text-sm text-muted">Effective date: {EFFECTIVE_DATE}</p>
          </header>

          <div className="space-y-8 text-sm leading-relaxed text-foreground/90 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-accent [&_a]:hover:underline">
            <section>
              <h2>1. Who we are</h2>
              <p className="mt-3">
                Split Index (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the Split
                Index fitness analytics platform at{" "}
                <a href="https://splitindex.co.uk">splitindex.co.uk</a>. We are the data
                controller for personal data processed through the service.
              </p>
              <p className="mt-3">
                For privacy-related enquiries, contact us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </section>

            <section>
              <h2>2. What data we collect</h2>
              <p className="mt-3">We collect and process the following categories of data:</p>
              <ul className="mt-3">
                <li>
                  <strong>Account information:</strong> email address, authentication
                  identifiers, and profile details such as username, display name, avatar,
                  and country.
                </li>
                <li>
                  <strong>Health and fitness data:</strong> workout and activity logs
                  (including sport type, duration, distance, pace, heart rate, and gym
                  exercise data), body metrics (such as weight and body fat percentage),
                  recovery metrics (such as sleep, HRV, and resting heart rate), training
                  goals, and performance scores including your Split Index.
                </li>
                <li>
                  <strong>Onboarding and preferences:</strong> age, height, weight, gender,
                  experience level, training history, and preferred sports.
                </li>
                <li>
                  <strong>Precise location and route data:</strong> when you start a GPS
                  session in the mobile app, we record your precise location repeatedly
                  for the duration of that session and store the resulting route. With
                  your permission this continues <strong>in the background, while your
                  phone is locked and the app is not on screen</strong>, because that is
                  what recording a run requires. We collect location only during a session
                  you have started, never passively, and you can stop it at any time. You
                  can also set a privacy zone so the start and end of routes near a chosen
                  address are trimmed before storage.
                </li>
                <li>
                  <strong>Apple Health and connected sensors (mobile app):</strong> with
                  your permission we read heart rate from Apple Health during a session —
                  including from AirPods Pro — and start a HealthKit workout session so
                  that sensor turns on. We also connect over Bluetooth to heart-rate straps
                  and compatible equipment such as the Concept2 PM5, and read motion and
                  step data to calculate your cadence. Each of these is optional, is asked
                  for separately by iOS or Android, and can be revoked in your device
                  settings without losing your account.
                </li>
                <li>
                  <strong>Payment information:</strong> subscription status, billing
                  history, and payment-processor identifiers. On the web, payment card
                  details are collected and processed directly by Stripe. In the iOS and
                  Android apps, purchases are made through Apple&apos;s In-App Purchase or
                  Google Play Billing and are recorded for us by RevenueCat; we never see
                  or store your card details in either case.
                </li>
                <li>
                  <strong>OAuth data:</strong> when you sign in with Google or with
                  Apple, we receive the account identifiers you authorise through that
                  provider. Sign in with Apple lets you hide your real email address; if
                  you do, we only ever hold Apple&apos;s relay address.
                </li>
                <li>
                  <strong>Social features:</strong> friend connections, leaderboard
                  participation, and public profile information you choose to share.
                </li>
                <li>
                  <strong>Technical and usage data:</strong> IP address, browser type,
                  device information, cookies, and logs related to how you use the service.
                </li>
                <li>
                  <strong>AI-generated content:</strong> workout analysis and coaching
                  feedback generated from your activity data.
                </li>
              </ul>
            </section>

            <section>
              <h2>3. How we use your data</h2>
              <p className="mt-3">We use your data to:</p>
              <ul className="mt-3">
                <li>Provide, maintain, and improve the Split Index service;</li>
                <li>Calculate performance scores, analytics, and personalised insights;</li>
                <li>Process subscriptions and manage billing;</li>
                <li>Authenticate your account and secure the platform;</li>
                <li>Import and sync activities from connected fitness integrations;</li>
                <li>Enable social features such as leaderboards and shared profiles;</li>
                <li>Generate AI-powered coaching feedback based on your workout data;</li>
                <li>Communicate with you about your account, updates, and support requests;</li>
                <li>Comply with legal obligations and enforce our terms.</li>
              </ul>
              <p className="mt-3">
                If you sign in with Google, we use the Google account information you
                authorise (such as your name and email address) solely to create and
                authenticate your Split Index account. We do not use Google user data for
                advertising, and we do not sell your personal data.
              </p>
            </section>

            <section>
              <h2>4. Legal bases for processing (UK GDPR)</h2>
              <p className="mt-3">
                Under UK data protection law, we rely on the following legal bases:
              </p>
              <ul className="mt-3">
                <li>
                  <strong>Contract:</strong> processing necessary to provide the service
                  you sign up for, including account management, scoring, and subscriptions.
                </li>
                <li>
                  <strong>Consent:</strong> where you connect third-party integrations,
                  enable optional features, or agree to marketing communications.
                </li>
                <li>
                  <strong>Legitimate interests:</strong> to improve the service, prevent
                  fraud, and maintain security, balanced against your rights.
                </li>
                <li>
                  <strong>Legal obligation:</strong> where we must retain or disclose data
                  to comply with applicable law.
                </li>
              </ul>
              <h3 className="mt-6 font-medium">Training data and health data are not the same thing</h3>
              <p className="mt-3">
                We treat what you log and what you tell us about your health as two
                separate categories, with two different legal bases.
              </p>
              <ul className="mt-3">
                <li>
                  <strong>Your training data — contract.</strong> Sets, reps, loads,
                  distances, times, session heart rate, bodyweight entries, age and sex.
                  These are the inputs you give us to get the service you signed up for;
                  the scoring engine cannot work without them. On their own they record
                  what you did, not what condition you are in, so we do not treat them as
                  health data.
                </li>
                <li>
                  <strong>Your health screening — explicit consent.</strong> The PAR-Q
                  answers, injury history, recent surgery, pregnancy or postpartum status,
                  medication affecting your heart rate, and the low-energy-availability
                  questions, together with the injury Risk Index. These exist to work out
                  whether something is safe for you, which makes them special category
                  data under Article 9. We only process them if you explicitly agree, and
                  we keep a record of exactly what you were shown when you did.
                </li>
              </ul>
              <p className="mt-3">
                You can refuse, and you can change your mind. Refusing switches off the
                Hybrid Plan and the injury Risk Index and nothing else — logging, your
                Split Index, predictions, the leaderboard, analytics and your subscription
                all work either way. You can withdraw in one action from Settings, and
                withdrawing deletes those answers rather than hiding them.
              </p>
            </section>

            <section>
              <h2>5. Third-party service providers</h2>
              <p className="mt-3">
                We use trusted processors to operate Split Index. They may process your
                data only on our instructions and subject to appropriate safeguards:
              </p>
              <ul className="mt-3">
                <li>
                  <strong>Supabase</strong> — authentication, database hosting, and file
                  storage;
                </li>
                <li>
                  <strong>Vercel</strong> — application hosting and content delivery;
                </li>
                <li>
                  <strong>Stripe</strong> — payment processing and subscription management;
                </li>
                <li>
                  <strong>Google</strong> — OAuth sign-in (when you choose to use it);
                </li>
                <li>
                  <strong>Apple</strong> — Sign in with Apple (when you choose it) and
                  In-App Purchase for subscriptions bought in the iOS app;
                </li>
                <li>
                  <strong>Google Play</strong> — billing for subscriptions bought in the
                  Android app;
                </li>
                <li>
                  <strong>RevenueCat</strong> — recording and validating mobile
                  subscription receipts from Apple and Google;
                </li>
                <li>
                  <strong>OpenAI</strong> — AI-generated coaching feedback based on your
                  workout data.
                </li>
              </ul>
              <p className="mt-3">
                Your location and route data is <strong>not</strong> shared with any of
                these providers beyond the hosting and database services that store it, and
                is never sold, shared for advertising, or used to build a profile of your
                movements outside the sessions you record.
              </p>
              <p className="mt-3">
                Each third party operates under its own privacy policy, and each is bound
                by a written agreement requiring them to protect your data to a standard at
                least equivalent to the one described in this policy, to process it only on
                our instructions, and to apply appropriate technical and organisational
                security measures. We encourage you to review their policies when
                connecting external accounts.
              </p>
            </section>

            <section>
              <h2>6. Cookies and similar technologies</h2>
              <p className="mt-3">
                We use cookies and similar technologies to keep you signed in, remember
                preferences, and understand how the service is used. Essential cookies are
                required for authentication and core functionality. Where non-essential
                cookies are used, we will request your consent in line with UK requirements.
              </p>
              <p className="mt-3">
                You can control cookies through your browser settings. Disabling essential
                cookies may prevent you from using certain features, including sign-in.
              </p>
            </section>

            <section>
              <h2>7. Data sharing</h2>
              <p className="mt-3">
                We do not sell your personal data. We may share data:
              </p>
              <ul className="mt-3">
                <li>With service providers listed above, to operate the platform;</li>
                <li>
                  With other users, when you use social features or set your profile to
                  be publicly visible;
                </li>
                <li>
                  When required by law, regulation, court order, or to protect the rights
                  and safety of Split Index, our users, or others;
                </li>
                <li>
                  In connection with a merger, acquisition, or sale of assets, subject to
                  appropriate confidentiality protections.
                </li>
              </ul>
            </section>

            <section>
              <h2>8. International transfers</h2>
              <p className="mt-3">
                Some of our service providers may process data outside the United Kingdom.
                Where this occurs, we ensure appropriate safeguards are in place, such as
                UK adequacy regulations, Standard Contractual Clauses, or equivalent
                mechanisms recognised under UK GDPR.
              </p>
            </section>

            <section>
              <h2>9. Data retention, deletion, and withdrawing consent</h2>
              <p className="mt-3">
                We retain your data for as long as your account is active and as needed to
                provide the service.
              </p>
              <p className="mt-3">
                <strong>You can delete your account and all of its data from inside the
                app</strong>, under Settings → Delete account. Deletion removes your
                profile, every logged activity and route, your scores and index history,
                your social connections, and your training plans. It takes effect
                immediately and cannot be undone. We retain only what we are legally
                required to keep for accounting and fraud-prevention purposes, which does
                not include your training or location data. You can also request deletion
                by emailing{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
              <p className="mt-3">
                <strong>Withdrawing consent does not require deleting your account.</strong>{" "}
                Location, Apple Health, Bluetooth and motion access are each granted
                separately, and each can be revoked at any time in your device&apos;s
                settings — on iOS under Settings → Split Index, on Android under App info →
                Permissions. Revoking one stops that collection from then on and disables
                only the features that depend on it; everything you have already logged
                stays yours and remains available. Disconnecting a third-party integration
                in Settings stops any further import from that provider.
              </p>
              <p className="mt-3">
                Deleting the app from your device does <strong>not</strong> delete your
                account, because your data is held on our servers rather than on the phone.
                Use the in-app deletion above, or email us.
              </p>
            </section>

            <section>
              <h2>10. Your rights</h2>
              <p className="mt-3">
                Under UK GDPR, you have the right to:
              </p>
              <ul className="mt-3">
                <li>Access the personal data we hold about you;</li>
                <li>Request correction of inaccurate data;</li>
                <li>Request deletion of your data in certain circumstances;</li>
                <li>Restrict or object to certain processing;</li>
                <li>Request portability of data you provided to us;</li>
                <li>Withdraw consent where processing is based on consent;</li>
                <li>Lodge a complaint with the Information Commissioner&apos;s Office (ICO) at{" "}
                  <a href="https://ico.org.uk">ico.org.uk</a>.
                </li>
              </ul>
              <p className="mt-3">
                To exercise your rights, email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We may need to
                verify your identity before responding.
              </p>
            </section>

            <section>
              <h2>11. Security</h2>
              <p className="mt-3">
                We implement appropriate technical and organisational measures to protect
                your data, including encryption in transit, access controls, and row-level
                security on user data. No method of transmission or storage is completely
                secure; please use a strong, unique password and keep your credentials
                confidential.
              </p>
            </section>

            <section>
              <h2>12. Children</h2>
              <p className="mt-3">
                Split Index is not intended for users under 13 years of age. We do not
                knowingly collect personal data from children under 13. If you believe a
                child has provided us with personal data, please contact us and we will
                take steps to delete it.
              </p>
            </section>

            <section>
              <h2>13. Changes to this policy</h2>
              <p className="mt-3">
                We may update this Privacy Policy from time to time. We will post the
                revised version on this page and update the effective date. Where changes
                are material, we will provide additional notice where appropriate.
              </p>
            </section>

            <section>
              <h2>14. Contact</h2>
              <p className="mt-3">
                Questions about this Privacy Policy or our data practices? Contact us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or{" "}
                <a href="mailto:support@splitindex.co.uk">support@splitindex.co.uk</a>.
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-sm text-muted">
        <p>© {new Date().getFullYear()} Split Index. All rights reserved.</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
        </p>
      </footer>
    </div>
  );
}
