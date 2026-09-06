# Native platform & resilience review

Scope: everything that behaves differently on a real phone than in a browser tab —
lifecycle, permissions, offline/flaky network, device variation, build & ship,
performance. Read against `hybrid-plan-engine` @ `adb35c5`.

Method: source reading; `npx next build` for bundle numbers; iOS Simulator attached
(iPhone 17, 402x874) for coordinate/permission sanity. No source file was modified.

Severity key — **S1** ships data loss or blocks review · **S2** athlete-visible
failure with no recovery path · **S3** degraded/misleading · **S4** polish.

---

## The headline

Two things dominate everything below and should be read first.

1. **The native app is a WebView pointed at a remote URL.** `capacitor.config.ts:31`
   sets `server.url = "https://www.splitindex.co.uk/login"`. There is no bundled
   static export, no service worker, and no read cache of any kind. Every screen in
   the app requires a live network round trip to Vercel. This is a deliberate,
   well-documented decision (the config explains why), but it is the root cause of
   most of section 3 and it carries an App Store review risk that is not written
   down anywhere in the repo. See §5.1.

2. **A finished GPS run lives only in React memory.** Between pressing Stop and the
   POST succeeding, the run exists in exactly one place: component state. The
   persisted copy has already been deleted, and the save path has no offline queue.
   See §1.1 and §1.2 — this is the worst data-loss risk in the app.

---

## 1. Lifecycle

The GPS persistence design (`src/lib/native/gps-tracking.ts`) is genuinely good.
`withSessionLock` (line 85), the pause bookkeeping, `recoverOrphanedSession`'s
`resumable` flag and `rejoinGpsSession` all exist for real, reproduced bugs and the
reasoning is sound. The defects below are the seams around it.

### 1.1 — S1 — A finished run is unrecoverable until it is saved

`src/app/(app)/cardio/gps-run/page.tsx:565-570`

```
const result = await stopGpsSession();   // ← clears Preferences (gps-tracking.ts:249-253)
...
setSummary(result);                      // ← React state
setPhase("reviewing");                   // ← athlete now picks sport / session type
```

`stopGpsSession` calls `clearSession()`, removing `gps-tracking-session` from
Preferences. From that instant the run's summary, its `livePoints`, its `hrReadings`,
its `segments` and its `cadenceReadings` exist only in component state. The review
screen is not a modal — it is where the athlete chooses sport and session type, reads
the prediction ladder, and decides. That can be minutes.

**Scenario.** Two-hour marathon. App has been backgrounded for the whole run, so iOS
has it flagged as a prime reclaim candidate and the battery is low. Athlete presses
Stop, sees the review screen, locks the phone and walks to the car. iOS discards the
WKWebView (the exact teardown `last-route.ts:22-30` documents as routine). Athlete
reopens: `recoverOrphanedSession()` finds nothing, because `stopGpsSession` deleted
it. The run is gone. There is no trace of it anywhere — not in Preferences, not in
localStorage, not on the server.

The irony is that the *interrupted* case is handled beautifully and the *completed*
case is not.

**Fix shape:** don't clear the session in `stopGpsSession`; write a
`status: "awaiting-save"` record instead, and clear it only after the POST returns
2xx. `recoverOrphanedSession` then surfaces it the same way it surfaces an orphan.

### 1.2 — S1 — The GPS save path bypasses the offline queue entirely

`src/app/(app)/cardio/gps-run/page.tsx:667`

```
const res = await fetch("/api/activities", { method: "POST", ... });
```

A raw `fetch`. Every other write in the app goes through
`submitActivityRequest` (`src/lib/activities/submit-activity.ts:12`), which catches
network failure and enqueues to localStorage. This one does not. On failure the
`catch` at line 692 sets `"Could not save this run. Please try again."` and stops.

**Scenario.** Finish line of a rural trail race, no signal — precisely the situation
`public/offline.html:9-11` says the app was built to survive. Athlete presses Stop,
presses Save, gets "please try again". Combined with §1.1 the run is one WebView
reclaim away from permanent loss, and there is nothing on screen telling them that.

**Fix shape:** route it through `submitActivityRequest`. It already returns a
`queued: true` variant.

### 1.3 — S1 — `offline-track.html` destroys an in-progress run

`public/offline-track.html:336-338`

```
startedAt = Date.now();
points = [];
await persistSession();      // writes {points: [], ...} to gps-tracking-session
```

