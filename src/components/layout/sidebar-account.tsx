"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOutEverywhere } from "@/lib/auth/sign-out-client";
import { Skeleton } from "@/components/ui/skeleton";
import { initialsFor, useAccountSummary } from "./use-account-summary";

export function SidebarAccount() {
  const router = useRouter();
  const account = useAccountSummary();

  const handleSignOut = async () => {
    await signOutEverywhere();
    router.push("/");
    router.refresh();
  };

  if (!account) {
    return (
      <div className="border-t border-white/[0.06] px-3 py-3">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <Skeleton className="h-8 w-8 rounded-lg shimmer" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-2.5 w-24 rounded-md shimmer" />
            <Skeleton className="h-2 w-32 rounded-md shimmer" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-white/[0.06] px-3 py-3">
      <div className="flex items-center gap-1">
        <Link
          href="/profile"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.04]"
        >
          {account.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.avatarUrl}
              alt={account.name || "Profile"}
              className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-strength text-xs font-bold text-white ring-1 ring-white/10">
              {initialsFor(account.name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {account.name || "Your Profile"}
            </p>
            {!account.name && (
              <p className="truncate text-xs text-muted">Complete your profile</p>
            )}
          </div>
        </Link>
        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          className="rounded-lg p-2 text-muted transition-colors duration-200 hover:bg-white/[0.04] hover:text-foreground"
        >
          <LogOut className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
