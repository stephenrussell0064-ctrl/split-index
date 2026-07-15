import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthPageError } from "@/lib/supabase/auth-page-errors";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; detail?: string }>;
}) {
  const { error, reason, detail } = await searchParams;

  return (
    <div className="min-h-dvh bg-ambient flex flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <AuthForm
          mode="signup"
          initialError={resolveAuthPageError(error, reason, detail)}
        />
      </div>
      <footer className="px-6 py-6 text-center text-sm text-muted">
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
