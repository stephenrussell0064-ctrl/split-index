"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PlusCircle } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { mainContentProps } from "@/lib/a11y/main-content";
import { cn } from "@/lib/utils/cn";
import {
  ACCOUNT_NAV,
  COMMUNITY_NAV,
  LOG_WORKOUT,
  PRIMARY_NAV,
  PROGRESS_NAV,
  TRAIN_ZONES,
  navItemMatches,
  type AppMode,
  type NavItem,
} from "@/lib/navigation/app-nav";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { EdgeSwipeBack } from "@/components/layout/edge-swipe-back";
import { ModeOverrideProvider, useModeOverride } from "@/components/layout/mode-override-context";
import { NativeBillingBootstrap } from "@/components/layout/native-billing-bootstrap";
import { StatusBarModeSync } from "@/components/layout/status-bar-mode-sync";
import { PendingSyncBanner } from "@/components/activities/pending-sync-banner";

/*
 * WHERE THE NAVIGATION IS DEFINED — and why it is not here.
 *
 * Every destination lives in lib/navigation/app-nav.ts with a plain-English
 * label and a one-sentence description; the in-app guide at /help, the
 * Progress hub and the account menu render from the same list. This file only
 * decides where each group is drawn.
 *
 * THE SHAPE, AND WHY IT CHANGED
 * -----------------------------
 * The phone used to have Home · Strength · + · Endurance · More, with nine
 * destinations behind More. User feedback, after the labels had already been
 * made plain: still "too complicated to navigate", still impossible to tell
 * what exists. The labels were not the problem; the shape was. Strength and
 * Endurance each carried a toggle to the other, so two tab slots were doing
 * one job — and the features people pay for sat in a popover.
 *
 * It is now Home · Train · + · Plan · Progress:
 *
 *   Train     one tab for both halves; the toggle at the top of the page is
 *             the switch, and the tab remembers which half you were last in.
 *   Plan      the Hybrid Plan, promoted from the More sheet to a tab.
 *   Progress  a real page (/progress) that lists every retrospective and
 *             social feature with a live number, instead of a sheet of names.
 *
 * Profile, Settings and Help moved to an avatar menu in the top bar, which is
 * where every other app keeps them. The More sheet is gone.
 */
const primaryNav = PRIMARY_NAV;

// The tab roots and the two Train halves draw no back button — every other
// page is reached by drilling in from one of them (activity detail, the log
// forms, gps-run, a social profile, Analytics from the Progress hub, Settings
// from the avatar menu) and gets a back button in the top bar.
const TOP_LEVEL_ROUTES = new Set<string>([...primaryNav, ...TRAIN_ZONES].map((item) => item.href));

function resolveMode(pathname: string): AppMode {
  if (pathname.startsWith("/gym")) return "gym";
  if (pathname.startsWith("/cardio")) return "cardio";
  return "neutral";
}

/**
 * Where the + button goes: the launcher, always, from every tab.
 *
 * It used to resolve by mode — /gym/log from Strength, /cardio/log from
 * Endurance — which made one control mean three things depending on where you
 * had been, and each zone-specific destination could reach only half the
 * product. The launcher costs one tap and reaches everything, including live
 * GPS, so + is the same promise everywhere. /gym/log and /cardio/log are still
 * reachable from the Train pages' own buttons, where a zone shortcut belongs.
 */
