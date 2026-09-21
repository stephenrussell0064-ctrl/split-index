import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Terms of Use and Privacy Policy, on any billing surface.
 *
 * Guideline 3.1.2 requires these on the purchase screen, so they were written
 * into `SkuPicker` — which is only rendered while the athlete is NOT premium.
 * The moment someone subscribed, Settings → Billing swapped the picker for the
 * manage-subscription panel and both links disappeared from the app's only
 * billing screen. A subscriber is precisely the person most likely to go
 * looking for the terms they are now paying under.
 *
 * Shared rather than duplicated so the two states cannot drift, and so a third
 * billing surface gets them by construction.
 */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-[11px] leading-relaxed text-muted", className)}>
      <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
        Terms of Use
      </Link>
      {" · "}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
        Privacy Policy
      </Link>
    </p>
  );
}
