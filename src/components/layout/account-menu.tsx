"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, UserRound } from "lucide-react";
import { ACCOUNT_NAV } from "@/lib/navigation/app-nav";
import { signOutEverywhere } from "@/lib/auth/sign-out-client";
import { useDialog } from "@/components/ui/use-dialog";
import { cn } from "@/lib/utils/cn";
import { initialsFor, useAccountSummary, type AccountSummary } from "./use-account-summary";

/**
 * The avatar in the top bar, and the menu it opens.
 *
 * Profile, Settings and Help used to be the last three rows of the phone's
 * "More" sheet — which meant the most ordinary thing in any app, "where is
 * my account", was two taps away behind a button labelled with an ellipsis.
 * An avatar in the top-right corner is where every app a new user has ever
 * used keeps it, so it is where this one keeps it too.
 *
 * The rows are ACCOUNT_NAV, so the menu, the sidebar and the guide cannot
 * name these screens differently. Sign out is here as well as in Settings:
 * on a phone there was previously no way out of the app that did not start
 * with finding Settings.
 */
export function AccountMenu() {
  const account = useAccountSummary();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);
  // Close on navigation — the same adjust-state-during-render pattern the
  // shell uses for its own tab state, not an effect.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={account?.name ? `Account menu for ${account.name}` : "Account menu"}
        aria-expanded={open}
        aria-controls="account-menu-sheet"
        className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/8"
      >
        <Avatar account={account} size="sm" />
      </button>

      <AnimatePresence>
        {open && <AccountSheet account={account} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function Avatar({ account, size }: { account: AccountSummary | null; size: "sm" | "md" }) {
  const box = size === "sm" ? "h-8 w-8 text-[11px]" : "h-11 w-11 text-sm";
  if (account?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.avatarUrl}
        alt=""
        className={cn("rounded-full object-cover ring-1 ring-white/15", box)}
      />
    );
  }
  if (!account) {
    return (
      <span
        aria-hidden
        className={cn("flex items-center justify-center rounded-full bg-white/8 text-muted", box)}
      >
        <UserRound className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-accent to-strength font-bold text-accent-foreground ring-1 ring-white/15",
        box
      )}
    >
      {initialsFor(account.name)}
    </span>
  );
}

/**
 * Its own component so `useDialog` mounts with the sheet: focus moves in on
 * open, Tab is trapped, Escape closes, and focus returns to the avatar after.
 */
function AccountSheet({
  account,
  onClose,
}: {
  account: AccountSummary | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { dialogRef, dialogProps } = useDialog(onClose, { label: "Account" });
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await signOutEverywhere();
    router.push("/");
    router.refresh();
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <motion.div
        id="account-menu-sheet"
        ref={dialogRef}
        {...dialogProps}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: "spring", bounce: 0.1, duration: 0.3 }}
        className="mode-content absolute right-0 top-12 z-50 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 glass-strong shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
      >
        <Link
          href="/profile"
          onClick={onClose}
          className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 transition-colors hover:bg-white/5"
        >
          <Avatar account={account} size="md" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {account?.name || "Your profile"}
            </span>
            <span className="block truncate text-xs text-muted">
              {account?.email || "Signed in"}
            </span>
          </span>
        </Link>

        <nav aria-label="Account" className="p-2">
          {ACCOUNT_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
                  active ? "bg-white/8" : "hover:bg-white/5"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-accent/15 text-accent" : "bg-white/5 text-muted"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="block text-[11px] leading-snug text-muted">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-muted transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
              <LogOut className="h-4 w-4" aria-hidden />
            </span>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </motion.div>
    </>
  );
}
