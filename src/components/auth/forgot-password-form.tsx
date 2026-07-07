"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/supabase/auth-errors";
import { getAppUrl } from "@/lib/app-url";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const redirectTo = `${getAppUrl(typeof window !== "undefined" ? window.location.origin : undefined)}/auth/callback?next=/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        setError(authErrorMessage(error, "Could not send reset email. Please try again."));
      } else {
        setMessage(
          "If an account exists for that email, we sent a link to reset your password."
        );
      }
    } catch (err) {
      setError(authErrorMessage(err, "Could not send reset email. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <BrandMark variant="full" href="/" logoHeight={36} priority />
        <p className="mt-3 text-xs text-muted">Reset your password</p>
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="glass-strong rounded-2xl border border-white/[0.08] p-8"
      >
        <p className="text-sm text-muted mb-6">
          Enter the email address for your account and we&apos;ll send you a
          link to choose a new password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          {error && <p className="text-sm text-danger">{error}</p>}
          {message && <p className="text-sm text-success">{message}</p>}

          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>

        <p className="text-center text-sm text-muted mt-6">
          Remember your password?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
