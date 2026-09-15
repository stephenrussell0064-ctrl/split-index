# App Store rejection: "login not working" — what it was and what to do

**Diagnosed 15 September 2026.** Build 3, submitted 8 September, rejected on
sign-in.

The code half is committed on branch **`fix/app-store-login`** and is ready to
push. **It does not clear the rejection on its own.** The cause is configuration
that needs your Apple Developer account and the Supabase dashboard, and that is
step 1 below.

---

## What actually happened

Reproduced against the live project, not inferred:

```
GET /auth/v1/authorize?provider=apple
  → 400 {"code":400,"error_code":"validation_failed",
         "msg":"Unsupported provider: provider is not enabled"}

GET /auth/v1/authorize?provider=google
  → 302 https://accounts.google.com/o/oauth2/v2/auth?client_id=…
```

**Apple is not enabled on the Supabase project.** Providers currently on:
`anonymous_users`, `google`, `email`.

This was known and recorded at submission. `registry/confirmations.json`, on the
`submitted` entry, 8 September: *"a reviewer who taps it hits a provider that is
not configured — a Guideline 4.8 rejection and a likely one."* It went in anyway.

### Why the reviewer could not just use Google instead

This is the part that turned a broken button into "login not working", and it is
the part the commit fixes.

`supabase.auth.signInWithOAuth` builds the provider URL **on the client** and
never contacts the server. An unconfigured provider therefore returns
`error: null` and a URL indistinguishable from a working one. The failure only
appears when the in-app browser loads it.

Meanwhile `auth-form.tsx` disabled **both** provider buttons for the duration of
an attempt, and cleared that state only on an error from `signInWithOAuth` or on
the redirect arriving. Dismissing the browser sheet does neither.

So the reviewer's session was:

1. Tap **Continue with Apple** — which sits *above* Google deliberately, because
   Guideline 4.8 asks for equivalent prominence.
2. In-app browser opens showing raw JSON: `Unsupported provider…`.
3. Dismiss the sheet.
4. Google and email are now greyed out, and stay that way until the app is
   force-quit.

One tap killed the sign-in screen. A reviewer who could still tap Google would
have got in and the rejection would probably have been about Apple specifically,
not about login.

---

## Step 1 — Enable Sign in with Apple. Only you can do this.

This is the one that clears the rejection. It needs credentials I must not
handle, so nothing here has been done for you.

**In the Apple Developer portal:**

1. Identifiers → your App ID (`co.uk.splitindex.app`) → enable the **Sign in
   with Apple** capability if it is not already on.
2. Create a **Services ID** for the web/OAuth flow — Supabase uses the web flow
   even from the native app, because the sheet is a browser.
3. Add the Supabase callback as a **Return URL** on that Services ID:
   `https://<your-project>.supabase.co/auth/v1/callback`
4. Keys → create a **Sign in with Apple** key and download the `.p8`. Note the
   Key ID and your Team ID. **Keep the `.p8`; it downloads once.**

**In the Supabase dashboard** (Authentication → Providers → Apple):

5. Enable the provider. Client ID is the **Services ID** (not the bundle ID).
   Secret key is generated from the `.p8` + Key ID + Team ID.
6. Authentication → URL Configuration → **Redirect URLs**: confirm
   `co.uk.splitindex.app://auth-callback` is allowed. The native flow redirects
   to that custom scheme rather than an https URL, and if it is not on the
   allowlist Apple sign-in will authenticate and then fail on the way back —
   which is a second rejection that looks like the first.

**Verify before resubmitting:**

```bash
cd ~/Projects/venture-projects
node runner/check-supabase-provider.mjs apple    # must print "apple is enabled"
./run.sh                                          # apple-provider-config → pass
```

That check is wired to the `apple-provider-config` milestone, so the dashboard
turns green on its own when this is done.

---

## Step 2 — Push the code fix

```bash
cd ~/Projects/split-index
git checkout fix/app-store-login
git push -u origin fix/app-store-login
```

One commit, `c116a3d`, touching three files:

| File | Change |
| --- | --- |
| `src/lib/native/oauth.ts` | `registerNativeOAuthDismissListener` + `beginNativeOAuth` |
| `src/components/auth/auth-form.tsx` | restores the buttons and shows a message when the sheet closes without signing in |
| `src/lib/native/oauth.test.ts` | new, 7 tests |

It ignores our own `Browser.close()` after a successful redirect — that fires
the same OS event and would otherwise flash an error over a working sign-in —
and resets per attempt so a second sign-in is not permanently muted. Both are
mutation-verified.

**2,101 tests pass, tsc clean.** Note the branch was cut from
`venture/b7-privacy-policy`; three files modified by another session
(`sitemap.ts`, `app-shell.tsx`, `premium/features.test.ts`) plus a set of
untracked files were in the tree and are untouched by the commit.

---

## Step 3 — Check the reviewer can get in without Apple at all

Worth doing regardless, because it is the difference between a rejection and a
re-review that takes a day.

App Review needs working demo credentials in App Store Connect
(App Information → App Review Information → Sign-In Information). Email sign-in
uses `signInWithPassword`, so a plain email and password works — the OTP is only
for confirming a new sign-up, and a reviewer must never be asked to receive an
email at an address they do not control.

Confirm the demo account:

- exists and is **already confirmed**, so it does not land on the OTP screen;
- has enough data to demonstrate the app — an empty dashboard invites a
  different rejection under Guideline 2.1;
- is entered in App Store Connect, not only written down somewhere.

There is an untracked `scripts/demo-account-info.ts` in the working tree from
another session, which looks like the beginning of exactly this. Worth finishing
before you resubmit.

---

## What I did not do

- **Nothing was submitted, pushed, deployed or configured.** The branch is local.
- **The `.p8` and the Supabase keys were not touched** and are not in any file
  here.
- **The Apple button was not removed.** Guideline 4.8 requires it while Google
  is offered, so removing it trades one rejection for another — the readiness
  document has said so since the first review.
- **No preflight probe was added** to hide a broken provider behind a friendlier
  message. It would have masked exactly the misconfiguration that caused this,
  and a deployment fault should be loud.

---

## The order, in one line

Enable Apple in Supabase and confirm the redirect allowlist → push
`fix/app-store-login` → confirm the demo account in App Store Connect → rebuild
and resubmit.

Step 1 is the one that matters. Step 2 makes sure that if anything else about a
provider ever breaks, a user still has the two ways in that work.
