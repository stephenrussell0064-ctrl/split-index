"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PlusCircle, MoreHorizontal, X } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { mainContentProps } from "@/lib/a11y/main-content";
import { useDialog } from "@/components/ui/use-dialog";
import { cn } from "@/lib/utils/cn";
import {
  ACCOUNT_NAV,
  INSIGHTS_NAV,
  LOG_WORKOUT,
  PRIMARY_NAV,
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
 * WHERE THE NAVIGATION IS DEFINED — and why it is not here any more.
 *
 * The tab bar, the sidebar and the More sheet all used to carry their own
 * lists of links, labelled with the product's own names ("The Lab", "The
 * Engine") and nothing else. User feedback: the app is too difficult to
 * navigate, and nothing explains what anything is. Every destination now
 * lives in lib/navigation/app-nav.ts with a plain-English label and a
 * one-sentence description, and the in-app guide at /help is rendered from
 * the same list. This file only decides where each group is drawn.
 *
 * Recovery and Interference are first-class entries rather than sections of
 * Analytics on purpose — see the notes in app-nav.ts. The retired
 * /training-plan wizard 308s to /hybrid-plan from next.config.ts.
 */
const primaryNav = PRIMARY_NAV;
/** Everything on the phone's More sheet and in the sidebar below "Train". */
const secondaryNav: readonly NavItem[] = [...INSIGHTS_NAV, ...ACCOUNT_NAV];

// The main tab roots — every other page reached by drilling in (activity
// detail, edit forms, gps-run, a social profile, settings/billing, etc.)
// gets a back button in the top bar. Exact match, not prefix: /gym/log is
// reached by tapping "Log session" from The Lab, so it needs a back button
// too even though it shares the /gym prefix with the tab root itself.
//
// /help is the one menu destination that KEEPS its back button: it is also
// reached from the "?" beside every explained score, and "back to what I was
// reading" is the thing a person wants after a one-paragraph answer.
const TOP_LEVEL_ROUTES = new Set<string>(
  [...primaryNav, ...secondaryNav].map((item) => item.href).filter((href) => href !== "/help")
);

function resolveMode(pathname: string): AppMode {
  if (pathname.startsWith("/gym")) return "gym";
  if (pathname.startsWith("/cardio")) return "cardio";
  return "neutral";
}

/**
 * Where the + button goes: the launcher, always, from every tab.
 *
 * This used to resolve by mode — /gym/log from The Lab, /cardio/log from The
 * Engine, the launcher only from Home. The idea was that a tab already says
 * which half you are in, so the picker is a step you can skip. In practice it
 * made one control mean three different things depending on where you had
 * been, and the two zone-specific destinations are each half an app: tapping +
 * on The Engine could not reach a gym session, and tapping it on The Lab could
 * not start a GPS run. User report: "if you are on the engine and then click
 * the plus it should take you to [the launcher] rather than a cardio only log
 * screen."
 *
 * The launcher costs one tap and can reach everything — both halves of the
 * product and live GPS — so + is now the same promise everywhere.
 * /gym/log and /cardio/log are untouched and still reachable from The Lab and
 * The Engine's own buttons, which is where a zone-specific shortcut belongs.
 */
const LOG_LAUNCHER_HREF = LOG_WORKOUT.href;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ModeOverrideProvider>
      <AppShellContent>{children}</AppShellContent>
    </ModeOverrideProvider>
  );
}

/** One row of the More sheet: what it is, and one line on what you will find there. */
function MoreNavRow({
  item,
  active,
  onClose,
}: {
  item: NavItem;
  active: boolean;
  onClose: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClose}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
        active ? "bg-white/8" : "hover:bg-white/5"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-accent/15 text-accent" : "bg-white/5 text-muted"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm font-semibold", active ? "text-foreground" : "text-foreground/90")}>
          {item.label}
        </span>
        <span className="block text-xs leading-snug text-muted">{item.description}</span>
      </span>
    </Link>
  );
}

/**
 * The mobile "More" sheet.
 *
 * Its own component only so that `useDialog` mounts and unmounts with the
 * sheet — a hook cannot live inside the `{moreOpen && …}` it guards, and the
 * focus work has to happen on open, not on every render of the shell.
 *
 * What was wrong with it: it dimmed the whole viewport behind a backdrop, which
 * is a modal, and had none of a modal's behaviour. Focus stayed on the "More"
 * button in the tab bar, so the first Tab after opening went to whatever
 * followed that button rather than into the sheet; nothing stopped Tab
 * continuing off the end of the sheet into the page underneath the dim; Escape
 * did nothing; and it was announced as an anonymous group of links rather than
 * as a dialog. The X is labelled and reachable, so it was operable — it was the
 * ORIENTATION that was missing, which is the half a screenshot cannot show.
 *
 * And what was wrong with it after that: six one-word links. "Interference"
 * on its own is not a destination anyone can choose, and three whole screens
 * — the logbook, your profile and the athlete report — were not on it at all.
 * Every row now says what it is, and the sheet scrolls rather than clipping on
 * a small phone.
 */