Unconditional. It never reads the existing session first. Contrast
`startGpsSession` (`gps-tracking.ts:104-107`), whose doc comment says callers are
expected to have resolved an orphan before calling it — the gps-run page does; this
page does not.

**Scenario.** Athlete is 40 minutes into a run. Signal drops, the WebView fails a
navigation and Capacitor swaps in `errorPath` → `offline.html`. They see the button
"Start tracking a run offline →", tap it, tap Start — and the 40 minutes of fixes
sitting in Preferences are overwritten with an empty array. There is no warning and
no undo.

It also never removes the existing `gps-tracking-watcher-id`, leaving an orphaned
native watcher burning battery alongside the new one.

**Fix shape:** read `gps-tracking-session` on load; if it holds points, show
"Resume the run already recording" rather than a bare Start.

### 1.4 — S2 — The draft autosave has no local fallback

`src/components/activities/use-autosave.ts:39` — the only persistence is
`PUT /api/activities/draft`, which upserts to the `workout_drafts` Supabase table
(`src/app/api/activities/draft/route.ts:16-28`). There is no localStorage or
Preferences mirror.

Offline, `persist` throws, `setStatus("error")` fires, and the half-typed form is
persisted nowhere. Kill the app and every logged set is gone. The `retry` affordance
(line 100) re-attempts the same network call, so it cannot help offline.

This directly contradicts `gym-workout-timer.tsx:24-25`, which justifies using
sessionStorage for the timer on the grounds that "workout_drafts already covers the
actual logged sets across a real relaunch" — true online, false offline.

### 1.5 — S2 — The gym timer does not survive an app kill

`src/components/activities/gym-workout-timer.tsx:27,40,182` — state goes to
`sessionStorage`, which is destroyed when the WKWebView/JS context is destroyed.

On iOS the resync effect (line 244-273) rescues this by adopting whatever Live
Activity is still running. **On Android there is no Live Activity** —
`isLiveActivitySupported()` returns false for anything but iOS
(`live-activity.ts:86-88`) — so an Android athlete who backgrounds the app mid-workout
comes back to a 0:00 timer with no elapsed time and no rest countdown, and no
notification told them it was still running.

Even on iOS, the Live Activity only exists if the athlete pressed Play at least once
*and* Live Activities are enabled in Settings; a rest countdown started without the
stopwatch running is lost.

### 1.6 — S2 — Rejoin recovers the route but silently drops everything else

`src/app/(app)/cardio/gps-run/page.tsx:455-485`

`rejoinGpsSession` restores points, pauses and `startedAt`. It does not restore:

- `hrReadings` — React state only, never persisted. A rejoined run's `avgHr` is
  computed from post-rejoin readings only, so a 90-minute run interrupted at minute 80
  reports the average heart rate of its last 10 minutes as the average for the whole
  session. That is a scoring input, and the number looks entirely plausible.
- `segments` — acknowledged in the code (line 469-471), reset to `[]`. An interval
  session loses every rep boundary before the interruption.
- `cadenceReadings` — same, unacknowledged.
- **The BLE heart-rate monitor connection.** `handleRejoin` restarts step cadence
  (line 462) but never reconnects the strap. `connectedDeviceId`
  (`heart-rate.ts:35`) is module state and is gone; `hrSource` is null, so the HUD
  shows no HR and `handleStop`'s `if (hrSource)` teardown (line 566) never runs,
  leaving the BLE connection open.

`hrReadings` is the one that produces wrong data rather than missing data, which
makes it the worst of the four.

### 1.7 — S2 — The queued-submit branch leaves the form armed for a duplicate

`src/components/activities/activity-form.tsx:461-464`

```
if (result.queued) {
  setSubmitError(result.message);
  return;
}
```

Early return. The draft is not cleared, the gym Live Activity is not ended, the timer
state is not cleared, and the Save button is re-enabled by the `finally`. The message
is rendered through the *error* channel. An athlete who reads "saved on this device"
as a failure and taps Save again gets a **second queue entry** —
`enqueueActivitySubmit` (`offline-queue.ts:33`) generates a fresh id every time and
there is no dedup. Both flush on reconnect. Two identical workouts, both scored.

### 1.8 — S3 — Nothing in the app listens for app lifecycle or the Android back button

`@capacitor/app` is imported in exactly one place, `src/lib/native/oauth.ts:2`, and
only for `appUrlOpen`. There is no `App.addListener("appStateChange", ...)` and no
`backButton` listener anywhere in `src/`.

