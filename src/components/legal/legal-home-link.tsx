"use client";

import Link from "next/link";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";

/**
 * The way out at the BOTTOM of a legal page.
 *
 * Terms had one and it pointed at "/", which inside the app is the marketing
 * landing page — so an athlete who read to the end was put back on the first
 * sign-in screen. Privacy, the longer of the two by a wide margin, had no way
 * home at all: its footer listed only a link across to Terms, so the end of the
 * page was a dead end and the only escape was the control at the very top,
 * back up past fourteen sections.
 *
 * Same destination rule as LegalBackLink, for the same reason: inside the app
 * there is no marketing site to return to, so home means Settings.
 */
export function LegalHomeLink({ className }: { className?: string }) {
  const inApp = useIsNativeShell();

  return (
    <Link
      href={inApp ? "/settings" : "/"}
      className={
        className ??
        "inline-flex min-h-11 items-center px-2 transition-colors hover:text-foreground"
      }
    >
      {inApp ? "Settings" : "Home"}
    </Link>
  );
}
