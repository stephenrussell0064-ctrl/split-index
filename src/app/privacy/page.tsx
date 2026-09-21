import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { LegalBackLink } from "@/components/legal/legal-back-link";
import { LegalHomeLink } from "@/components/legal/legal-home-link";
import { mainContentProps } from "@/lib/a11y/main-content";

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
      {/*
        Padded past the status bar: inside the app this header sits under it,
        and a back control that cannot be tapped is not a way out.
      */}
      <header className="border-b border-white/[0.06] glass-strong pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandMark variant="compact" href="/" iconSize={30} wordmarkSize="sm" />
          <LegalBackLink />
        </div>
      </header>

      <main {...mainContentProps} className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
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
                <a href="https://splitindex.co.uk">splitindex.co.uk</a> and the Split Index
                mobile apps for iOS and Android. This policy covers all of them; where
                something applies only to the mobile apps, it says so. We are the data
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
                  <strong>Location data (mobile apps):</strong> when you start a tracked
                  outdoor session, we use your device&apos;s precise location, including
                  while the app is in the background or your phone is locked, so tracking
                  survives a pocketed phone. The individual GPS fixes stay on your device,
                  in the app&apos;s own storage, so an interrupted run can be recovered —
                  we never receive them. What we do receive is the session summary
                  (distance, duration, pace and elevation gain) and a simplified route, so
                  the run can be drawn on a map. That route is a real record of where you
                  went, and we store it. Before it is written we remove the first and the
                  last stretch of the run, so a stored route never begins or ends at your
                  front door; the honest limit of that is worth stating, because it hides
                  your start and your finish and not every moment you were near home — a
                  loop that passes the house at halfway still shows that passage. An
                  athlete you have accepted as a friend can see the stored route wherever
                  they can see the activity itself. The one other thing we receive is the
                  coordinate a session starts at, sent so we can look up the temperature at
                  the time; it is used for that and not stored as part of your activity. We
                  never collect location when a session is not running, and you can refuse
                  or revoke the permission in your device settings.
                </li>
                <li>
                  <strong>Run analysis and best efforts (mobile apps):</strong> for a
                  GPS-tracked session we also store the per-sample series the analysis is
                  built from — for each sample, how far into the run it was in moving
                  seconds and cumulative metres, and the altitude, heart rate and cadence
                  recorded at that point. It holds no coordinates: it records how far along
                  the run you were, never where you were. From it we store your best
                  efforts — your fastest stretch at each standard distance in that session,
                  and when it happened — which is what lets the app tell you a run was your
                  fastest ever. We record both for every athlete, whether or not you are
                  subscribed, so that the analysis is there for the runs you logged before
                  you subscribed rather than a hole in your history. Both are visible only
                  to you: they are not shown to friends, do not appear on any leaderboard,
                  and are deleted with the activity they belong to.
                </li>
                <li>
                  <strong>Motion and fitness sensors (mobile apps):</strong> step counts
                  from your device&apos;s motion sensors during a run or walk, used to show
                  your cadence.
                </li>
                <li>
                  <strong>Connected Bluetooth equipment (mobile apps):</strong> readings
                  from heart rate monitors and rowing machines you choose to pair, such as
                  heart-rate straps and compatible equipment such as the Concept2 PM5. We use Bluetooth to talk to the
                  equipment in front of you; we do not use it to detect your location or
                  nearby devices for any other purpose.
                </li>
                <li>
                  <strong>Apple Health (iOS app):</strong> if you allow it, we read your
                  heart rate from Apple Health during a session, including from compatible
                  headphones. The app also starts a Health workout session so those sensors
                  switch on — that workout is not saved to Apple Health.
                </li>
                <li>
                  <strong>Payment information:</strong> subscription status, billing
                  history, and Stripe customer identifiers. Payment card details are
                  collected and processed directly by Stripe; we do not store full card
                  numbers.
                </li>
                <li>
                  <strong>In-app purchases (mobile apps):</strong> subscriptions bought
                  inside the apps are processed by Apple or Google, not by us. We receive
                  the purchase and renewal status for your account through RevenueCat. We
                  never see your card details, and Apple and Google do not give them to us.
                </li>
                <li>
                  <strong>OAuth data:</strong> when you sign in with Google or Apple, we
                  receive account identifiers authorised by you through that provider. If
                  you use Apple&apos;s Hide My Email, we only ever see the relay address
                  Apple gives us, never your real one.
                </li>
                <li>
                  <strong>Social features and content you write:</strong> friend
                  connections, leaderboard participation, public profile information you
                  choose to share, and free text you enter yourself — your profile bio, and
                  comments you leave on activities shared with you.
                </li>
                <li>
                  <strong>Blocks and reports:</strong> if you block another athlete we
                  store that you did, so we can hide you from each other. If you report a
                  comment or a profile we store what you reported, the reason you chose,
                  and anything you typed in the box. Reports name the account they are
                  about — so a report someone files about you is data we hold about you,
                  and you can ask us for it like any other. We do not tell the person who
                  was reported who reported them.
                </li>
                <li>
                  <strong>In-app notifications:</strong> the messages the app writes for
                  you and shows behind the bell — currently a reminder that a training
                  streak is about to end, and a welcome prompt if you have not logged a
                  workout yet. We store the title, the text of the message, and whether you
                  have read it. Some of that text is a fact about your training: a streak
                  reminder names how many days your streak has run. Only you can read your
                  notifications, and they are deleted with your account. We do not send
                  push notifications to your device at all — the app does not ask for that
                  permission and holds no device token.
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
                <li>
                  Measure distance, pace, splits and cadence during a tracked session, and
                  record heart rate from Apple Health or a paired Bluetooth device;
                </li>
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

              <h3 className="mt-6 font-medium">
                What we never do with health, location or sensor data
              </h3>
              <p className="mt-3">
                Health, location, motion and connected-device data is used to run the
                service and nothing else. Specifically, we do not:
              </p>
              <ul className="mt-3">
                <li>Use any of it for advertising or marketing;</li>
                <li>Sell it, or share it with data brokers;</li>
                <li>
                  Use it to track you across other companies&apos; apps or websites. The
                  apps contain no advertising or cross-app tracking SDKs;
                </li>
                <li>
                  Disclose data read from Apple Health to any third party without your
                  consent, or use it for anything other than your own health and fitness
                  in the app.
                </li>
              </ul>
              <p className="mt-3">
                Location, motion, Bluetooth and Apple Health access are each asked for
                separately, and each is optional. You can refuse any of them, or withdraw
                them later in your device settings; the rest of the app keeps working
                without them, with the feature that needed the sensor switched off.
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
                  <strong>OpenAI</strong> — AI-generated coaching feedback based on your
                  workout data;
                </li>
                <li>
                  <strong>Apple and Google</strong> — payment processing for subscriptions
                  bought inside the mobile apps. They act as the seller for those purchases
                  under their own terms, not as our processor;
                </li>
                <li>
                  <strong>RevenueCat</strong> — recording which subscription an account
                  holds and when it renews, for purchases made inside the mobile apps;
                </li>
                <li>
                  <strong>Upstash</strong> — rate limiting, which processes IP addresses to
                  stop abuse of the service.
                </li>
              </ul>
              <p className="mt-3">
                Each third party operates under its own privacy policy. We encourage you to
                review their policies when connecting external accounts.
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
              <p className="mt-3">
                People working on Split Index are not a fourth kind of sharing, but you
                should know what they can reach. Section 11 sets out which of us can see
                anything across accounts, what that view does and does not show, and what is
                recorded every time somebody opens it.
              </p>
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
              <h2>9. Data retention</h2>
              <p className="mt-3">
                We retain your data for as long as your account is active and as needed to
                provide the service. If you delete your account, we will delete or
                anonymise your personal data within a reasonable period, except where we
                must retain information for legal, accounting, or fraud-prevention
                purposes.
              </p>
              <p className="mt-3">
                You can delete your account yourself, from Settings in the app or on the
                website — you do not need to email us or ask permission. Deleting removes
                your account and the data held against it, including your activities, your
                health screening answers and your profile. Everything we hold about a
                tracked session goes with that activity — its stored route, its per-sample
                series and its best efforts — because each is attached to the activity and
                deleted with it. The raw GPS fixes are the one part we never held: they sit
                in the app&apos;s own storage on your device, and removing the app deletes
                those with it.
              </p>
              <p className="mt-3">
                Deleting your Split Index account does not cancel a subscription bought
                through Apple or Google. Those are managed by the store that sold them —
                on iOS, through Manage Subscription in the app or in your Apple account
                settings.
              </p>
              <p className="mt-3">
                Two kinds of security record outlive a deletion, and they do it by ceasing
                to name you rather than by being kept about you. If your account ever
                reached an administrator surface, or triggered a security event, those rows
                stay — but the reference to your account is set to empty, so what remains
                says that something happened and no longer says who. An account being
                erased must not be able to erase the record that it once read across the
                fleet, or that it was refused repeatedly; that is the balance we have struck
                between an audit trail and your right to erasure.
              </p>
              <p className="mt-3">
                Reports are the one thing kept when the content they are about is gone.
                If someone reports a comment and the comment is then deleted, the report
                stays — otherwise anyone could clear their record by deleting the post,
                and the pattern of reports about an account is the part that matters for
                keeping people safe. A report is kept against the account it names, and
                goes when that account is deleted.
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

              <h3 className="mt-6 font-medium">
                Who at Split Index can see your data, and what is recorded when they look
              </h3>
              <p className="mt-3">
                You are entitled to know who sees your data and not only what we store, so
                this says so plainly. Row-level security scopes every ordinary read in the
                app to a single account: when the app asks the database for activities, it
                can only be given yours. There is one route that steps outside that, and it
                is worth describing exactly.
              </p>
              <p className="mt-3">
                A small number of people running Split Index hold an administrator role. It
                gives them one thing: an operations view used to decide whether a feature
                being rolled out is behaving safely and whether to pause it. That view is
                the only place in the service that reads across all accounts rather than
                one. What it shows is aggregate only — counts, averages and distributions.
                No account identifier, email address or individual athlete&apos;s row is
                included in it, and the code checks its own output and refuses to return
                anything containing an identifier. So an administrator can see that, for
                example, a number of athletes recorded a particular kind of session last
                week. They cannot use this view to look up you.
              </p>
              <p className="mt-3">
                We store who holds an administrator role: the account, which of the two
                roles it is, when it was granted, by whom, and a note. Nobody can give
                themselves the role — there is no route through the app that grants it, and
                it has to be done directly against the database by someone with that
                access.
              </p>
              <p className="mt-3">
                Every attempt to reach an administrator surface is recorded, whether or not
                it succeeded. Administrator access is recorded as: the account that tried,
                the role it held, which route it asked for, whether it was a read or a
                change, whether it was allowed or refused, and the parameters of the request
                — a number of days, a rollout percentage. It never holds health data, a
                body measurement, a health-screening answer, an access token or an email
                address. Refusals are kept deliberately: one account being refused
                repeatedly is what tells us somebody is probing, and a record of successes
                alone cannot show an attempt that failed.
              </p>
              <p className="mt-3">
                If you are not an administrator, none of these records are about you. If you
                are, they are your personal data and you can ask us for them like any other.
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

      <footer className="border-t border-white/[0.06] px-4 pt-8 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))] text-center text-sm text-muted sm:px-6">
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center px-2 transition-colors hover:text-foreground"
          >
            Terms of Service
          </Link>
          <LegalHomeLink />
        </p>
        <p className="mt-2">© {new Date().getFullYear()} Split Index. All rights reserved.</p>
      </footer>
    </div>
  );
}