Consequences:

- Nothing flushes the offline queue on resume — only `ClientBootstrap`'s mount and
  the `online` event (`client-bootstrap.tsx:17-24`). A phone that regains signal while
  the app is backgrounded does not fire `online` on resume in WKWebView reliably.
- Android's hardware back button falls through to Capacitor's default. The GPS
  tracking HUD is a `createPortal` overlay, not a route (line 745), so back navigates
  away from `/cardio/gps-run` and unmounts the HUD mid-run; on the first history entry
  it exits the app outright. The native watcher keeps recording and
  `recoverOrphanedSession` can pick it up, but the athlete sees their run screen
  vanish with no explanation and the Live Activity keeps running.

### 1.9 — S3 — Purchase completion races the RevenueCat webhook

`src/components/pricing/sku-picker.tsx:75-79` — on `result.ok`, `window.location.reload()`.

`purchaseNativeSku` resolves as soon as StoreKit finishes
(`billing.ts:88`). Entitlement reaches `profiles.subscription_tier` only via the
RevenueCat webhook (`/api/revenuecat/webhook`), asynchronously. The reload almost
certainly renders the pre-purchase tier. The athlete has paid and the app looks
unchanged — the classic refund-and-one-star sequence. Nothing polls
`Purchases.getCustomerInfo()` or applies an optimistic entitlement.

An app killed mid-purchase is fine: StoreKit finishes the transaction and the webhook
fires regardless.

### 1.10 — S3 — `configureRevenueCat` cannot handle a user switch

`billing.ts:32-52` — `configuredForUserId` guards re-configuration, and the only call
is `Purchases.configure`. RevenueCat requires `logIn`/`logOut` to change identity.
Sign out, sign in as a different account on the same device, and the second user's
purchases attach to the first user's `appUserID`.

---

## 2. Permissions

### 2.1 — S1 — No `bluetooth-central` background mode

`ios/App/App/Info.plist` declares `UIBackgroundModes: [location, workout-processing]`.
It does **not** declare `bluetooth-central`.

Without it, iOS suspends Core Bluetooth delivery when the app is backgrounded. So the
one scenario the whole feature is built for — start a run, lock the phone, put it away
(`gps-run/page.tsx:110-114`) — is exactly the scenario where the chest strap stops
delivering. `startNotifications` (`heart-rate.ts:63`) goes quiet, `hrReadings` stops
growing, and the saved run's average HR reflects only the seconds the screen was on.
No error is raised anywhere; the run just scores as if the athlete had no monitor.

### 2.2 — S2 — `workout-processing` is a watchOS background mode

Same file. `workout-processing` is not a valid iOS `UIBackgroundModes` value (it is
watchOS-only; the iOS set is `audio`, `location`, `voip`, `external-accessory`,
`bluetooth-central`, `bluetooth-peripheral`, `fetch`, `remote-notification`,
`processing`, `push-to-talk`, `nearby-interaction`). It does nothing at runtime and it
is the kind of thing App Review asks about. Whatever it was meant to enable — keeping
the `HKWorkoutSession` alive for AirPods HR — is not what it does.

### 2.3 — S2 — There is no denial path for location at all

`startGpsSession` → `attachWatcher` (`gps-tracking.ts:125`) passes
`requestPermissions: true` and hands the plugin a callback. A denial arrives as
`error.code === "NOT_AUTHORIZED"` inside that callback (line 134), which sets
`permissionRevoked: true` in storage and **returns silently**.

Meanwhile `handleStart` (`gps-run/page.tsx:406-427`) has already run to completion:
`setPhase("tracking")`, Live Activity started, HUD on screen. `addWatcher` resolves
with a watcher id whether or not permission was granted.

**Scenario.** Athlete taps Start, taps "Don't Allow". They get a full-screen tracking
HUD, a ticking clock, a Live Activity on the lock screen, and 0.00 km forever. Nothing
ever tells them why. When they eventually stop, `summarizeGpsTrack` flags the session
`permissionRevoked` — which is the first and only signal, and it arrives after the run.

The same applies to a later revocation mid-run. `permissionRevoked` is written to
storage but the running HUD never reads it, so the athlete keeps running against a
frozen distance.

### 2.4 — S2 — "While Using" vs "Always" / "Allow Once" is never considered

Nothing in `src/` calls `checkPermissions`, requests Always authorization, or
distinguishes the grant levels. Background tracking works on the When-In-Use grant
because of the `location` background mode plus an active watcher, so the common case
is fine — but:

