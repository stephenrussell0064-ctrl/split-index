"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "split-index-friend-invite-dismissed";
const WEEK_MS = 7 * 86400000;

function readInitialVisible(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(STORAGE_KEY)) return false;
  const created = localStorage.getItem("split-index-account-created");
  if (!created) {
    localStorage.setItem("split-index-account-created", String(Date.now()));
    return false;
  }
  return Date.now() - Number(created) >= WEEK_MS;
}

export function FriendInviteBanner() {
  const [visible, setVisible] = useState(readInitialVisible);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 pr-12">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-lg p-1 text-muted hover:bg-white/5 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15">
          <Users className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Train with friends</p>
          <p className="text-xs text-muted">
            Athletes with training partners stay consistent 40% longer.
          </p>
        </div>
        <Link href="/social">
          <Button variant="secondary" size="sm">
            Invite friends
          </Button>
        </Link>
      </div>
    </div>
  );
}
