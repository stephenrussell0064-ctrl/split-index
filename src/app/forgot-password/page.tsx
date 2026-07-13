import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-dvh bg-ambient flex flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <ForgotPasswordForm />
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
