import { AuthForm } from "@/components/auth/auth-form";

export default function SignupPage() {
  return (
    <div className="min-h-dvh bg-ambient flex items-center justify-center px-4">
      <AuthForm mode="signup" />
    </div>
  );
}
