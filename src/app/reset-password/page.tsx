import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { mainContentProps } from "@/lib/a11y/main-content";

export default function ResetPasswordPage() {
  return (
    <main {...mainContentProps} className="min-h-dvh bg-ambient flex items-center justify-center px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] focus:outline-none">
      <ResetPasswordForm />
    </main>
  );
}
