import { AuthForm } from "@/components/auth/auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen bg-ambient flex items-center justify-center px-4">
      <AuthForm
        mode="login"
        initialError={
          error === "auth"
            ? "Sign-in failed. Please try again."
            : undefined
        }
      />
    </div>
  );
}
