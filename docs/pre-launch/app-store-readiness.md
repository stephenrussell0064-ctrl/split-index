# Split Index — App Store & Google Play readiness review

**Reviewed:** 6 September 2026 · branch `hybrid-plan-engine` · Next.js 16 + Capacitor 8
**Reviewed as:** Apple App Review engineer, against the App Store Review Guidelines as published at
<https://developer.apple.com/app-store/review/guidelines/> (fetched during this review).
**Binary under review:** `co.uk.splitindex.app`, `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 2.

---

## VERDICT

# REJECTED — iOS

This build would be rejected on the first pass, and probably on the second. There are **seven independent
blockers**, at least three of which are the kind that get an app bounced within an hour of review starting.
The single worst is Guideline 3.1.1: the most prominent upgrade button in the app takes a payment through
Stripe, in a UK-storefront app, with no In-App Purchase branch at all.

The good news is that none of the blockers is architectural. The native surface is genuinely strong —
five custom Swift plugins, a WidgetKit extension, Live Activities, an App Group, HealthKit workout
sessions to wake the AirPods Pro heart sensor, background GPS with an offline submit queue. Guideline 4.2
is comfortably satisfied. This is a real app with a fixable submission, not a wrapped website with an
unfixable one.

**Google Play: REJECTED**, for a smaller and more mechanical set of reasons (see the Play section). Play's
blockers are mostly console declarations rather than code.

---

## BLOCKERS

Each of these will, on its own, produce a rejection.

---

### B1 — Guideline 3.1.1 (In-App Purchase): the Settings screen sells a subscription through Stripe

**Severity: critical. This is the top blocker.**

**What the reviewer will see.** They sign in, tap the Settings tab, and land on a "Subscription" card
offering "Start 14-Day Free Trial". They tap it. The WebView leaves the app for a `checkout.stripe.com`
URL and asks for a credit card. That is a Guideline 3.1.1 violation in the plainest form Apple recognises,
and because the app's storefront is the UK (`£` pricing, `co.uk` bundle ID, `splitindex.co.uk`), the
United States external-link carve-out in 3.1.1(a) does not rescue it. In all storefronts other than the
US, "apps and their metadata may not include buttons, external links, or other calls to action that direct
customers to purchasing mechanisms other than in-app purchase."

**Exact code path:**

- `src/app/(app)/settings/page.tsx:142-152` — `handleCheckout()` calls `startStripeCheckout()`
  unconditionally. There is no `isNativePlatform()` check anywhere in this file.
- `src/app/(app)/settings/page.tsx:355` — the button that calls it:
  `<Button className="w-full" loading={loading} onClick={handleCheckout}>`
- `src/lib/stripe/start-checkout.ts:9` — `POST /api/stripe/checkout`
- `src/app/(app)/settings/page.tsx:145-148` — on success, `window.location.href = result.url`

Note the second-order effect: `checkout.stripe.com` is **not** in `capacitor.config.ts`'s
`allowNavigation` list (which covers only `splitindex.co.uk` and subdomains), so Capacitor will punt the
navigation out to Safari. An external browser opening a card form is the textbook definition of the
steering Apple prohibits — it is worse than an in-WebView checkout, not better.

**Fix.** `src/app/(app)/settings/page.tsx` must not contain its own paywall. Delete the inline
Free/Premium comparison and the `handleCheckout` button, and replace them with the same
`<Link href="/settings/billing">` the premium branch of that card already uses at line 314. The
`/settings/billing` route already renders `SkuPicker`, which does branch on platform. One paywall
component, one code path.

---

### B2 — Guideline 3.1.1: `SkuPicker` falls through to Stripe during its own initialisation window

**Severity: critical.** Even after B1 is fixed, the surviving paywall can still take a Stripe payment on
an iPhone.

**What the reviewer will see.** They open `/settings/billing` and tap "Start your 14-day free trial"
quickly — faster than a round-trip to RevenueCat's servers on a cold start. Stripe checkout opens.

**Exact code path** — `src/components/pricing/sku-picker.tsx`:

```
const [native, setNative] = useState(false);          // line 53 — starts false

