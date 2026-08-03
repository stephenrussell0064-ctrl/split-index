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
