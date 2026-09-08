import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { mainContentProps } from "@/lib/a11y/main-content";

export default function ResetPasswordPage() {
  return (
    <main {...mainContentProps} className="min-h-dvh bg-ambient flex items-center justify-center px-4 focus:outline-none">
      <ResetPasswordForm />
    </main>
  );
}
