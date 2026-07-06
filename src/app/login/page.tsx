import { AuthForm } from "@/components/auth/auth-form";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in failed. Please try again.",
  oauth_denied: "Sign-in was cancelled or denied. Please try again.",
  missing_code: "Sign-in failed before completion. Please try again.",
  exchange_failed:
    "Could not complete sign-in. If this keeps happening, try the same URL you usually use (with or without www) or contact support.",
  user_lookup_failed: "Sign-in succeeded but the session could not be loaded. Please try again.",
  no_user: "Sign-in succeeded but no user account was found. Please try again.",
};

function resolveAuthError(
  error?: string,
  reason?: string,
  detail?: string
): string | undefined {
  if (error !== "auth") return undefined;

  const base = AUTH_ERROR_MESSAGES[reason ?? "auth"] ?? AUTH_ERROR_MESSAGES.auth;

  if (process.env.NODE_ENV === "development" && detail) {
    return `${base} (${detail})`;
  }

  return base;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; detail?: string }>;
}) {
  const { error, reason, detail } = await searchParams;

  return (
    <div className="min-h-screen bg-ambient flex items-center justify-center px-4">
      <AuthForm
        mode="login"
        initialError={resolveAuthError(error, reason, detail)}
      />
    </div>
  );
}
