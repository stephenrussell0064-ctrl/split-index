"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import type { AuthError } from "@supabase/supabase-js";
import { BrandMark } from "@/components/brand/brand-mark";
import { AppleIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/supabase/auth-errors";
import { buildAuthCallbackUrl } from "@/lib/supabase/auth-callback-url";
import { isNativePlatform } from "@/lib/native/platform";
import {
  nativeOAuthRedirectUrl,
  openNativeOAuthUrl,
  registerNativeOAuthRedirectListener,
} from "@/lib/native/oauth";

type Phase = "form" | "otp";

export function AuthForm({
  mode,
  initialError,
}: {
  mode: "login" | "signup";
  initialError?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState("");

  const authCallbackUrl = (nextPath = "/dashboard") => buildAuthCallbackUrl(undefined, nextPath);

  useEffect(() => registerNativeOAuthRedirectListener(), []);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // emailRedirectTo stays as a fallback for anyone who clicks the
          // link instead of entering the code Supabase's email template
          // also shows as {{ .Token }} — see the email-otp-fix brief: a
          // clickable link can be pre-fetched and burned by corporate mail
          // scanners before the real user ever clicks it, which a manually
          // typed 6-digit code can't be.
          options: { emailRedirectTo: authCallbackUrl("/email-confirmed") },
        });

        if (error) {
          setError(
            authErrorMessage(
              error,
              "We couldn't create your account. Please try again."
            )
          );
        } else if (data.user?.identities?.length === 0) {
          setError(
            "An account with this email already exists. Try signing in instead."
          );
        } else {
          setPhase("otp");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if ((error as AuthError).code === "email_not_confirmed") {
            setPhase("otp");
            setError(authErrorMessage(error));
          } else {
            setError(
              authErrorMessage(error, "Sign-in failed. Please check your details.")
            );
          }
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err) {
      setError(
        authErrorMessage(
          err,
          mode === "signup"
            ? "We couldn't create your account. Please try again."
            : "Sign-in failed. Please try again."
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "signup",
      });

      if (error) {
        setError(
          authErrorMessage(error, "That code didn't work. Please check it and try again.")
        );
      } else {
        router.push("/onboarding");
      }
    } catch (err) {
      setError(
        authErrorMessage(err, "That code didn't work. Please check it and try again.")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResending(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) {
        setError(authErrorMessage(error, "Could not resend the code. Please try again."));
      } else {
        setMessage("New code sent — check your email.");
      }
    } catch (err) {
      setError(authErrorMessage(err, "Could not resend the code. Please try again."));
    } finally {
      setResending(false);
    }
  };

  const backToForm = () => {
    setPhase("form");
    setOtp("");
    setError("");
    setMessage("");
  };

  /*
    Two providers, one handler.

    APPLE IS NOT OPTIONAL. App Store Guideline 4.8 says that an app offering a
    third-party social login to set up an account must also offer an equivalent
    service that limits data collection to name and email, lets the user keep
    their email private, and does not collect interactions for advertising.
    Google is such a login; Sign in with Apple is the alternative that meets
    those three properties. This is checked automatically and caught in seconds,
    and email OTP does not satisfy it — the required alternative has to be a
    login *service*, and a self-hosted email code is not one.

    It is rendered ABOVE Google, at equal prominence, which is also what Apple's
    own Human Interface Guidelines ask for.
  */
  const handleOAuth = async (provider: "google" | "apple") => {
    setError("");
    const label = provider === "apple" ? "Apple" : "Google";
    try {
      const supabase = createClient();
      const native = isNativePlatform();

      // Google refuses to complete sign-in inside an embedded webview, which
      // the app's own main webview is — on native, the OAuth screens run in
      // a separate in-app browser instead (see lib/native/oauth.ts), and
      // skipBrowserRedirect keeps this call from navigating the main webview
      // itself away from the app. Apple's web flow has the same constraint, so
      // both take the identical path.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: native
          ? { redirectTo: nativeOAuthRedirectUrl(), skipBrowserRedirect: true }
          : // No `?next=` query param — Supabase's redirectTo allowlist match is
            // exact against the bare callback URL registered in the dashboard
            // (see buildAuthCallbackUrl); /auth/callback still routes correctly
            // by onboarding state without it.
            { redirectTo: buildAuthCallbackUrl(undefined, null) },
      });

      if (error) {
        setError(authErrorMessage(error, `${label} sign-in failed. Please try again.`));
        return;
      }

      if (native && data?.url) {
        await openNativeOAuthUrl(data.url);
      }
    } catch (err) {
      setError(authErrorMessage(err, `${label} sign-in failed. Please try again.`));
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <BrandMark variant="full" href="/" logoHeight={36} priority />
        <p className="mt-3 text-xs text-muted">
          {phase === "otp"
            ? "Confirm your email"
            : mode === "login"
              ? "Welcome back"
              : "Create your account"}
        </p>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="glass-strong rounded-2xl border border-white/[0.08] p-8"
      >
        {phase === "otp" ? (
          <>
            <p className="text-sm text-muted mb-2">
              We sent a 6-digit code to <span className="text-foreground">{email}</span>. Enter
              it below to confirm your account — or click the confirm link in that same email if
              you&apos;d rather use that.
            </p>
            <p className="text-xs text-muted/70 mb-6">
              Don&apos;t see it? Check your junk/spam folder — confirmation emails end up there
              more often than they should.
            </p>

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <Input
                label="6-digit code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
              />

              {error && <p className="text-sm text-danger">{error}</p>}
              {message && <p className="text-sm text-success">{message}</p>}

              <Button type="submit" className="w-full" loading={loading} disabled={otp.length !== 6}>
                Verify code
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={backToForm}
                className="text-muted hover:text-foreground hover:underline"
              >
                ← Use a different email
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resending}
                className="text-accent hover:underline disabled:opacity-50"
              >
                {resending ? "Sending…" : "Resend code"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              <Button
                variant="secondary"
                className="w-full gap-2"
                onClick={() => handleOAuth("apple")}
              >
                <AppleIcon className="h-4 w-4" />
                Continue with Apple
              </Button>
              <Button
                variant="secondary"
                className="w-full gap-2"
                onClick={() => handleOAuth("google")}
              >
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </Button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background/80 px-3 text-muted backdrop-blur-sm">
                  or continue with email
                </span>
              </div>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "signup" ? 8 : undefined}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted -mt-2">
                  Use at least 8 characters. Longer passwords with letters and numbers are
                  stronger.
                </p>
              )}

              {mode === "login" && (
                <p className="text-right text-sm">
                  <Link
                    href="/forgot-password"
                    className="text-accent hover:underline"
                  >
                    Forgot password?
                  </Link>
                </p>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}
              {message && <p className="text-sm text-success">{message}</p>}

              <Button type="submit" className="w-full" loading={loading}>
                {mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted mt-6">
              {mode === "login" ? (
                <>
                  No account?{" "}
                  <Link href="/signup" className="text-accent hover:underline">
                    Sign up
                  </Link>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <Link href="/login" className="text-accent hover:underline">
                    Sign in
                  </Link>
                </>
              )}
            </p>

            <p className="text-center text-xs text-muted mt-4">
              By continuing, you agree to our{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/terms" className="text-accent hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
