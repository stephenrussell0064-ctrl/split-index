"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
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
 * `navigateBack` returns to the actual previous page when there is history and
 * falls back to the dashboard when there is not — which is the right landing
 * for someone deep-linking in while signed in, and the same helper the app's
 * own top bar uses, so the gesture behaves identically in both places.
 */
export function LegalBackLink() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => navigateBack(router)}
      // min-h-11: this is the only way out of a long legal page on a phone,
      // and Apple's minimum touch target is 44pt.
      className="-mr-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ChevronLeft className="h-4 w-4" />
      Back
    </button>
  );
}
