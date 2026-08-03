import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthPageError } from "@/lib/supabase/auth-page-errors";
import { createClient } from "@/lib/supabase/server";

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

      <div className="relative flex flex-1 items-center justify-center px-4">
        <AuthForm
          mode="login"
          initialError={resolveAuthPageError(error, reason, detail)}
        />
      </div>
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
