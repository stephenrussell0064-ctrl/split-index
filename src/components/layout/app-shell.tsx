"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Dumbbell,
  Activity,
  BarChart3,
  Users,
  Settings,
  PlusCircle,
  MoreHorizontal,
  Radar,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils/cn";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { EdgeSwipeBack } from "@/components/layout/edge-swipe-back";
import { ModeOverrideProvider, useModeOverride } from "@/components/layout/mode-override-context";
import { NativeBillingBootstrap } from "@/components/layout/native-billing-bootstrap";

type AppMode = "neutral" | "gym" | "cardio";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard, mode: "neutral" as const },
  { href: "/gym", label: "The Lab", shortLabel: "Lab", icon: Dumbbell, mode: "gym" as const },
  { href: "/cardio", label: "The Engine", shortLabel: "Engine", icon: Activity, mode: "cardio" as const },
];

const secondaryNav = [
  // First-class nav item for the Interference & Synergy Engine (interference
  // brief Part 5) — deliberately not a sub-tab under Analytics, since it's
  // the app's USP and needs to read as one everywhere in the product.
  { href: "/interference", label: "Interference", icon: Radar },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/social", label: "Social", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

// The main tab roots — every other page reached by drilling in (activity
// detail, edit forms, gps-run, a social profile, settings/billing, etc.)
// gets a back button in the top bar. Exact match, not prefix: /gym/log is
// reached by tapping "Log session" from The Lab, so it needs a back button
// too even though it shares the /gym prefix with the tab root itself.
const TOP_LEVEL_ROUTES = new Set<string>([
  ...primaryNav.map((item) => item.href),
  ...secondaryNav.map((item) => item.href),
]);

function resolveMode(pathname: string): AppMode {
  if (pathname.startsWith("/gym")) return "gym";
  if (pathname.startsWith("/cardio")) return "cardio";
  return "neutral";
}

function logHrefForMode(mode: AppMode): string {
  if (mode === "gym") return "/gym/log";
  if (mode === "cardio") return "/cardio/log";
  return "/activities/new";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ModeOverrideProvider>
      <AppShellContent>{children}</AppShellContent>
    </ModeOverrideProvider>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pathnameMode = resolveMode(pathname);
  const modeOverride = useModeOverride();
  // The pathname's own mode always wins when it has one (/gym, /cardio) —
  // the override only fills in for pages whose pathname can't encode a mode
  // (the generic log/edit activity forms, activity detail), themed off
  // whatever sport is currently selected/being viewed instead (see
  // mode-override-context.tsx). A `?zone=` query-param approach (read
  // synchronously via useSearchParams, no post-hydration delay) was tried
  // here first to close the flash-of-wrong-theme gap entirely, but
  // useSearchParams() in a component wrapping the whole app shell forces
  // every page under it out of static prerendering — broke the production
  // build on /activities/new. Reverted; see mode-override-context.tsx for
  // the (real, but narrower) useLayoutEffect fix that's in place instead.
  const mode = pathnameMode !== "neutral" ? pathnameMode : (modeOverride ?? "neutral");
  const showTopBar = pathname !== "/onboarding";
  const showBackButton = !TOP_LEVEL_ROUTES.has(pathname);
  const logHref = logHrefForMode(mode);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMoreOpen(false);
  }

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));

  return (
    // min-h-dvh, not min-h-screen (100vh): on mobile, 100vh locks to the
    // viewport height *before* the on-screen keyboard opens. Tapping an
    // input to type shrinks the real visible area without this container
    // resizing, leaving a stale dark gap below the fold where the page's
    // own background no longer covers it — exactly when a user is typing.
    // dvh (dynamic viewport height) tracks the real visible viewport.
    <div className="min-h-dvh" data-mode={mode}>
      <NativeBillingBootstrap />
      {/*
        Themed background lives on a FIXED, viewport-covering backdrop rather
        than on the growing content wrapper. A min-height wrapper's painted
        background could fail to cover the full document when content grew or
        repainted (e.g. focusing an input, async content loading, the mobile
        keyboard opening), leaving a dark gap below the fold where the page's
        dark body showed through — making the cardio light-theme inputs
        unreadable (dark text on the stale dark gap). A fixed element is
        glued to the viewport, so the themed colour always covers whatever is
        currently on screen, no matter the content height or scroll position.
      */}
      <div
        aria-hidden
        className={cn(
          "mode-shell-bg fixed inset-0 -z-10 transition-colors duration-700",
          mode === "neutral" && "bg-ambient"
        )}
      />
      <div className="min-h-dvh">
        <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-white/5 glass-strong lg:flex">
          <Link href="/dashboard" className="px-6 py-5 border-b border-white/5 block">
            <BrandMark variant="compact" iconSize={34} wordmarkSize="md" showTagline />
            <p className="mt-2.5 text-[11px] text-muted pl-[42px]">
              {mode === "gym"
                ? "The Lab · Strength"
                : mode === "cardio"
                  ? "The Engine · Endurance"
                  : "Hybrid Analytics"}
            </p>
          </Link>

          <nav className="flex-1 px-3 py-4 space-y-1">
            <p className="px-3 pb-2 micro-label text-muted/60">Train</p>
            {primaryNav.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              const accentClass =
                item.mode === "gym"
                  ? "text-gym-accent"
                  : item.mode === "cardio"
                    ? "text-cardio-accent"
                    : "text-accent";

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="nav-active-primary"
                      className={cn(
                        "absolute inset-0 rounded-xl border",
                        item.mode === "gym" &&
                          "bg-gym-accent/10 border-gym-accent/25 shadow-[0_0_24px_-8px_var(--gym-glow)]",
                        item.mode === "cardio" &&
                          "bg-cardio-accent/10 border-cardio-accent/25 shadow-[0_0_24px_-8px_var(--cardio-glow)]",
                        item.mode === "neutral" && "bg-white/8 border-white/10"
                      )}
                      transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                    />
                  )}
                  <Icon className={cn("relative h-4 w-4", active && accentClass)} />
                  <span className="relative">{item.label}</span>
                </Link>
              );
            })}

            <Link
              href={logHref}
              className={cn(
                "relative mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(logHref) || pathname.endsWith("/log")
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-white/5"
              )}
            >
              <PlusCircle className="h-4 w-4" />
              Log Workout
            </Link>

            <div className="my-4 border-t border-white/5" />
            <p className="px-3 pb-2 micro-label text-muted/60">Insights</p>
            {secondaryNav.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="nav-active-secondary"
                      className="absolute inset-0 rounded-xl bg-white/8 border border-white/10"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                    />
                  )}
                  <Icon className="relative h-4 w-4" />
                  <span className="relative">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <SidebarAccount />
        </aside>

        <AnimatePresence>
          {moreOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMoreOpen(false)}
                className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              />
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
                className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 rounded-2xl border border-white/10 glass-strong p-2 lg:hidden"
              >
                <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
                  <p className="micro-label text-muted/60">More</p>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    aria-label="Close menu"
                    className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {secondaryNav.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "text-foreground bg-white/8" : "text-muted hover:text-foreground hover:bg-white/5"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/5 glass-strong px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
          {[primaryNav[0], primaryNav[1]].map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            const accentClass =
              item.mode === "gym"
                ? "text-gym-accent"
                : item.mode === "cardio"
                  ? "text-cardio-accent"
                  : "text-accent";

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[10px] font-medium transition-colors",
                  active ? cn("bg-white/8", accentClass) : "text-muted"
                )}
              >
                <Icon className="h-6 w-6 shrink-0" />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            );
          })}

          <Link
            href={logHref}
            aria-label="Log workout"
            className={cn(
              "-mt-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95",
              mode === "gym"
                ? "bg-gym-accent text-gym-bg shadow-gym-accent/30"
                : mode === "cardio"
                  ? "bg-cardio-accent text-white shadow-cardio-accent/30"
                  : "bg-accent text-accent-foreground shadow-accent/30"
            )}
          >
            <PlusCircle className="h-7 w-7" />
          </Link>

          {[primaryNav[2]].map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            const accentClass = item.mode === "cardio" ? "text-cardio-accent" : "text-accent";

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[10px] font-medium transition-colors",
                  active ? cn("bg-white/8", accentClass) : "text-muted"
                )}
              >
                <Icon className="h-6 w-6 shrink-0" />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[10px] font-medium transition-colors",
              moreOpen || secondaryNav.some((item) => isActive(item.href))
                ? "bg-white/8 text-accent"
                : "text-muted"
            )}
          >
            <MoreHorizontal className="h-6 w-6 shrink-0" />
            <span className="truncate">More</span>
          </button>
        </nav>

        <main className="lg:pl-64">
          {/* calc(env(...) + gap) rather than a bare max() — the status bar height alone with no breathing room left the top bar sitting flush against the battery/signal icons; adding a fixed gap on top of the real inset (now resolvable at all thanks to viewport-fit: cover in layout.tsx) gives real clearance instead. A no-op on web where env() resolves to 0. */}
          <div className="mode-content mx-auto max-w-7xl px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-24 lg:px-8 lg:pb-8 lg:pt-[max(2rem,calc(env(safe-area-inset-top)+0.75rem))]">
            {showTopBar && <AppTopBar mode={mode} showBack={showBackButton} />}
            {/*
              No `mode="wait"` here on purpose: it forces the outgoing page to
              fully fade out (200ms) before the incoming one starts fading in
              (another 200ms), adding 400ms of dead time to every navigation
              on top of data-fetch latency. Letting them crossfade instead
              cuts that in half.
            */}
            <div className="relative">
              <AnimatePresence initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12, position: "absolute", top: 0, left: 0, right: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <EdgeSwipeBack enabled={showBackButton}>{children}</EdgeSwipeBack>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
