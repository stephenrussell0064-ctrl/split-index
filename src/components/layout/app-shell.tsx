"use client";

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
  Zap,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { AppTopBar } from "@/components/layout/app-top-bar";

type AppMode = "neutral" | "gym" | "cardio";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mode: "neutral" as const },
  { href: "/gym", label: "The Lab", icon: Dumbbell, mode: "gym" as const },
  { href: "/cardio", label: "The Engine", icon: Activity, mode: "cardio" as const },
];

const secondaryNav = [
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/social", label: "Social", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

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
  const pathname = usePathname();
  const mode = resolveMode(pathname);
  const showTopBar = pathname !== "/onboarding";
  const logHref = logHrefForMode(mode);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <div className="min-h-screen" data-mode={mode}>
      <div
        className={cn(
          "mode-shell-bg min-h-screen transition-colors duration-700",
          mode === "neutral" && "bg-ambient"
        )}
      >
        <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-white/5 glass-strong lg:flex">
          <div className="flex items-center gap-3 px-6 py-6 border-b border-white/5">
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl",
                mode === "gym" && "bg-gym-accent/20",
                mode === "cardio" && "bg-cardio-accent/20",
                mode === "neutral" && "bg-accent/20"
              )}
            >
              <Zap
                className={cn(
                  "h-5 w-5",
                  mode === "gym" && "text-gym-accent",
                  mode === "cardio" && "text-cardio-accent",
                  mode === "neutral" && "text-accent"
                )}
              />
            </div>
            <div>
              <p className="font-semibold text-sm">Split Index</p>
              <p className="text-xs text-muted">
                {mode === "gym"
                  ? "The Lab · Strength"
                  : mode === "cardio"
                    ? "The Engine · Endurance"
                    : "Hybrid Analytics"}
              </p>
            </div>
          </div>

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

        <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/5 glass-strong px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
          {[...primaryNav, { href: logHref, label: "Log", icon: PlusCircle, mode }].map(
            (item) => {
              const active = isActive(item.href) || (item.label === "Log" && pathname.endsWith("/log"));
              const Icon = item.icon;
              const accentClass =
                "mode" in item && item.mode === "gym"
                  ? "text-gym-accent"
                  : "mode" in item && item.mode === "cardio"
                    ? "text-cardio-accent"
                    : "text-accent";

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] transition-colors min-w-0",
                    active ? accentClass : "text-muted"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label.split(" ")[0]}</span>
                </Link>
              );
            }
          )}
        </nav>

        <main className="lg:pl-64">
          <div className="mode-content mx-auto max-w-7xl px-4 py-6 pb-24 lg:px-8 lg:py-8 lg:pb-8">
            {showTopBar && <AppTopBar mode={mode} />}
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
