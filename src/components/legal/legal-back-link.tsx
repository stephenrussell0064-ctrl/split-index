"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";
import { navigateBack } from "@/lib/utils/navigate-back";

/**
 * Back out of Terms or Privacy to wherever the reader came from.
 *
 * These pages are public and reachable from three places: the marketing
 * footer, the sign-up screen, and — the one that matters — the links Apple
 * requires directly under the purchase button in Settings → Billing. The only
 * way out was a hard `<Link href="/">` reading "Back to home", which drops an
 * athlete who tapped Privacy mid-purchase onto the marketing landing page,
 * signed in, with no route back to what they were doing.
 *
 * On the web that is still `navigateBack`: the previous page when there is
 * history, the dashboard when there is not.
 *
 * Inside the app it is not. History-back was reported from a device as landing
 * on the login screen, and it does that for a reason that is not a bug in
 * `navigateBack`: these pages are reached from the SKU picker, which is itself
 * reached from Settings → Billing, so "the previous page" is a paywall the
 * athlete has usually just dismissed, and a WebView opened cold has no history
 * to go back to at all. Settings is the fixed, correct destination — it is
 * where the athlete was heading, and it is one tap from everywhere else.
 */
export function LegalBackLink() {
  const router = useRouter();
  const inApp = useIsNativeShell();

  return (
    <button
      type="button"
      onClick={() => (inApp ? router.push("/settings") : navigateBack(router))}
      // min-h-11: this is the only way out of a long legal page on a phone,
      // and Apple's minimum touch target is 44pt.
      className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ChevronLeft className="h-4 w-4" />
      {inApp ? "Settings" : "Back"}
    </button>
  );
}
