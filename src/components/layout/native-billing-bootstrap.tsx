"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { configureRevenueCat } from "@/lib/native/billing";

/**
 * Capacitor-conversion brief, Part 2 — configures RevenueCat once per
 * session as soon as the logged-in user is known, using their Supabase
 * user id as RevenueCat's own appUserID (see billing.ts). Renders nothing;
 * a no-op entirely on web (configureRevenueCat checks isNativePlatform()
 * itself before doing anything).
 */
export function NativeBillingBootstrap() {
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled && user) {
        void configureRevenueCat(user.id);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
