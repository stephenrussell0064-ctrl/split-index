import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-ambient flex flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <ForgotPasswordForm />
      </div>
      <footer className="px-6 py-6 text-center text-sm text-muted">
        <Link href="/privacy" className="hover:text-foreground transition-colors">
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}