const LOG_LAUNCHER_HREF = LOG_WORKOUT.href;

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
  const logHref = LOG_LAUNCHER_HREF;
  const [lastPathname, setLastPathname] = useState(pathname);
  // User feedback: "when clicking off the lab onto the dashboard or engine
  // whilst logging an activity, the logging page disappears and you have
  // to back on and do it again... when you click back on the lab it takes
  // you back to the page you left on." Tapping a tab always went to its bare
  // root, not back to where an in-progress log actually lives — this
  // remembers the last path visited under each primary tab (plain in-memory
  // state, not persisted — this shell stays mounted for the whole in-app
  // session, the same way a native tab bar keeps each tab's own navigation
  // stack) and routes the tab button there instead of the bare root. It is
  // also what makes the Train tab go back to whichever half — /gym or
  // /cardio — the athlete was last in, rather than through /train's redirect
  // every time. Updated during render when pathname changes — the same
  // "adjust state in response to a prop change" pattern as lastPathname
  // above, deliberately not a useEffect (this project's own lint rule flags
  // setState-in-effect, and there is no external system to synchronise with).
  // Seeded with the path the shell mounted on, not `{}`: the render-time
  // update below only fires when the pathname CHANGES, so a cold start on
  // /cardio (the native shell's launch, a deep link, a refresh) would
  // otherwise never be remembered, and Home → Train would send a runner back
  // through /train's redirect to /gym.
  const [lastTabPaths, setLastTabPaths] = useState<Record<string, string>>(() => {
    const mountedOn = primaryNav.find((item) => navItemMatches(item, pathname));
    return mountedOn ? { [mountedOn.href]: pathname } : {};
  });
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    const match = primaryNav.find((item) => navItemMatches(item, pathname));
    if (match && lastTabPaths[match.href] !== pathname) {
      setLastTabPaths({ ...lastTabPaths, [match.href]: pathname });
    }
  }

  /** Where tapping this primary tab actually goes — the last path visited under it, if any, so an in-progress log (or anything else mid-flow) is exactly where it was left rather than resetting to the tab's bare root. */
  const navHref = (item: NavItem) => lastTabPaths[item.href] ?? item.href;

  /**
   * Which tab is current. The Progress tab is also current on every page the
   * hub leads to — Analytics, Recovery, the Logbook, Social, Settings and the
   * rest — the way the More button used to light up for them. Without this,
   * nine screens had no current tab and no `aria-current` anywhere in the
   * nav. Deliberately NOT done with `matchPrefixes` on the Progress item: that
   * would also feed the tab memory, and tapping Progress from Analytics
   * should go back to the hub, not stay on Analytics.
   */
  const isActive = (item: NavItem) =>
    navItemMatches(item, pathname) ||
    (item.href === "/progress" &&
      [...PROGRESS_NAV, ...COMMUNITY_NAV, ...ACCOUNT_NAV].some((d) => navItemMatches(d, pathname)));

  /** The zone colour a tab lights up in when it is the current one. The Train tab takes the colour of whichever half is showing. */
  const accentClassFor = (item: NavItem) => {
    const itemMode = item.href === "/train" ? mode : item.mode;
    return itemMode === "gym"
      ? "text-gym-accent"
      : itemMode === "cardio"
        ? "text-cardio-accent"
        : "text-accent";
  };

  /** One phone tab. Label at 11px, not 10 — the smallest size the app's own label style allows. */
  const tabLink = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={navHref(item)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium transition-colors",
          active ? cn("bg-white/8", accentClassFor(item)) : "text-muted"
        )}
      >
        <Icon className="h-6 w-6 shrink-0" aria-hidden />
        <span className="truncate">{item.shortLabel ?? item.label}</span>
      </Link>
    );
  };

  /** One sidebar entry: the plain label, and the product's own name for it beside it where there is one. */
  const sidebarLink = (item: NavItem, href = item.href) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={href}
        aria-current={active ? "page" : undefined}
        title={item.description}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "text-foreground" : "text-muted hover:text-foreground hover:bg-white/5"
        )}
      >
        {active && (
          <motion.div
            layoutId="nav-active-sidebar"
            className={cn(
              "absolute inset-0 rounded-xl border",
              item.mode === "gym" &&
                "bg-gym-accent/10 border-gym-accent/25 shadow-[0_0_24px_-8px_var(--gym-glow)]",
              item.mode === "cardio" &&
                "bg-cardio-accent/10 border-cardio-accent/25 shadow-[0_0_24px_-8px_var(--cardio-glow)]",
              (item.mode === "neutral" || !item.mode) && "bg-white/8 border-white/10"
            )}
            transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
          />
        )}
        <Icon className={cn("relative h-4 w-4", active && item.mode && accentClassFor(item))} aria-hidden />
        <span className="relative">{item.label}</span>
        {item.brandName && (
          <span className="relative ml-auto text-[11px] font-normal text-muted">{item.brandName}</span>
        )}
      </Link>
    );
  };

  const sidebarSection = (label: string) => (
    <p className="px-3 pb-2 pt-4 micro-label text-muted/60">{label}</p>
  );

  const [home, train, plan, progress] = primaryNav;

  return (
    // min-h-dvh, not min-h-screen (100vh): on mobile, 100vh locks to the
    // viewport height *before* the on-screen keyboard opens. Tapping an
    // input to type shrinks the real visible area without this container
    // resizing, leaving a stale dark gap below the fold where the page's
    // own background no longer covers it — exactly when a user is typing.
    // dvh (dynamic viewport height) tracks the real visible viewport.
    <div className="min-h-dvh" data-mode={mode}>
      {/*
        The skip link for this <main> lives in the root layout, not here — one
        in each would put two of them back to back in the tab order, both
        pointing at the same place. What this file owns is the target: see
        `id="main-content"` and its tabIndex below.
      */}
      <NativeBillingBootstrap />
      <StatusBarModeSync mode={mode} />
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
        <aside className="mode-content fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-white/5 glass-strong pt-[env(safe-area-inset-top)] lg:flex">
          <Link href="/dashboard" className="px-6 py-5 border-b border-white/5 block">
            <BrandMark variant="compact" iconSize={34} wordmarkSize="md" showTagline />
            <p className="mt-2.5 text-[11px] text-muted pl-[42px]">
              {mode === "gym"
                ? "Strength · The Lab"
                : mode === "cardio"
                  ? "Endurance · The Engine"
                  : "Hybrid Analytics"}
            </p>
          </Link>

          <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {sidebarLink(home)}

            {sidebarSection("Train")}
            {/* The two halves as rows rather than one "Train" row: there is room, and a sidebar that says "Strength · The Lab" is itself the explanation a new user needs. */}
            {TRAIN_ZONES.map((zone) => sidebarLink(zone))}
            <Link
              href={logHref}
              title={LOG_WORKOUT.description}
              className={cn(
                "relative mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                pathname === logHref || pathname.endsWith("/log")
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-white/5"
              )}
            >
              <PlusCircle className="h-4 w-4" aria-hidden />
              {LOG_WORKOUT.label}
            </Link>

            {sidebarSection("Plan")}
            {sidebarLink(plan)}

            {sidebarSection("Progress")}
            {sidebarLink(progress)}
            {PROGRESS_NAV.map((item) => sidebarLink(item))}

            {sidebarSection("Community")}
            {COMMUNITY_NAV.map((item) => sidebarLink(item))}

            {sidebarSection("Account")}
            {/* Profile is the account block at the foot of the sidebar, so it is not listed twice. */}
            {ACCOUNT_NAV.filter((item) => item.href !== "/profile").map((item) => sidebarLink(item))}
          </nav>

          <SidebarAccount />
        </aside>

        <nav
          aria-label="Bottom tab bar"
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/5 glass-strong px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
        >
          {[home, train].map(tabLink)}

          <Link
            href={logHref}
            aria-label={LOG_WORKOUT.label}
            className={cn(
              "-mt-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95",
              mode === "gym"
                ? "bg-gym-accent text-gym-bg shadow-gym-accent/30"
                : mode === "cardio"
                  ? "bg-cardio-accent text-cardio-text shadow-cardio-accent/30"
                  : "bg-accent text-accent-foreground shadow-accent/30"
            )}
          >
            <PlusCircle className="h-7 w-7" aria-hidden />
          </Link>

          {[plan, progress].map(tabLink)}
        </nav>

        {/* tabIndex -1 so the skip link actually MOVES focus. Without it
            WebKit scrolls to the anchor and leaves focus in the nav, so the
            next Tab goes back to sidebar item two. */}
        {/*
          overflow-x-clip is a safety net for horizontal overflow, not a fix for
          it. Two screens have already had to be repaired one element at a time —
          an input[type=date] on the Hybrid Plan Goals tab, an unbounded exercise
          name on the social leaderboard — and each of those made the WHOLE page
          scroll sideways, because an overflowing child in normal flow drags its
          ancestors with it. This stops the next one reaching the athlete.

          CLIP, NOT HIDDEN, and the difference matters here. `overflow-x: hidden`
          makes this element a scroll container, and a scroll container breaks
          `position: sticky` inside it — which would silently unstick the
          "Score workout" bar in activity-form, the top bar in sport-form, and
          the gym page's aside. `overflow-x: clip` does the same clipping
          without becoming a scroll container, so all of those keep working.

          What it does NOT do: fix the overflow. Clipped content is content the
          athlete cannot reach, so a screen that trips this is still a bug —
          it just stops being an unusable one. no-sideways-scroll.test.ts is
          what actually catches the causes.

          Safari gained overflow:clip in 16. On iOS 15, the app's floor, this
          degrades to no protection rather than to broken sticky positioning,
          which is the right way round.
        */}
        <main {...mainContentProps} className="overflow-x-clip lg:pl-64 focus:outline-none">
          {/* calc(env(...) + gap) rather than a bare max() — the status bar height alone with no breathing room left the top bar sitting flush against the battery/signal icons; adding a fixed gap on top of the real inset (now resolvable at all thanks to viewport-fit: cover in layout.tsx) gives real clearance instead. A no-op on web where env() resolves to 0. */}
          {/*
            pb-28, not pb-24. The bottom nav measures ~101px on a phone with a
            home indicator (6 top padding + 8 button padding + 24 icon + 4 gap +
            12 label + 8 + 34 safe-area + border), and pb-24 is 96 — so the last
            few pixels of every page sat underneath it. Measured, not guessed.
          */}
          <div className="mode-content mx-auto max-w-7xl px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-28 lg:px-8 lg:pb-8 lg:pt-[max(2rem,calc(env(safe-area-inset-top)+0.75rem))]">
            {showTopBar && <AppTopBar mode={mode} showBack={showBackButton} />}
            {/*
              Renders nothing unless the app is holding a workout it has not
              managed to upload — which is almost never, so this costs no
              vertical space on a normal day. When it does appear it is above
              the page content deliberately: an athlete who thinks a run was
              lost needs to find out before they log it a second time.
            */}
            <PendingSyncBanner />
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
