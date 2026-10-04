"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AccountSummary {
  name: string;
  email: string;
  avatarUrl: string | null;
}

/** "SR" from "stephen_russell", "?" when there is nothing to make it from. */
export function initialsFor(name: string): string {
  const source = name.trim();
  if (!source) return "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * Who is signed in, for the avatar in the top bar and the sidebar footer.
 * `null` until it has loaded — callers render a skeleton or a placeholder.
 */
export function useAccountSummary(): AccountSummary | null {
  const [account, setAccount] = useState<AccountSummary | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("user_id", user.id)
        .single();

      if (cancelled) return;
      setAccount({
        name: profile?.username?.trim() || profile?.display_name?.trim() || "",
        email: user.email ?? "",
        avatarUrl: profile?.avatar_url ?? null,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return account;
}
