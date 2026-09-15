# App Store rejection: "login not working" — what it was and what to do

**Diagnosed 15 September 2026.** Build 3, submitted 8 September, rejected on
sign-in.

**Short answer: there is nothing to merge to main, and no code change fixes
this.** The cause is configuration — your Apple Developer account and the
Supabase dashboard — and it is step 1 below. A separate code fix exists on
`fix/app-store-login`, but it belongs to build 5 rather than to the build that
was rejected; step 2 explains why.

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

### CORRECTION, same day: what this does NOT explain

An earlier version of this document said the reviewer was also locked out of
Google and email, because `auth-form.tsx` disables both provider buttons for the
duration of an attempt and never clears that when the browser sheet is
dismissed. That is a real bug, and it is **not on the build that was rejected**.

Checked afterwards, which is the order it should have been done in:

| Branch | `CURRENT_PROJECT_VERSION` | Has `oauthPending` |
| --- | --- | --- |
| `main` | **3** — the build that was submitted and rejected | no |
| `venture/b7-privacy-policy` | 5 — later work, never merged | yes |

`main` has no pending state and no `disabled` on the provider buttons, so
dismissing the sheet leaves the screen fully usable. On build 3 the reviewer
could have signed in with Google or email. They rejected it anyway, which means
the rejection is most likely about Sign in with Apple itself — Guideline 4.8
requires it to work while Google is offered — rather than about being locked out.

So the whole of the cause is step 1, and nothing in code substitutes for it.

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

## Step 2 — The code fix, and why it is NOT a merge to main

**Do not merge `fix/app-store-login` into main.** It was cut from
`venture/b7-privacy-policy`, and that branch and main have diverged badly: 106
commits on the branch that are not on main, 113 on main that are not on the
branch, with a good deal of equivalent work done twice under different commits.
Reconciling them is a real job and it has nothing to do with this rejection.

Replaying it onto main was tried in a scratch worktree and **does not compile**:
the fix calls `setOauthPending(null)`, and that state does not exist on main. Git
merged it without a conflict, which is worth recording — a clean replay is not
evidence of a working one.

The fix belongs where the bug is: `venture/b7-privacy-policy`, build 5. It is
committed on `fix/app-store-login` as `c116a3d`, touching three files:

| File | Change |
| --- | --- |
| `src/lib/native/oauth.ts` | `registerNativeOAuthDismissListener` + `beginNativeOAuth` |
| `src/components/auth/auth-form.tsx` | restores the buttons and shows a message when the sheet closes without signing in |
| `src/lib/native/oauth.test.ts` | new, 7 tests |

It ignores our own `Browser.close()` after a successful redirect — that fires
the same OS event and would otherwise flash an error over a working sign-in —
and resets per attempt so a second sign-in is not permanently muted. Both are
mutation-verified.

**2,101 tests pass, tsc clean — on that branch.** Three files modified by
another session (`sitemap.ts`, `app-shell.tsx`, `premium/features.test.ts`) plus
a set of untracked files were in the tree and are untouched by the commit.

Before build 5 ever goes near App Review this should land. On build 3 it is
neither needed nor applicable.

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

Enable Apple in Supabase and confirm the redirect allowlist → confirm the demo
account in App Store Connect → rebuild and resubmit. **Nothing needs to reach
main for this.**

Step 1 is the whole of it. Step 2 is for build 5, whenever the
`venture/b7-privacy-policy` work is reconciled with main.
