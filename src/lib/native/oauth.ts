import { Browser } from "@capacitor/browser";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { isNativePlatform } from "./platform";

/**
 * Google (like most OAuth providers) refuses to complete sign-in inside an
 * embedded WKWebView — Split Index's native app shell IS one, so the OAuth
 * consent screens have to run in the system's own in-app browser
 * (SFSafariViewController on iOS, Custom Tabs on Android, via
 * @capacitor/browser) instead of the main webview. That browser has no way
 * to hand an https:// redirect back to this app on its own, so `redirectTo`
 * is a custom URL scheme instead — the OS delivers that straight back to the
 * app as an `appUrlOpen` event rather than trying to load it as a page.
 */
const OAUTH_REDIRECT_SCHEME = "co.uk.splitindex.app";
const OAUTH_CALLBACK_HOST = "auth-callback";

export function nativeOAuthRedirectUrl(): string {
  return `${OAUTH_REDIRECT_SCHEME}://${OAUTH_CALLBACK_HOST}`;
}

export async function openNativeOAuthUrl(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * Whether the in-app browser is closing because sign-in SUCCEEDED.
 *
 * The OS fires `browserFinished` both when the user dismisses the sheet and
 * when we close it ourselves after the redirect lands, and those two need
 * opposite responses. Module-level rather than passed around because the two
 * listeners are registered independently — the redirect one once per mount,
 * the dismiss one per attempt — and they have to agree.
 */
let completing = false;

/** Call before opening the browser, so a previous attempt cannot mute this one. */
export function beginNativeOAuth(): void {
  completing = false;
}

/**
 * Put the sign-in screen back when the browser closes without signing anybody in.
 *
 * ## The bug this fixes, and what it cost
 *
 * `auth-form.tsx` disables both provider buttons while an attempt is in
 * flight, and cleared that state only on an error from `signInWithOAuth` or on
 * the redirect arriving. Neither happens when the user simply dismisses the
 * sheet — so the buttons stayed disabled until the app was restarted. One tap
 * and the sign-in screen was dead.
 *
 * That is not a corner case, because `signInWithOAuth` builds the provider URL
 * on the CLIENT and does not contact the server. With Apple not enabled on the
 * Supabase project it still returns `error: null` and a URL; the failure only
 * appears when the browser loads it, as a raw JSON body:
 *
 *     {"code":400,"error_code":"validation_failed",
 *      "msg":"Unsupported provider: provider is not enabled"}
 *
 * Verified against the live project on 15 September 2026 — `apple` 400s,
 * `google` 302s to accounts.google.com.
 *
 * So an App Store reviewer taps "Continue with Apple" (which sits above Google
 * deliberately, per Guideline 4.8), reads that JSON, dismisses the sheet, and
 * finds Google and email disabled too. "Login not working" is an accurate
 * description of it, and the misconfiguration alone would not have produced it:
 * without this, one failed provider disables the two that work.
 */
export function registerNativeOAuthDismissListener(onDismissed: () => void): () => void {
  if (!isNativePlatform()) return () => {};

  let removed = false;
  const listenerPromise = Browser.addListener("browserFinished", () => {
    // Our own close, after the redirect landed. The app is already navigating.
    if (completing) return;
    onDismissed();
  });

  return () => {
    removed = true;
    listenerPromise.then((handle) => {
      if (removed) handle.remove();
    });
  };
}

/**
 * Once the OS delivers the custom-scheme redirect back to the app, forward
 * its exact query string onto the app's own /auth/callback route as a normal
 * same-origin navigation inside the main webview — reusing the existing
 * server-side PKCE exchange, profile-ensure, and onboarding-redirect logic
 * completely unchanged rather than duplicating it client-side. The PKCE
 * code_verifier cookie set on this origin when signInWithOAuth was first
 * called is still present (same webview, same origin), so the exchange
 * succeeds exactly as it does on web.
 */
export function registerNativeOAuthRedirectListener(): () => void {
  if (!isNativePlatform()) return () => {};

  let removed = false;
  const listenerPromise = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    if (!event.url.startsWith(`${OAUTH_REDIRECT_SCHEME}://${OAUTH_CALLBACK_HOST}`)) return;

    // Set BEFORE closing: closing fires `browserFinished`, and the dismiss
    // listener must not report a successful sign-in as an abandoned one.
    completing = true;
    Browser.close().catch(() => {});

    const redirectUrl = new URL(event.url);
    window.location.href = `${window.location.origin}/auth/callback${redirectUrl.search}`;
  });

  return () => {
    removed = true;
    listenerPromise.then((handle) => {
      if (removed) handle.remove();
    });
  };
}
