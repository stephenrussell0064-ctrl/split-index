# What is still needed before submitting — the parts no commit can do

The code-side App Store blockers from `app-store-readiness.md` are fixed. Everything below needs an
account, a console, or a decision, and none of it can be done from this repository. It is ordered by
what stops a submission first.

Nothing here is optional. Each item is the other half of a fix that has already landed in code, and
shipping the code half alone leaves the app rejectable in exactly the same way.

---

## 1. RevenueCat and In-App Purchase — Guideline 2.1(b) / 3.1.1

**Status: the code is ready and the configuration is not.** `SkuPicker` now decides on the platform
synchronously, so a native build can no longer reach Stripe. That closes the "wrong payment method"
problem and converts it into "no payment method" until this is done.

1. Create the three products in **App Store Connect** — monthly, annual, lifetime — matching the SKUs
   in `src/lib/pricing/config.ts`, and the equivalents in **Google Play Console**.
2. Wire them into a RevenueCat offering, with entitlement identifiers matching what
   `src/lib/native/billing.ts` expects.
3. Set both keys in the **Vercel production environment**:
   - `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY`
   - `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY`

   They are now documented in `.env.example`, which is tracked from this commit onward — it was
   gitignored, which is how they went missing in the first place.
4. **Redeploy.** These are `NEXT_PUBLIC_` variables, inlined at build time, and `capacitor.config.ts`
   points the native app at the live site. Setting them without a rebuild changes nothing on device.
5. Apply `supabase/migrations/026_native_billing_source.sql` if it is not already applied.
6. Make a **sandbox purchase on a real device** and confirm `profiles.subscription_tier` flips. Do not
   submit before this has been seen working once.

---

## 2. Sign in with Apple — Guideline 4.8

**Status: the button, the handler and the entitlement are in.** The provider is not.

1. In the **Apple Developer portal**: enable Sign in with Apple on the App ID, create a Services ID,
   register the return URL `https://<your-supabase-project>.supabase.co/auth/v1/callback`, and generate
   a key.
2. In **Supabase → Authentication → Providers → Apple**: enable it and enter the Services ID, Team ID,
   Key ID and private key.
3. Confirm `co.uk.splitindex.app://auth-callback` is in Supabase's redirect allowlist — the native flow
   uses the same custom scheme Google already does.
4. Test on a device. Sign in with Apple must work before submission; a visible button that errors is
   worse than no button, because it fails 4.8 *and* 2.1.

---

## 3. Moderation — Guideline 1.2

Three of the four requirements are now in code: the objectionable-content filter covers usernames,
display names and squad names; reports go to the `content_reports` queue; blocking is immediate and
enforced server-side. The fourth is yours, and so is the promise attached to the third.

1. **Publish contact information** — on the marketing site and in the App Store listing. Guideline 1.2
   requires users be able to reach you.
2. **Commit to the response time the app already states.** `ReportBlockMenu` tells athletes a person
   reviews every report and looks at each within 24 hours. Decide who does that, and make sure they
   can see the queue:
   ```sql
   select * from content_reports where status = 'open' order by created_at;
   ```
   RLS deliberately gives no one read access to other people's reports, so triage runs through the
   service role. There is no admin UI for this yet — if the volume ever justifies one, it belongs
   beside the existing `/admin/hpe-fleet` page.
3. Decide what "actioned" means in practice — warning, suspension, removal — before the first report
   arrives rather than after.

---

## 4. App Privacy answers, and keeping three documents in step

`ios/App/App/PrivacyInfo.xcprivacy` now declares precise location, health, fitness, email, name, user
ID, purchase history and user content, all linked to the user, none used for tracking. The privacy
policy at `src/app/privacy/page.tsx` now covers background GPS, HealthKit, Bluetooth, motion, and
RevenueCat/Apple/Google as processors.

**The App Privacy "nutrition label" in App Store Connect must match both.** Three documents saying
different things is worse than one saying nothing, because a manifest is a statement Apple can hold you
to. When you change what the app collects, change all three.

Also confirm the RevenueCat SDK ships its own privacy manifest and signature — if the pinned version
predates manifest support, upgrade it, or the upload fails on the SDK rather than on your target.

---

## 5. Submission mechanics

- **Demo account** (Guideline 2.1(a), mandatory — the app is login-gated). Give it a populated history:
  a reviewer opening an empty dashboard cannot see the app. Note in the review notes that it is a
  premium account, or they cannot reach the paid surfaces.
- **App Review notes** — say where the native features are, or Guideline 4.2 becomes a question:
  background GPS tracking with the screen locked, Live Activities, the home-screen widget, Bluetooth
  heart-rate straps and Concept2 PM5 support, HealthKit. Also state plainly that the app loads its UI
  from `splitindex.co.uk` inside a Capacitor shell.
- **Screenshots** for every required size, showing real data.
- **Age rating** — answer the questionnaire honestly about user-generated content and social features.
- Export compliance is now declared in `Info.plist` (`ITSAppUsesNonExemptEncryption = false`), so App
  Store Connect will stop asking per build.

---

## 6. Known and deliberate, worth saying in the notes

- **The plan screen's safety cards were removed on purpose**, and the cardiac / PAR-Q+ referral was put
  back as a single banner (`medicalRedFlag`). If a reviewer asks why a training app takes health
  answers and shows so little back: the answers shape the block's intensity ceiling and volume ramp,
  and only a possible cardiac symptom raises a visible referral.
- **The app is a remote-loaded WebView.** That is defensible given the native feature set, but it is
  the first thing a reviewer will notice. Say it before they find it.
- The **male cycling anchor table** is still calibrated on a club population rather than the general
  one used by running, rowing and swimming. Not an App Store issue; a scoring-accuracy one, recorded in
  `scoring-accuracy.md`.