useEffect(() => {
  if (!isNativePlatform()) return;
  fetchNativeOfferings()
    .then((offerings) => { setNative(true); ... })     // line 63 — set true only after await
    .catch(() => setNative(true));
}, []);

const handleCheckout = async () => {
  if (native) { ... purchaseNativeSku ... }            // line 74
  const result = await startStripeCheckout(selected);  // line 85 — reached while native === false
```

`native` is the *result of a network call*, not a property of the device. Between mount and resolution —
which on a cold RevenueCat SDK start is comfortably long enough for a fast tapper, and indefinitely long
on a flaky connection — the CTA routes to Stripe on a native device.

**Fix.** Derive the branch from the platform, not from the fetch:

```ts
const native = isNativePlatform();   // synchronous, correct from the first render
```

Keep the async offerings fetch purely for populating localised price strings, and disable the CTA while
offerings are still loading. Then delete `startStripeCheckout` from this component's native path entirely
so the fallthrough cannot be reintroduced.

---

### B3 — Guideline 2.1(b) / 3.1.1: In-App Purchase is not actually configured, so no purchase can complete

**Severity: critical.** This turns B1/B2 from "wrong payment method" into "no payment method".

`src/lib/native/billing.ts:20-23` reads the RevenueCat keys from
`NEXT_PUBLIC_REVENUECAT_IOS_API_KEY` / `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY`. **Neither variable
appears in `.env.example` nor in `.env.local`**, and `docs/native-billing-setup.md` describes the entire
RevenueCat project, product, offering and webhook setup in the future tense — it is a to-do list, not a
record of work done.

Because these are `NEXT_PUBLIC_` variables they are inlined at **Vercel build time**, and because
`capacitor.config.ts` sets `server.url` to the live production site, the native app runs whatever Vercel
last built. If production was built without those keys, then on device:

1. `configureRevenueCat()` logs `[revenuecat] No API key configured` and returns (`billing.ts:44-47`);
2. `Purchases.getOfferings()` throws because the SDK was never configured;
3. `SkuPicker`'s `.catch(() => setNative(true))` fires — so `native` is true but `nativeOfferings` is `[]`;
4. `purchaseNativeSku()` finds no package and returns *"That plan isn't available right now."*
   (`billing.ts:83`).

The reviewer sees an app whose only advertised paid tier cannot be bought. Guideline 2.1(b): "If you offer
in-app purchases in your app, make sure they are complete, up-to-date, visible to the reviewer and
functional."

**Fix.** Complete every step of `docs/native-billing-setup.md`; create the three products in App Store
Connect; set both `NEXT_PUBLIC_REVENUECAT_*` keys in the Vercel production environment **and redeploy**
(the values are baked at build time — setting them without a rebuild changes nothing); apply
`supabase/migrations/026_native_billing_source.sql`; verify a sandbox purchase flips
`profiles.subscription_tier` before submitting. Add the RevenueCat keys to `.env.example` so this cannot
be forgotten again.

---

### B4 — Guideline 4.8 (Login Services): Google Sign-In is offered with no Sign in with Apple

**Severity: critical, and fully automated — reviewers catch this in seconds.**

`src/components/auth/auth-form.tsx:178-181` calls `supabase.auth.signInWithOAuth({ provider: "google" })`,
and `handleOAuth` is wired to a visible button on both the login and signup screens. Google Sign-In is a
third-party social login service used to establish the user's primary account. Guideline 4.8 therefore
requires an equivalent alternative login service that limits collection to name and email, lets the user
keep their email private, and does not collect in-app interactions for advertising. In practice that means
Sign in with Apple.

None of 4.8's exemptions applies: the app is not exclusively first-party sign-in (Google is there), it is
not an education/enterprise app, not a government ID system, and not a client for a specific third-party
service.

Email OTP sign-in existing alongside Google does **not** satisfy 4.8 — the required alternative must be a
login *service* with the three listed properties, and a self-hosted email code is not one.

**Fix.** Add Apple as a Supabase auth provider and add a "Sign in with Apple" button to
`src/components/auth/auth-form.tsx`, rendered with at least equal prominence to the Google button. On
native it will need the same in-app-browser treatment as Google (`src/lib/native/oauth.ts`) or, better,
native `ASAuthorizationAppleIDProvider` via a small Capacitor plugin. Also register the Apple Services ID
and return URL, and add the `com.apple.developer.applesignin` entitlement to
`ios/App/App/App.entitlements`.

---

### B5 — Guideline 1.2 (User-Generated Content): no way to report content or block a user

**Severity: critical.**

The app ships a social feed, squads, duels, friends, leaderboards, and public profiles at
`/social/profile/[username]` — `src/components/social/` contains `feed-panel.tsx`, `squads-panel.tsx`,
`duels-panel.tsx`, `friends-panel.tsx`, `leaderboard-panel.tsx`, `profile-view.tsx`, `user-avatar.tsx`.
Users choose their own usernames, display names, avatars and squad names, all of which are visible to
other users.

A full search of `src/` for `reportUser`, `blockUser`, "Report", "Block", "moderation" or "profanity"
returns **nothing** outside `src/lib/utils/username.ts`. `src/app/api/` has no moderation route. There is
no filtering of objectionable material, no report mechanism, and no block.

Guideline 1.2 requires all four of: a filter for objectionable material, a report mechanism with timely
response, the ability to block abusive users, and published contact information.

**Fix — all four are required, not a subset:**

1. Add a `blocked_users` table plus a "Block this athlete" action on
   `src/components/social/profile-view.tsx`; filter blocked users out of feed, leaderboards, squads and
   duels server-side, not client-side.
2. Add a "Report" action on the same profile view and on each feed item, posting to a new
   `src/app/api/social/report/route.ts`, with a documented human review path and a stated response time.
3. Add a profanity/objectionable-content filter to username, display name and squad name creation —
   `src/lib/utils/username.ts` is the natural home for the first two.
4. Publish a contact address on the marketing site and in the App Store listing.

---

### B6 — Missing `PrivacyInfo.xcprivacy` (Privacy Manifest)

**Severity: critical — this is an automated upload rejection (ITMS-91053), before a human ever sees it.**

`find ios -name "PrivacyInfo.xcprivacy"` returns nothing. Since 1 May 2024 Apple requires a privacy
manifest declaring collected data types and **required-reason API** usage, for the app and for every
third-party SDK on Apple's commonly-used SDK list. This app uses several of them.

**Fix.**

- Add `ios/App/App/PrivacyInfo.xcprivacy` to the App target, declaring:
  - `NSPrivacyCollectedDataTypes`: health & fitness, precise location, email address, name, user ID,
    purchase history, product interaction, crash/performance data — matching the App Privacy answers below.
  - `NSPrivacyAccessedAPITypes`: at minimum `NSPrivacyAccessedAPICategoryUserDefaults`
    (reason `CA92.1` — `@capacitor/preferences` and the App Group share store) and
    `NSPrivacyAccessedAPICategoryFileTimestamp` if any bundled SDK touches it.
  - `NSPrivacyTracking`: `false`, and an empty `NSPrivacyTrackingDomains`, unless anything changes.
- Add a separate manifest to the `SplitIndexWidgets` target.
- Confirm the RevenueCat SDK's own bundled manifest and signature ship inside the SPM/pod artefact; if
  RevenueCat is pinned to a version predating manifest support, upgrade it.

---

### B7 — Guideline 5.1.1(i) / 5.1.2: the privacy policy does not describe what the app actually collects

**Severity: critical.** 5.1.1(i) requires the policy to "identify what data, if any, the app/service
collects, how it collects that data, and all uses of that data."

`src/app/privacy/page.tsx` §2 lists account info, health/fitness logs, onboarding demographics, payment,
OAuth, social and technical data. What it **never mentions**:

| Collected by the app | Where | In the policy? |
|---|---|---|
| Precise GPS location + full route traces | `NSLocationWhenInUseUsageDescription`, `src/lib/native/gps-tracking.ts` | **No** |
| Background location while the phone is locked | `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: location` | **No** |
| Apple HealthKit heart-rate reads | `NSHealthShareUsageDescription`, `HeartRateWorkoutPlugin.swift` | **No** |
| HealthKit workout-session writes | `NSHealthUpdateUsageDescription` | **No** |
| Bluetooth device connections (HR straps, Concept2 PM5) | `NSBluetoothAlwaysUsageDescription`, `src/lib/native/pm5-monitor.ts` | **No** |
| Motion & step/cadence data | `NSMotionUsageDescription`, `StepCadencePlugin.swift` | **No** |
| RevenueCat as a payment processor | `src/lib/native/billing.ts` | **No** |
| Apple / Google as payment processors | native IAP | **No** |

Location traces are the most serious omission: a policy that is silent on background GPS while the
Info.plist asks for always-on location is exactly the mismatch that gets flagged under 5.1.2(i), and it
will also make the App Privacy nutrition label wrong (see checklist).

Two further 5.1.1(i) gaps: the policy must confirm that third parties provide equal protection of user
data, and it must explain retention/deletion and how to withdraw consent. Note also that the effective
date reads "July 2026", which will look stale at submission.

**Fix.** Rewrite `src/app/privacy/page.tsx` §2 and §5 to cover every row above, add RevenueCat, Apple and
Google to the processor list in §5, add an explicit "precise location and route data" paragraph covering
background collection, add the equal-protection confirmation, and refresh `EFFECTIVE_DATE`.

---

## LIKELY-REJECTION RISKS

Not certain rejections, but each is a realistic bounce and all are cheap to fix.

### R1 — Guideline 1.4.1 / 5.1.3: the plan screen no longer shows its own safety output. Say this plainly.

**This is the finding I would push hardest on, and it is as much a liability question as a review one.**

Commit `882a5a6` removed the "Read this first" and "Before you start" cards from
`src/components/hybrid-plan/hybrid-plan-screen.tsx` (lines 456-506 of the old file, now a comment block at
459-483). The safety engine behind them was **not** removed — `src/lib/scoring/hpe/safety.ts` still runs
first and still computes `advisories`, `warnings` and `referrals`, and the API still returns them. Nothing
on the generated-plan path renders any of them.

Reading the code, here is what that means in practice. An athlete answers **yes** to *"chest pain on
exertion"* or a positive PAR-Q+. `safety.ts:110-119` generates:

> "You have flagged chest pain on exertion, or a positive PAR-Q+. Please get this checked before you train
> hard — it is the one thing on this form worth a GP appointment this week…"

plus a `GP / sports physician` referral. On the plan screen, **none of that is displayed.** The referral
list is rendered only inside the refusal branch (`hybrid-plan-screen.tsx:348-359`), and — per the comment
at line 316-320 — "nothing about health reaches here any more." So the athlete who reported possible
cardiac symptoms receives a full training block with no visible warning attached to it.

The same is true of the pregnancy/postpartum advisory (`safety.ts:121-129`), the recent-surgery warning
(`safety.ts:150-155`), and the low-energy-availability warning that carries the eating-disorder helpline
referral (`safety.ts:206-217`). The plan still holds intensity down — `intensityCeiling` and
`rampMultiplier` are still applied — but the athlete is never told why, and never told to see anyone.

The only remaining surface is `src/components/hybrid-plan/intake-wizard.tsx:300-317`, whose
`healthAdvisory` renders at line 366 — but only while the athlete is on the `health` or `fuelling` section
of the form. It disappears the moment they advance, and it never appears on the plan they actually train
from.

**Why this is a review problem.** Guideline 1.4.1: "Apps should remind users to check with a doctor in
addition to using the app and before making medical decisions." An app that collects a cardiac symptom
screen, acts on the answer internally, and then shows a prescriptive training plan with no visible advice
to see a doctor is the fact pattern 1.4.1 exists for. `src/components/legal/score-disclaimer.tsx` is a
generic one-line footnote — it says scores "are not medical advice", which does not address a specific
red-flag answer the app has already collected.

**Why it is a liability problem regardless of Apple.** The app asked the question. Asking it creates the
expectation that the answer will be acted on visibly. Computing a referral and then suppressing it is a
worse position than never having screened at all — the record shows the system identified a possible
cardiac red flag and chose not to display it. I would not ship this.

**Recommended fix, and it need not undo the UX intent behind `882a5a6`.** The commit's stated grievance was
real: two full cards of caveat above the plan, firing on unanswered questions, because `injuryLast12Weeks`
and `surgeryLast6Months` default to `true` until answered. That is a defaulting bug, not an argument
against ever showing safety output. So:

1. Split `SafetyResult` into **red flags** (chest pain / PAR-Q+, pregnancy/postpartum, recent surgery, LEA
   with the helpline referral) and **programming notes** (injury dials, novice ramps, BMI, HR medication).
2. Render red flags on the plan screen, always, in a compact single-line banner with the referral —
   not a full card. Two lines, not two cards.
3. Let the programming notes stay hidden, or move them into the existing diagnostic report.
4. Fix the defaulting so an *unanswered* question never produces an assertion. `safety.ts:222-231` already
   models this correctly for the LEA screen (`leaScreenAnswered`); apply the same pattern to
   `injuryLast12Weeks` and `surgeryLast6Months`.

That gives back the clean plan screen the commit wanted, without the app silently swallowing a cardiac
referral it generated itself.

### R2 — Guideline 2.5.2: a fully remote-loaded WebView

`capacitor.config.ts` sets `server.url` to `https://www.splitindex.co.uk/login`. The shipped bundle is
`webDir: "public"` — essentially just `offline.html`. Every screen the reviewer sees comes off the network
and can change after approval without a new binary.

Apple approves Capacitor apps configured this way routinely, so this is a risk rather than a certainty,
and the strong native surface (below) is what keeps it on the right side of 4.2. But 2.5.2 says apps
"may not download, install, or execute code which introduces or changes features or functionality of the
app", and a reviewer who notices that the entire UI is remote may raise it — most likely in combination
with something else that already annoyed them.

**Mitigation:** disclose it explicitly in App Review Notes ("the app loads its interface from our
production web service; native GPS, Bluetooth, HealthKit, widgets and Live Activities run on device"), and
keep production stable during review. Do not ship a UI change mid-review.

### R3 — Guideline 4.2 (Minimum Functionality): defensible, but you must show your work

For the record, 4.2 is **satisfied**, and comfortably. The native surface a reviewer can reach:

- Background GPS tracking with an offline queue — `src/lib/native/gps-tracking.ts`,
  `src/lib/activities/offline-queue.ts`
- BLE heart-rate straps and Concept2 PM5 rowing ergs — `src/lib/native/heart-rate.ts`, `pm5-monitor.ts`
- HealthKit workout session to activate the AirPods Pro heart sensor — `HeartRateWorkoutPlugin.swift`
- CoreMotion step cadence — `StepCadencePlugin.swift`
- WidgetKit home-screen widgets — `SplitIndexWidgets/RacePredictionWidget.swift`, `DailyTrainingWidget.swift`
- Live Activities — `SplitIndexWidgetsLiveActivity.swift`, `LiveActivityPlugin.swift`
- App Group data sharing — `group.co.uk.splitindex.app`
- App Intents for a gym timer — `GymTimerIntents.swift`

The risk is only that a reviewer never finds any of it, because `server.url` drops them on `/login` and
the GPS/widget features sit behind sign-in. **Fix: spell all of it out in App Review Notes, with the exact
tap path to the GPS run screen, and attach a screen recording of a tracked run and a home-screen widget.**

### R4 — `bluetooth-central` background mode is not declared

`ios/App/App/Info.plist` declares `UIBackgroundModes` = `location`, `workout-processing`. It does **not**
declare `bluetooth-central`. But the app is designed to hold a BLE heart-rate strap connection through a
locked-screen run (`NSBluetoothAlwaysUsageDescription` says "during a session"; `src/lib/native/heart-rate.ts`
streams for the session's duration). Without `bluetooth-central`, iOS tears the connection down when the app
is suspended, so heart rate silently stops mid-run.

This is a functional defect a reviewer testing a locked-screen run would hit, and it lands under 2.1
("apps that … exhibit obvious technical problems"). **Fix:** add `bluetooth-central` to `UIBackgroundModes`
and be ready to justify it — Apple asks about this one.

### R5 — Guideline 5.1.1(v): account deletion works, but says nothing about the subscription

Account deletion **is** present and reachable, which is good: `src/app/(app)/settings/page.tsx:189-215`
behind a confirm dialog, calling `DELETE /api/account/delete`
(`src/app/api/account/delete/route.ts`), which purges 20 user tables plus friends, duels, squad membership
and finally the auth user. This satisfies 5.1.1(v).

Two gaps worth closing before submission:

- Apple's account-deletion guidance requires telling the user that deleting the account does **not** cancel
  an App Store subscription, and pointing them to Settings → Apple ID → Subscriptions. Add that to the
  confirm text at `settings/page.tsx:190-192`.
- The purge does not delete the RevenueCat subscriber or the Stripe customer. Add both to the deletion
  route so a deletion request is honoured end to end (this is a UK GDPR point as much as an Apple one).

### R6 — Guideline 2.3.1: synthetic placeholder data shown inside paywall teasers

`src/components/social/leaderboard-panel.tsx:38` (`PLACEHOLDER_DETAIL`) and
`src/components/analytics/analytics-client.tsx:73` (`PLACEHOLDER_PROJECTION`, rendered at line 396) show
invented numbers to free users behind a blur/tease. The intent is clear and the pattern is common, but a
reviewer who sees fabricated data rendered as if it were the user's own can read it as misleading under
2.3.1. **Fix:** label these unambiguously — "Example data" / "Sample projection" — on the visible surface,
not only in a code comment.

### R7 — Export compliance key absent

`ios/App/App/Info.plist` has no `ITSAppUsesNonExemptEncryption`. Not a rejection, but it makes App Store
Connect ask on every single upload. **Fix:** add `<key>ITSAppUsesNonExemptEncryption</key><false/>` (the
app uses only standard HTTPS, which is exempt).

### R8 — `UIRequiredDeviceCapabilities` is `armv7`

`Info.plist` declares `armv7`, a Capacitor default that has been wrong since 32-bit was dropped. Harmless
in practice but occasionally queried. **Fix:** change to `arm64`.

---

## PRE-SUBMISSION CHECKLIST

### Metadata

- [ ] App name, subtitle, promotional text, description — no placeholder strings
- [ ] Support URL and Marketing URL both resolve (Apple checks these)
- [ ] Privacy Policy URL → `https://www.splitindex.co.uk/privacy`, live and matching B7's rewrite
- [ ] Copyright, primary category (Health & Fitness), secondary category
- [ ] **Age rating: 17+.** The app has unmoderated user-generated content, a social feed, and unrestricted
      web access via the WebView. Do not answer 4+ — a mismatch here is its own rejection.
- [ ] Description must not mention Stripe, web pricing, or "subscribe on our website" (3.1.1(a))

### Screenshots and preview

- [ ] 6.9" and 6.5" iPhone screenshots (required sizes at time of writing); iPad only if you ship iPad
- [ ] Screenshots must show real in-app screens, not marketing mockups
- [ ] Consider an app preview video of a tracked GPS run — it directly answers 4.2

### Demo account (Guideline 2.1(a) — mandatory, the app is login-gated)

- [ ] Working email + password in App Review Notes, back end live
- [ ] The account must be **pre-populated** with logged activities. A fresh account shows empty
      dashboards, an unbuilt Hybrid Plan and no leaderboard position, and a reviewer looking at empty
      screens is a reviewer writing a 2.1 rejection.
- [ ] Pre-fill the HPE intake so `/hybrid-plan` renders a real block rather than "Not yet"
- [ ] Confirm the account is **not** premium, so the reviewer can test the IAP flow — and confirm the IAP
      products are in "Ready to Submit" state and attached to this version

### App Review Notes — write these, they matter more than usual here

- [ ] Explicit tap path to native GPS tracking: `+` button → Engine half → Run
- [ ] Explicit tap path to the widget and Live Activity, with a screen recording attached
- [ ] Statement that the UI is served from the production web service, with native GPS/BLE/HealthKit/
      widgets on device (mitigates R2)
- [ ] Statement of what each permission is for and where the reviewer will be prompted for it
- [ ] Statement that all purchases use In-App Purchase via RevenueCat

### App Privacy ("nutrition label") answers — must match B6 and B7 exactly

Declare as **collected and linked to the user**:

- [ ] Health & Fitness → Fitness (workouts, heart rate, cadence), Health (bodyweight, body fat, sex, age)
- [ ] Location → **Precise Location** (GPS route traces; background collection)
- [ ] Contact Info → Email Address, Name
- [ ] Identifiers → User ID
- [ ] Purchases → Purchase History
- [ ] Usage Data → Product Interaction
- [ ] Diagnostics → Crash Data, Performance Data (if any is collected)
- [ ] User Content → any free-text the social feed accepts
- [ ] **Tracking: No.** Confirm no SDK does cross-app tracking — if that stays true, no ATT prompt is needed.

Every one of these must be reflected in `PrivacyInfo.xcprivacy` and in the rewritten privacy policy.
A mismatch between the three is one of the most common causes of a second-round rejection.

### Export compliance

- [ ] Add `ITSAppUsesNonExemptEncryption = false` to `Info.plist` (R7)
- [ ] Answer "Does your app use encryption?" → uses exempt encryption only (standard HTTPS)
- [ ] No CCATS filing needed on that basis

### Build and signing

- [ ] Bump `MARKETING_VERSION` from `1.0` if 1.0 was ever uploaded
- [ ] `CURRENT_PROJECT_VERSION` must be unique per upload
- [ ] HealthKit, App Groups, Push (if used) and **Sign in with Apple** (B4) enabled on the App ID
- [ ] `com.apple.developer.healthkit.background-delivery` is declared in `App.entitlements` — confirm the
      app actually uses background delivery, or remove it. Unused entitlements draw questions.
- [ ] Widget extension signed with a matching provisioning profile
- [ ] Test on a physical device, cold launch, airplane mode (exercises `offline.html`), and locked-screen
      GPS + BLE

---

## GOOGLE PLAY

**Verdict: REJECTED**, but for a shorter and more mechanical list. Play's problems are mostly console
declarations rather than code, and B1–B3 apply here too with Google Play Billing in place of StoreKit.

### Play blockers

1. **Payments (Play Payments policy).** Same code paths as B1 and B2. `src/app/(app)/settings/page.tsx`
   sends an Android user to Stripe; `SkuPicker`'s async `native` flag has the same fallthrough. Digital
   subscriptions unlocking in-app features must use Google Play Billing. Same fixes.

2. **Play Billing not configured.** Same as B3 — `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY` is absent, and
   the three products do not exist in Play Console. `com.android.vending.BILLING` will be merged in by the
   RevenueCat plugin, but no product means no purchase.

3. **Foreground Service permission declaration (mandatory since August 2024).**
   `@capacitor-community/background-geolocation` merges
   `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` into the manifest. Play Console now requires a
   declaration for every foreground service type, including a description of the use case and **a video
   demonstrating it**. Without it the release is blocked at upload.

4. **Location permissions declaration + prominent disclosure.** The app collects location in the
   background during a tracked run. Play requires the Location Permissions declaration form, a documented
   core-feature justification, a demo video, and an in-app **prominent disclosure dialog shown before the
   OS permission prompt**, in the app's own UI. I found no such disclosure screen in `src/` — the app goes
   straight to the system prompt. This must be built.

5. **Data safety form.** Same substance as the App Privacy label, and subject to the same B7 problem: the
   privacy policy does not mention location, health, Bluetooth or motion data, so the form and the policy
   will contradict each other. Fix the policy first.

6. **User-generated content policy.** Same as B5 — Play requires in-app reporting and blocking for social
   features, plus a moderation policy. Play enforces this at least as strictly as Apple.

7. **Health apps policy.** The R1 finding applies with equal force. Play's Health content policy expects
   apps giving training prescriptions to display appropriate disclaimers and not suppress safety
   information the app itself generated.

### Play items that are already fine

- `targetSdkVersion 36` (`android/variables.gradle:4`) — meets the current target API requirement
- `applicationId co.uk.splitindex.app`, `versionCode 2`, `versionName "1.0"` — well formed
- The OAuth deep-link intent filter in `AndroidManifest.xml` is correctly scoped
- `android:allowBackup="true"` is the default; consider `false` given the health data, though it is not a
  policy blocker

### Play pre-submission checklist

- [ ] Store listing: title, short and full description, feature graphic, phone + tablet screenshots
- [ ] Content rating questionnaire — declare user interaction and UGC
- [ ] Data safety form matching the rewritten privacy policy
- [ ] Foreground service and background location declarations, each with its demo video
- [ ] Target audience and content: 18+ given the UGC and health content
- [ ] App access instructions with the same pre-populated demo account
- [ ] Internal testing track purchase verified before promoting to production

---

## SUMMARY OF FILES TO CHANGE

| Blocker | File |
|---|---|
| B1 | `src/app/(app)/settings/page.tsx` (remove inline paywall + `handleCheckout`) |
| B2 | `src/components/pricing/sku-picker.tsx` (make `native` synchronous) |
| B3 | Vercel env + App Store Connect / Play Console products; `.env.example`; `supabase/migrations/026_native_billing_source.sql` |
| B4 | `src/components/auth/auth-form.tsx`; `ios/App/App/App.entitlements`; Supabase auth config |
| B5 | `src/components/social/profile-view.tsx`, `feed-panel.tsx`; new `src/app/api/social/report/route.ts`; `src/lib/utils/username.ts`; new `blocked_users` migration |
| B6 | new `ios/App/App/PrivacyInfo.xcprivacy`; new `ios/App/SplitIndexWidgets/PrivacyInfo.xcprivacy` |
| B7 | `src/app/privacy/page.tsx` |
| R1 | `src/components/hybrid-plan/hybrid-plan-screen.tsx`; `src/lib/scoring/hpe/safety.ts` |
| R4, R7, R8 | `ios/App/App/Info.plist` |
| R5 | `src/app/(app)/settings/page.tsx`; `src/app/api/account/delete/route.ts` |
| R6 | `src/components/social/leaderboard-panel.tsx`; `src/components/analytics/analytics-client.tsx` |