function MoreNavSheet({
  onClose,
  isActive,
}: {
  onClose: () => void;
  isActive: (href: string) => boolean;
}) {
  const { dialogRef, dialogProps } = useDialog(onClose, { label: "More" });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
      />
      <motion.div
        id="more-nav-sheet"
        ref={dialogRef}
        {...dialogProps}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
        className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 flex max-h-[calc(100dvh-6rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] flex-col rounded-2xl border border-white/10 glass-strong lg:hidden"
      >
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <p className="text-sm font-semibold">Everything else</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-m-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-2 pt-0">
          {INSIGHTS_NAV.map((item) => (
            <MoreNavRow key={item.href} item={item} active={isActive(item.href)} onClose={onClose} />
          ))}
          <div className="my-1.5 border-t border-white/5" />
          {ACCOUNT_NAV.map((item) => (
            <MoreNavRow key={item.href} item={item} active={isActive(item.href)} onClose={onClose} />
          ))}
        </div>
      </motion.div>
    </>
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  // User feedback: "when clicking off the lab onto the dashboard or engine
  // whilst logging an activity, the logging page disappears and you have
  // to back on and do it again... when you click back on the lab it takes
  // you back to the page you left on." Tapping "Lab" always went to the
  // bare /gym tab root, not back to /gym/log where an in-progress log
  // actually lives — this remembers the last path visited under each
  // primary-nav section (plain in-memory state, not persisted — this
  // shell component stays mounted for the whole in-app session, the same
  // way a native tab bar keeps each tab's own navigation stack without
  // needing to write anything to disk) and routes the tab button there
  // instead of the bare root. Updated here, during render when pathname
  // actually changes — same "adjust state in response to a prop/pathname
  // change" pattern lastPathname/setMoreOpen right below already use,
  // deliberately not a useEffect (this project's own lint rule flags
  // setState-in-effect, and there's no real external system to
  // synchronize with here anyway).
  const [lastTabPaths, setLastTabPaths] = useState<Record<string, string>>({});
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMoreOpen(false);
    const match = primaryNav.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (match && lastTabPaths[match.href] !== pathname) {
      setLastTabPaths({ ...lastTabPaths, [match.href]: pathname });
    }
  }

  /** Where tapping this primary-nav tab actually goes — the last path visited under it, if any, so an in-progress log (or anything else mid-flow) is exactly where it was left rather than resetting to the tab's bare root. */
  const navHref = (item: NavItem) => lastTabPaths[item.href] ?? item.href;

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(href));

  /** The zone colour a primary tab lights up in when it is the current one. */
  const accentClassFor = (item: NavItem) =>
    item.mode === "gym"
      ? "text-gym-accent"
      : item.mode === "cardio"
        ? "text-cardio-accent"
        : "text-accent";

  /** One phone tab. Label at 11px, not 10 — the smallest size the app's own label style allows. */
  const tabLink = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={navHref(item)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-medium transition-colors",
          active ? cn("bg-white/8", accentClassFor(item)) : "text-muted"
        )}
      >
        <Icon className="h-6 w-6 shrink-0" aria-hidden />
        <span className="truncate">{item.shortLabel ?? item.label}</span>
      </Link>
    );
  };

  /** One sidebar entry: the plain label, and the product's own name for it beside it where there is one. */
  const sidebarLink = (item: NavItem, layoutId: string) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.group === "primary" ? navHref(item) : item.href}
        aria-current={active ? "page" : undefined}
        title={item.description}
        className={cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "text-foreground" : "text-muted hover:text-foreground hover:bg-white/5"
        )}
      >
        {active && (
          <motion.div
            layoutId={layoutId}
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
            <p className="px-3 pb-2 micro-label text-muted/60">Train</p>
            {primaryNav.map((item) => sidebarLink(item, "nav-active-primary"))}

            <Link
              href={logHref}
              title={LOG_WORKOUT.description}
              className={cn(
                "relative mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive(logHref) || pathname.endsWith("/log")
                  ? "text-foreground"
                  : "text-muted hover:text-foreground hover:bg-white/5"
              )}
            >
              <PlusCircle className="h-4 w-4" aria-hidden />
              {LOG_WORKOUT.label}
            </Link>

            <div className="my-4 border-t border-white/5" />
            <p className="px-3 pb-2 micro-label text-muted/60">Insights</p>
            {INSIGHTS_NAV.map((item) => sidebarLink(item, "nav-active-secondary"))}

            <div className="my-4 border-t border-white/5" />
            <p className="px-3 pb-2 micro-label text-muted/60">Account</p>
            {/* Profile is the account block at the foot of the sidebar, so it is not listed twice. */}
            {ACCOUNT_NAV.filter((item) => item.href !== "/profile").map((item) =>
              sidebarLink(item, "nav-active-secondary")
            )}
          </nav>

          <SidebarAccount />
        </aside>

        <AnimatePresence>
          {moreOpen && <MoreNavSheet onClose={() => setMoreOpen(false)} isActive={isActive} />}
        </AnimatePresence>

        <nav aria-label="Bottom tab bar" className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/5 glass-strong px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
          {[primaryNav[0], primaryNav[1]].map(tabLink)}

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

          {[primaryNav[2]].map(tabLink)}

          {/* A toggle that does not say whether it is open leaves a screen
              reader user tapping it to find out — and closing the sheet they
              had just opened. */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="more-nav-sheet"
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-medium transition-colors",
              moreOpen || secondaryNav.some((item) => isActive(item.href))
                ? "bg-white/8 text-accent"
                : "text-muted"
            )}
          >
            <MoreHorizontal className="h-6 w-6 shrink-0" aria-hidden />
            <span className="truncate">More</span>
          </button>
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