- **"Allow Once"** grants for the current app session only. It survives the run, then
  dies. A rejoined session (`rejoinGpsSession`, line 194) after an app relaunch calls
  `attachWatcher` again, which re-prompts or silently fails depending on state — and
  §2.3 means a silent failure looks identical to tracking.
- `NSLocationAlwaysAndWhenInUseUsageDescription` is present and promises background
  tracking, but the app never asks for Always, so the string is never shown. Not a
  rejection risk, but it is dead copy.

### 2.5 — S3 — Bluetooth and motion have no denial or revocation handling

- **Bluetooth.** `connectHeartRateMonitor` (`heart-rate.ts:48`) has no permission
  check; `BleClient.initialize()` throws on denial and the page's `catch`
  (`gps-run/page.tsx:372`) shows "Couldn't connect — make sure the monitor is on and
  in pairing range." That is the wrong message for a permission denial and sends the
  athlete to check their strap rather than Settings. Bluetooth turned off entirely
  produces the same message.
- **Motion.** `startStepCadence` failures are swallowed by `.catch(() => {})`
  (`gps-run/page.tsx:417`). Deliberate and defensible — the code comment says so — but
  it means "Motion & Fitness denied" and "device has no coprocessor" are
  indistinguishable and neither is ever surfaced. The cadence tile just never appears.
- **Revocation later.** Only GPS has a revocation signal. A strap disconnect sets
  `connectedDeviceId = null` (`heart-rate.ts:58-60`) but nothing in the UI reads
  `isHeartRateMonitorConnected()`, so the HUD keeps showing the last BPM indefinitely.

### 2.6 — S3 — Android: POST_NOTIFICATIONS is declared but never requested

`android/app/src/main/AndroidManifest.xml` declares only `INTERNET`. Everything else
merges in from plugin manifests, which is correct and sufficient:
background-geolocation supplies `ACCESS_FINE/COARSE_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION` and `POST_NOTIFICATIONS`; bluetooth-le supplies
`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`.

But on Android 13+ `POST_NOTIFICATIONS` is a runtime permission and nothing in the app
requests it. The plugin's foreground-service notification — the only thing telling an
Android athlete their run is still recording — is silently suppressed until they grant
it from Settings. Combined with §1.5 (no Live Activity on Android), an Android athlete
mid-session has no system-level indication anything is running.

`ACCESS_BACKGROUND_LOCATION` is genuinely not needed here (the foreground service is
started from the foreground), so its absence is correct.

### 2.7 — S4 — Info.plist strings vs. actual behaviour

Checked each against what the code does. All accurate:

| Key | Verdict |
|---|---|
| `NSLocationWhenInUseUsageDescription` | Accurate. |
| `NSLocationAlwaysAndWhenInUse…` | Accurate but never shown (§2.4). |
| `NSBluetoothAlwaysUsageDescription` | Accurate — names Garmin/Polar/Concept2, matches `heart-rate.ts` + `pm5-monitor.ts`. |
| `NSHealthShareUsageDescription` | Accurate — `HeartRateWorkoutPlugin` reads HR. |
| `NSHealthUpdateUsageDescription` | Accurate, and unusually honest ("the workout itself isn't saved to Health"). |
| `NSMotionUsageDescription` | Accurate — `StepCadencePlugin` counts steps. |

No unused permission strings, which is the usual App Review trap. Good.

---

## 3. Offline and flaky network

### 3.1 — S1 — There is no offline read cache. At all.

No service worker, no `manifest.json`, no cache API usage anywhere in `src/` or
`public/`. Combined with `server.url` (§5.1), the offline story is:

| Screen | With no connection |
|---|---|
| Cold launch | `offline.html` via `errorPath`. Retry button + a link to offline GPS tracking. |
| Dashboard | Server-rendered (`ƒ` in the build output). Blank/error. |
| Any `ƒ` route via client nav | Router fetch fails → `src/app/error.tsx` "We hit an error". |
| `/cardio/gps-run` | Statically prerendered (`○`), so it *renders* — but its profile fetch and its save both fail. |
| Mid-log form | Renders if already loaded; draft autosave fails silently (§1.4). |
| Submit (manual log) | Queued to localStorage. Works. |
| Submit (GPS run) | Fails outright (§1.2). |
| Plan screen | Server-rendered. Unavailable. |

