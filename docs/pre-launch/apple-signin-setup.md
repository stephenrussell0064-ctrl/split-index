# Sign in with Apple — the two forms only you can fill in

Everything on the code side is done. What remains is two web forms behind your
credentials: one in the Apple Developer portal, one in Supabase.

**State as of 8 September 2026**, read from the live project rather than assumed:

```
apple is NOT enabled. Currently on: anonymous_users, google, email
```

That is checked automatically now — `runner/check-supabase-provider.mjs apple`
in the venture-projects repo, wired into the dashboard. It flips to done the
moment you save the Supabase form; nothing needs confirming by hand.

## Why this is worth doing before submitting

The Apple button is already rendered in the sign-in form. While the provider is
off, pressing it produces an error. A visibly broken sign-in button is treated
considerably worse in review than no button at all, so this is not optional
polish — it is either configured or the button comes out.

Guideline 4.8 also requires Sign in with Apple wherever a third-party login is
offered, and Google is offered. So it comes out only if Google does too.

---

## Part 1 — Apple Developer portal

You need four values. Three come from here.

### 1. A Services ID

`Certificates, Identifiers & Profiles` → `Identifiers` → **+** → **Services IDs**

- Description: anything, e.g. `Split Index Sign In`
- Identifier: something like `com.splitindex.signin`

**This is not your app's bundle ID.** They look alike and are not
interchangeable: the bundle ID identifies the iOS app, the Services ID
identifies the web sign-in configuration Supabase redirects through. Using the
bundle ID here is the most common way this fails.

Then click into it, tick **Sign in with Apple**, and press **Configure**:

- Primary App ID: your Split Index app ID
- Domains: `qoohyneotupuxrkwyeup.supabase.co`
- Return URLs: `https://qoohyneotupuxrkwyeup.supabase.co/auth/v1/callback`

The return URL must match exactly, including `https://` and no trailing slash.

### 2. A key

`Keys` → **+** → tick **Sign in with Apple** → Configure → select your primary
App ID → Register.

Download the `.p8`. **Apple lets you download it once.** Put it somewhere
outside this repository — `~/Documents/` is fine, `~/Downloads/` is fine until
you tidy up. Do not commit it.

Note the **Key ID** shown on that page (it is also in the filename,
`AuthKey_<KEYID>.p8`).

### 3. Your Team ID

Top right of the developer portal, or under Membership details. Ten characters.

---

## Part 2 — generate the client secret

Supabase's Apple provider has a field labelled **"Secret Key"**. It is not a key
and not a password: it is a JWT you generate, signed with the `.p8`, asserting
that you are the team that owns the Services ID. Pasting the `.p8` contents in
there fails with an unhelpful error.

Run this — it reads the key, prints the JWT, and never stores or transmits it:

```bash
node scripts/apple-client-secret.mjs \
  --key ~/Downloads/AuthKey_XXXXXXXXXX.p8 \
  --team YOUR_TEAM_ID \
  --services-id com.splitindex.signin
```

It prints the token, the Client ID to pair it with, and the expiry date.

**Put that expiry in your calendar.** Apple caps these at six months. When it
lapses, Sign in with Apple stops working with no warning and no email — the
button simply starts failing again. Re-running this command and pasting the new
value is the whole fix; nothing else changes.

---

## Part 3 — Supabase

`Authentication` → `Providers` → `Apple` → enable.

| Field | Value |
| --- | --- |
| Client ID | your Services ID, e.g. `com.splitindex.signin` |
| Secret Key | the JWT printed above |

Save.

---

## Confirming it worked

Two ways, and prefer the first:

```bash
node runner/check-supabase-provider.mjs apple     # in venture-projects
```

Exit 0 and `apple is enabled` means Supabase is serving it. Then press the
button in the app — the round trip through Apple is the part no config check can
prove.

If the button still errors after the check passes, the usual cause is the return
URL: it must be `https://qoohyneotupuxrkwyeup.supabase.co/auth/v1/callback`,
character for character, in the Services ID configuration.

---

## What is already done, so you don't redo it

- The Apple button, styled and wired, alongside Google — `src/components/auth/auth-form.tsx`
- The OAuth round trip, shared with Google, including in-app-browser handling — `src/lib/native/oauth.ts`
- The client-secret generator and its tests — `scripts/apple-client-secret.mjs`
- The `com.apple.developer.applesignin` entitlement is deliberately **absent**.
  It is required only for the native `AuthenticationServices` flow; this app
  goes through Supabase OAuth, and adding it breaks code signing. There is a
  test guarding its absence so it does not get "helpfully" re-added.
