"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/supabase/auth-errors";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setCheckingSession(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError(authErrorMessage(error, "Could not update your password. Please try again."));
      } else {
        await supabase.auth.signOut();
        setMessage("Your password has been updated. Redirecting to sign in…");
        setTimeout(() => router.push("/login"), 2000);
      }
    } catch (err) {
      setError(authErrorMessage(err, "Could not update your password. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <BrandMark variant="full" href="/" logoHeight={36} priority />
        <p className="mt-3 text-xs text-muted">Choose a new password</p>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="glass-strong rounded-2xl border border-white/[0.08] p-8"
      >
        {checkingSession ? (
          <p className="text-sm text-muted">Checking your reset link…</p>
        ) : !hasSession ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This reset link is invalid or has expired. Password reset links
              can only be used once and expire after a short time.
            </p>
            <p className="text-sm text-muted">
              Request a new link from the forgot password page, or sign in if
              you already updated your password.
            </p>
            <Link
              href="/forgot-password"
              className={cn(buttonVariants({ variant: "default" }), "w-full")}
            >
              Request a new link
            </Link>
            <p className="text-center text-sm text-muted">
              <Link href="/login" className="text-accent hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted mb-6">
              Enter a new password for your account.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <Input
                label="Confirm password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />

              {error && <p className="text-sm text-danger">{error}</p>}
              {message && <p className="text-sm text-success">{message}</p>}

              <Button type="submit" className="w-full" loading={loading}>
                Update password
              </Button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