The one genuinely good piece is `offline-track.html`, which is a real offline GPS
recorder with a live projected polyline and no build step. It is undermined by §1.3.

### 3.2 — S2 — No fetch has a timeout

`AbortController` appears exactly twice in `src/`, both server-side weather helpers
(`src/lib/external/open-meteo.ts:18`, `src/lib/weather/fetch-temperature.ts:19`).
Every client fetch — the activity submit, the draft autosave, the queue flush, the
Stripe checkout, the Supabase calls — has no timeout.

**Scenario (flaky, not offline).** One bar of signal, or a hotel captive portal that
accepts the TCP connection and never responds. `navigator.onLine` is `true`. The fetch
in `submitActivityRequest` (`submit-activity.ts:18`) neither resolves nor rejects for
up to WKWebView's default ~60s. The Save button spins. The offline-queue branch at
line 29 is never reached, because that branch only runs on a *rejection*. The athlete
watches a spinner for a minute and then gets a generic error, with nothing queued.

This is the single highest-leverage fix in this section: an `AbortSignal.timeout(~12s)`
on `submitActivityRequest` converts a hang into a queued save.

### 3.3 — S2 — A queued item that fails on a non-network error is stuck forever

`src/lib/activities/offline-queue.ts:70-73`

```
if (!res.ok) { failed += 1; continue; }
```

Any non-2xx — 400 validation, 401 expired session, 500 — increments `failed` and
leaves the item in localStorage. There is no attempt counter, no expiry, and no
poison-queue handling. It will be retried on every `online` event and every app mount,
forever, and the athlete is never told. A queued workout that the server will never
accept is indistinguishable, to the user, from one that simply hasn't synced yet.

A 401 is the realistic case: the Supabase session expires while the phone is offline,
the flush fires on reconnect, every item 401s, and the workouts sit there silently.

### 3.4 — S2 — No idempotency key on queued submits

