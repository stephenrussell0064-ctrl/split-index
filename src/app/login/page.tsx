import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthPageError } from "@/lib/supabase/auth-page-errors";
import { createClient } from "@/lib/supabase/server";
import { mainContentProps } from "@/lib/a11y/main-content";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; detail?: string }>;
}) {
  const { error, reason, detail } = await searchParams;

  // This is the native app's actual entry point (capacitor.config.ts
  // server.url) — a returning, already-signed-in user should land straight
  // on their dashboard, not see a login screen again every time they open
  // the app.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative min-h-dvh overflow-hidden bg-ambient flex flex-col">
      <div aria-hidden className="landing-orb landing-orb-gym opacity-50" />
      <div aria-hidden className="landing-orb landing-orb-cardio opacity-50" />
      <div aria-hidden className="landing-hero-grid landing-hero-grid-lab" />

      {/*
        Safe-area padding with a 3rem FLOOR, not a bare env() inset.

        On iPhone env(safe-area-inset-top) reports the real notch height and
        max() picks it, so nothing moves. The floor is for iPad: an iPhone-only
        app (TARGETED_DEVICE_FAMILY = 1) runs there in compatibility mode, where
        the inset reports 0 while iPadOS still paints its status bar across the
        full width — including over the letterboxed app window. Reviewed on an
        iPad Air, the brand mark landed underneath the clock.

        This page looked correct on iPhone only by accident: the card is
        vertically centred and there was enough spare height to clear the
        island. The compatibility window is proportionally shorter, so centring
        left no slack and the top slid under the status bar.
      */}
      <main {...mainContentProps} className="relative flex flex-1 items-center justify-center px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] focus:outline-none">
        <AuthForm
          mode="login"
          initialError={resolveAuthPageError(error, reason, detail)}
        />
      </main>
      <footer className="relative px-6 py-6 text-center text-sm text-muted">
        <span className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
        </span>
      </footer>
    </div>
  );
}
