"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { BrandMark } from "@/components/brand/brand-mark";
import { AppleIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/supabase/auth-errors";
import { getAppUrl } from "@/lib/app-url";

export function AuthForm({
  mode,
  initialError,
}: {
  mode: "login" | "signup";
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState("");

  const authCallbackUrl = () =>
    `${getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined)}/auth/callback`;

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
          options: { emailRedirectTo: authCallbackUrl() },
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
          setMessage("Check your email to confirm your account.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(
            authErrorMessage(error, "Sign-in failed. Please check your details.")
          );
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

  const handleOAuth = async (provider: "google" | "apple") => {
    setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) {
        const label = provider === "apple" ? "Apple" : "Google";
        setError(authErrorMessage(error, `${label} sign-in failed. Please try again.`));
      }
    } catch (err) {
      const label = provider === "apple" ? "Apple" : "Google";
      setError(authErrorMessage(err, `${label} sign-in failed. Please try again.`));
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <BrandMark variant="full" href="/" logoHeight={36} priority />
        <p className="mt-3 text-xs text-muted">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </p>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="glass-strong rounded-2xl border border-white/[0.08] p-8"
      >
        <div className="space-y-3 mb-6">
          <Button
            variant="secondary"
            className="w-full gap-2"
            onClick={() => handleOAuth("google")}
          >
            <GoogleIcon className="h-4 w-4" />
            Continue with Google
          </Button>
          <Button
            type="button"
            className="w-full gap-2 bg-black text-white hover:bg-black/90 border border-white/10"
            onClick={() => handleOAuth("apple")}
          >
            <AppleIcon className="h-4 w-4" />
            Continue with Apple
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
            minLength={8}
          />

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
          </Link>
          .
        </p>
      </motion.div>
    </div>
  );
}