`enqueueActivitySubmit` stores `{url, method, payload}` and `flushActivityQueue`
replays it verbatim. If a POST reached the server and was processed but the response
was lost (§3.2's exact failure mode — connection dies after the request), the item
stays queued and creates a duplicate activity on the next flush. Both get scored.

### 3.5 — S2 — Pending queued workouts are invisible

`getPendingActivityCount` (`offline-queue.ts:29`) is exported from `offline-queue.ts`,
re-exported from `submit-activity.ts:47`, and has **zero call sites** in the app. There
is no badge, no banner, no settings row. An athlete with three unsynced workouts and a
permanently-failing queue (§3.3) has no way to discover it.

There is also no offline indicator anywhere in `app-shell.tsx`.

### 3.6 — S3 — `offline.html` tells the athlete something untrue

`public/offline.html:117`: *"Already tracking a run? GPS keeps recording in the
background even with the app screen showing this — you won't lose your data."*

The `errorPath` page is shown because a navigation failed, which means the WebView
loaded a new document, which means the JS context that owned the watcher callback
(`gps-tracking.ts:132`) is gone. The native watcher may still be alive, but its
callback can never fire again, so no further fixes are persisted. Everything recorded
*before* the swap is safe; everything after is lost. The reassurance is half true and
reads as fully true.

### 3.7 — S3 — `offline-track.html` under-records the session

- Never sets `permissionRevoked: true`. The `NOT_AUTHORIZED` branch (line 350-352)
  only writes to `statusEl`. A run recorded offline with location denied comes back
  through `recoverOrphanedSession` flagged clean and `resumable`.
- Never writes `pauses` (no pause UI), which `readSession` tolerates
  (`gps-tracking.ts:49`).
- `persistSession()` at line 363 is called without `await` and without the
  `withSessionLock` serialisation that `gps-tracking.ts:83-94` exists to provide.
  Because `points.push` happens synchronously first, each write carries the full
  array, so this self-heals on the next fix — but out-of-order bridge completion can
  lose the final fix of a session.

---

## 4. Device variation

### 4.1 — S2 — Dynamic Type has no effect whatsoever

238 hardcoded `text-[Npx]` utilities across `src/`, many at 10px and 11px, plus fixed
`font-size` declarations in `globals.css` (lines 206, 214, 237, 420, 438, 619). There
is no `text-size-adjust` and no use of the `-apple-system-body` font keyword, which is
the only way WKWebView content responds to iOS Dynamic Type.

An athlete with Larger Accessibility Sizes turned on gets exactly the same 10px
micro-labels as everyone else. For a fitness app read at arm's length mid-set, and for
an audience that skews older than the average consumer app, this is a real
accessibility gap — and it is the kind of thing that gets flagged.

Pinch-zoom is *not* blocked (`src/app/layout.tsx:61-65` sets no `maximumScale` or
`userScalable`), so there is an escape hatch. Good.

### 4.2 — S3 — The app is dark-only; `[data-mode]` is orthogonal to system theme

`globals.css:96` sets `color-scheme: dark` and there is no `prefers-color-scheme`
block anywhere. `[data-mode]` (`app-shell.tsx:149`) is *zone* theming — gym/cardio —
not light/dark. An iOS user in Light Mode gets a dark app. That is a legitimate design
choice, and `StatusBar.style: "DARK"` in `capacitor.config.ts` is correct for it
(Capacitor's `Dark` means light text on a dark background — verified against
`@capacitor/status-bar/dist/esm/definitions.d.ts:48-52`).

The cost shows up in `globals.css:293-328`, where `[data-mode="cardio"] .mode-content`
blanket-remaps every `border-white` / `bg-white` / `text-white` utility found in its
subtree. That is why the GPS tracking HUD has to escape to `document.body` via
`createPortal` (`gps-run/page.tsx:743-745`) — the remap was flattening it to
near-invisible. It works, but any future full-bleed dark surface inside a cardio route
will hit the same trap and the failure mode is "unreadable", not "broken".

### 4.3 — S3 — Live Activities vs the iOS 15 deployment target

App target `IPHONEOS_DEPLOYMENT_TARGET = 15.0`; widget target `16.2`. Live Activities
need 16.1+. `isLiveActivitySupported()` (`live-activity.ts:86-88`) only checks
`platform === "ios"` and relies entirely on the native `isAvailable()` guard. That is
probably fine, but it means every gym-timer start on an iOS 15 device makes a
round-trip to a plugin that will always say no, and the gym timer's persistence has no
fallback there (§1.5).

### 4.4 — S3 — 2-hour GPS session: O(n²) persistence and 1 Hz full-array recompute

Two compounding costs, both acknowledged in comments but neither bounded:

- **Storage.** Every accepted fix reads the whole session, appends one point, and
  writes the whole thing back (`gps-tracking.ts:156-161`). `gps-tracking.ts:78-80`
  says it: *"a long run serializes hundreds of kilobytes on every single fix"*. At
  10m `distanceFilter` a 2h run is roughly 1,000–1,500 points; the final writes
  serialise the entire array through the Capacitor bridge on every fix.
- **Main thread.** The 1 Hz tick (`gps-run/page.tsx:239-250`) plus each new point
  invalidates `liveDistanceMeters` (full-array `trackDistanceMeters`), `movingPoints`
  (full-array filter), `liveElevationGainMeters`, the `currentPaceSecondsPerKm`
  walk-back loop, and `livePrediction`. All O(n) over the whole track, every second,
  on the main thread, for two hours — while Leaflet redraws the polyline.

In Low Power Mode iOS throttles timers and background CPU; the clock self-corrects
from wall time (good design), but the map and stats will visibly lag late in a long
run.

### 4.5 — S4 — Small screens

Checked the tightest surface, the gym log. `gym-workout-timer.tsx:377-398` documents a
measured 88px two-row banner (down from 181px) on a 375x812 layout, with the rest
presets in a fixed-height non-wrapping scroll strip so the row height is constant. The
GPS HUD has explicit `landscape:` variants (`gps-run/page.tsx:746,772`). Safe-area
insets are handled consistently via `max()`/`calc()` with `viewport-fit: cover`
(`layout.tsx:64`). This area is in good shape; iPhone SE at 375x667 loses ~145px of
vertical space vs the 812 the timer was measured against, which is worth one manual
pass but no defect is visible from the source.

---

## 5. Build and ship

### 5.1 — S1 — The native build loads a remote URL, not a bundled export

Saying this loudly, as asked.

`capacitor.config.ts:31`:

```
url: "https://www.splitindex.co.uk/login",
```

`webDir: "public"` — so the bundle contains `public/` only (icons, avatars,
`offline.html`, `offline-track.html`, `vendor/capacitor-core.js`). There is no
`next export`, no app code, no routes. The shipped binary is a WebView and two static
fallback pages.

**What this changes:**

1. **App Store review.** Guideline 4.2 (Minimum Functionality) explicitly targets apps
   that are "simply a song or movie... or a repackaged website". This app has a real
   defence — background GPS via a native plugin, HealthKit, Core Bluetooth, a WidgetKit
   extension, Live Activities, StoreKit via RevenueCat — and that defence should be
   written into the review notes rather than left for the reviewer to discover. The
   risk is real but manageable. **A reviewer who opens the app with a throttled
   connection and sees `offline.html` will form the wrong impression fast.**
2. **Offline.** Everything in §3.1 follows from this.
3. **Version skew.** The deployed JS is always newer than the binary. `daily-training.ts:29-35`
   already reasons about this correctly for the widget payload ("ADDITIVE ONLY"), which
   is the right instinct — but nothing enforces it. There is no version handshake
   between the web app and the native shell, so a JS deploy that calls a plugin method
   an older binary doesn't implement fails at runtime on installed devices.
4. **Availability.** A Vercel incident bricks the app entirely, including for athletes
   mid-session, rather than degrading it.

### 5.2 — S2 — `Permissions-Policy: geolocation=()` is a live trap

`next.config.ts` sets `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
on every route.

Native tracking is unaffected — `@capacitor-community/background-geolocation` is a
plugin, not the web Geolocation API — and `offline-track.html` is served from the
bundle so no Next.js header applies to it. So nothing is broken *today*. But any future
use of `navigator.geolocation` (a web fallback for browser users, a "locate me" button
on the map) will fail silently, and the failure will look like a permission problem
rather than a header.

### 5.3 — S3 — The SPM patch is postinstall-only

`scripts/patch-capacitor-spm.mjs` widens background-geolocation's
`capacitor-swift-pm` pin from `7.0.0..<8.0.0` to `..<9.0.0` so SwiftPM can resolve
against RevenueCat's `8.0.0..<9.0.0`. The reasoning and the failure mode ("Missing
package product 'CapApp-SPM'") are documented well.

It runs from `postinstall`. Any CI or release pipeline using `npm ci --ignore-scripts`
— a common hardening default — skips it silently and the iOS build fails with the
opaque Xcode error the script exists to prevent. Worth either a check in the iOS build
script or a note in the release runbook.

### 5.4 — S3 — `vendor/capacitor-core.js` is a manual copy with no drift check

`public/offline-track.html:163` — *"a straight copy of
node_modules/@capacitor/core/dist/capacitor.js (re-copy after any @capacitor/core
version bump)"*. Nothing enforces it. A `@capacitor/core` bump silently leaves the
offline tracking page on an older bridge; the failure surfaces only as
`getPlugin()` pushing to `debugLog` and the athlete seeing "Couldn't reach GPS on this
device" at a race with no signal. A one-line CI diff would close this.

### 5.5 — S4 — Xcode / plist leftovers

- `Info.plist` `UIRequiredDeviceCapabilities: [armv7]` — stock Capacitor template
  leftover. armv7 is 32-bit; the store is 64-bit only. Harmless in practice, wrong in
  principle.
- No `ITSAppUsesNonExemptEncryption` → a manual export-compliance answer on every
  TestFlight upload.
- Widget target `INFOPLIST_KEY_CFBundleDisplayName = SplitIndexWidgets` — that string
  is what appears in the widget gallery. Should be "Split Index".

### 5.6 — Widget extension and App Group: correct

Verified end to end, and this is the cleanest native work in the repo:

- Both entitlements files declare `group.co.uk.splitindex.app`
  (`App.entitlements`, `SplitIndexWidgets.entitlements`).
- Both stores hardcode the same identifier
  (`DailyTrainingStore.swift:162`, `RacePredictionStore.swift:151`) and — importantly —
  both probe with `containerURL(forSecurityApplicationGroupIdentifier:)` rather than
  trusting `UserDefaults(suiteName:)`, which returns a non-nil object even when the
  entitlement is missing. `RacePredictionStore.swift:171` calls this out explicitly.
- Both plugins surface a `disconnected` reason that the sync components log
  (`daily-training-sync.tsx:33-38`, `race-predictions-sync.tsx:42-47`).
- Versions match across targets: `MARKETING_VERSION = 1.0`,
  `CURRENT_PROJECT_VERSION = 2` in both app and widget. No upload rejection here.
- Local plugins are explicitly registered in `MainViewController.capacitorDidLoad()`
  rather than relying on ObjC auto-discovery, with the dead-stripping rationale in a
  comment. Correct.

---

## 6. Performance

### 6.1 — S2 — Dashboard: six sequential network round trips, one of them a write

`src/app/(app)/dashboard/page.tsx`. The waterfall:

| Line | Await | Note |
|---|---|---|
| 119 | `supabase.auth.getUser()` | |
| 123 | `profiles` select | blocked on the above |
| 166 | `Promise.all([...])` | 10 queries — batched, good |
| 257 | `Promise.all([...])` | 5 queries — batched, good |
| 407 | `seedRetentionNotifications(...)` | **a write, in the render path** |
| 566 | `getGlobalRankPercentile(...)` | |
| 571 | `getNextRankTarget(...)` | sequential with the above for no reason |

The two `Promise.all` batches are well done. The problem is the four serial hops
around them. Lines 566 and 571 are independent and trivially `Promise.all`-able. Line
407 is a database *write* on every dashboard load, blocking TTFB — it belongs after the
response, or in a route handler.

On the native app this waterfall is paid over cellular on every cold launch, because
`server.url` lands on `/login` → `/dashboard` before `RouteRestore` even gets to move
the athlete somewhere else (`last-route.ts:10-20`).

### 6.2 — S3 — 5.7 MB of client chunks, with recharts never split

`npx next build` (Next 16.2.10, Turbopack) — the route table reports no per-route
sizes, so measured from `.next/static`:

```
.next/static           5.7 MB
.next/static/chunks    5.3 MB

  434 KB  3a4x3jn00ixj-.js
  434 KB  26_xj2x1g689g.js
  434 KB  1tpea66z9b-gh.js
  434 KB  0wiatb5n0g4py.js
  382 KB  3vgvnktmnzlmi.js
  240 KB  1c8o59i86sdnr.js
  222 KB  1cnssddv7y-9z.js
  205 KB  0zpedhae1jqkk.js
```

Four ~434 KB chunks plus a 382 KB one. `recharts` is statically imported by 12
components including `dashboard/engine-lab-trend-card.tsx` and
`analytics/charts.tsx`, so it lands in the dashboard's critical path. Leaflet *is*
correctly split (`next/dynamic({ ssr: false })` in `gps-run/page.tsx:53` and
`route-map.tsx:4`) — recharts should get the same treatment.

Over `server.url` this is downloaded from the network on a cold launch, not read from
the app bundle. On race-day cellular that is the launch experience.

### 6.3 — S3 — Per-second full-track recompute during tracking

Covered in §4.4 — the same code is both a battery issue over 2 hours and a
frame-rate issue on older devices. `liveDistanceMeters`, `movingPoints`,
`liveElevationGainMeters`, `currentPaceSecondsPerKm` and `livePrediction`
(`gps-run/page.tsx:255-305`) all recompute over the entire point array, on the main
thread, on every tick and every fix.

Incremental accumulation (keep a running distance, append rather than refilter) would
make all five O(1) per fix.

### 6.4 — Scoring engine placement: correct

Worth recording as a non-defect. `computeInterferenceReport`, `computeReadiness`,
`buildTodayPlan`, `computeIndexes`, `calculateOverallDotsGl` all run server-side in
the dashboard server component. None of the heavy scoring runs in the WebView. The one
client-side scoring call is `livePredictionLadder`, which is genuinely needed live.

---

## Suggested order of work

**Before submitting to review**

1. §1.1 + §1.2 — persist the finished run until the POST succeeds, and route the GPS
   save through `submitActivityRequest`. One change closes the worst data-loss path.
2. §1.3 — make `offline-track.html` refuse to overwrite a session that has points.
3. §2.1 — add `bluetooth-central` to `UIBackgroundModes`; §2.2 — remove
   `workout-processing`.
4. §2.3 — surface a location denial before showing the tracking HUD.
5. §3.2 — a timeout on `submitActivityRequest`.
6. §5.1 — write the native-capability list into the App Review notes.

**Before a wide launch**

7. §1.4 — local mirror for the draft autosave.
8. §1.6 — persist `hrReadings` alongside the GPS points (wrong data beats missing data).
9. §1.7 — clear the form and disable resubmit on the queued branch.
10. §3.3 + §3.4 + §3.5 — attempt limits, an idempotency key, and a visible pending count.
11. §6.1 — parallelise lines 566/571 and move the write off the render path.

**Fast follow**

12. §1.5 / §2.6 — an Android foreground notification for the gym timer.
13. §4.1 — Dynamic Type.
14. §6.2 — split recharts.
