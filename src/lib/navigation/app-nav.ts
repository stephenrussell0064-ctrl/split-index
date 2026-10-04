import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarRange,
  CircleHelp,
  Dumbbell,
  FileText,
  HeartPulse,
  House,
  PlusCircle,
  Radar,
  Settings,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";

/**
 * Every place the app can take you, described once, in plain English.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * User feedback, twice over: the app is "too difficult to navigate", and the
 * biggest thing putting new people off is not knowing what anything is or
 * where anything lives. The first pass at this gave every destination a plain
 * label and a one-line description. It was not enough, because the SHAPE of
 * the navigation was still wrong:
 *
 *   1. Half the tab bar was spent on two views of the same thing. "Strength"
 *      and "Endurance" were separate tabs, and each page already carried a
 *      toggle to the other — so one tab, Train, does the job of two and frees
 *      a slot for something that was buried.
 *
 *   2. The two features people pay for — the Hybrid Plan and the progress
 *      tools (Analytics, Recovery, Interference, the logbook, the report) —
 *      lived behind a "More" button. A popover list of nine rows is a place
 *      things go to be forgotten. The plan is now a tab of its own, and the
 *      progress tools have a real page, /progress, that shows a live number
 *      from each before you tap it.
 *
 *   3. Nothing on a phone offered Profile, Settings or Help in one tap. The
 *      account menu now hangs off the avatar in the top bar, everywhere.
 *
 * The shell's tab bar and sidebar, the Progress hub, the account menu and the
 * in-app guide (/help) all render from THIS list, so a label, a description
 * and the guide's explanation of it cannot drift apart. app-nav.test.ts checks
 * that every entry has a real page behind it and gets the strict CSP.
 */

export type NavGroup =
  /** The bottom tab bar on a phone; the top of the sidebar. */
  | "primary"
  /** The Progress hub's first section; the "Progress" section of the sidebar. */
  | "progress"
  /** The Progress hub's second section; the "Community" section of the sidebar. */
  | "community"
  /** The avatar menu in the top bar; the foot of the Progress hub and the sidebar. */
  | "account";

export type AppMode = "neutral" | "gym" | "cardio";

export interface NavItem {
  href: string;
  /** What it is, in a word or two. This is the label people see first. */
  label: string;
  /** The label on a phone's tab bar, where there is room for one short word. */
  shortLabel?: string;
  /** The product's own name for it, shown beside the plain label where there is room. */
  brandName?: string;
  /** One sentence saying what you will find there. Shown in menus and in the guide. */
  description: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Which colour theme this destination belongs to. */
  mode?: AppMode;
  /**
   * Other path prefixes this destination is "current" for. The Train tab is
   * the one that needs it: /train only ever redirects, and the pages the tab
   * actually shows live at /gym and /cardio.
   */
  matchPrefixes?: readonly string[];
}

/**
 * The two halves of Train. Not tabs any more — they are the segmented control
 * at the top of the Train tab — but they are destinations with pages, so they
 * are described here like everything else and the guide lists them.
 */
export const TRAIN_ZONES: readonly NavItem[] = [
  {
    href: "/gym",
    label: "Strength",
    brandName: "The Lab",
    description: "Your gym sessions, your best lifts, and your strength score.",
    icon: Dumbbell,
    group: "primary",
    mode: "gym",
  },
  {
    href: "/cardio",
    label: "Endurance",
    brandName: "The Engine",
    description: "Your runs, rides, rows and swims, and your endurance score.",
    icon: Activity,
    group: "primary",
    mode: "cardio",
  },
];

export const APP_NAV: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    shortLabel: "Home",
    description: "Your score, today's session, and what you could run or lift right now.",
    icon: House,
    group: "primary",
    mode: "neutral",
  },
  {
    href: "/train",
    label: "Train",
    shortLabel: "Train",
    description: "Strength and endurance side by side: your sessions, best efforts and both scores.",
    icon: Dumbbell,
    group: "primary",
    mode: "neutral",
    matchPrefixes: ["/gym", "/cardio"],
  },
  {
    href: "/hybrid-plan",
    label: "Plan",
    shortLabel: "Plan",
    brandName: "Hybrid Plan",
    description: "A training block built for you, balanced between lifting and endurance.",
    icon: CalendarRange,
    group: "primary",
    mode: "neutral",
  },
  {
    href: "/progress",
    label: "Progress",
    shortLabel: "Progress",
    description: "Every way of looking back at your training, and the people you train alongside.",
    icon: TrendingUp,
    group: "primary",
    mode: "neutral",
  },
  {
    href: "/analytics",
    label: "Analytics",
    description: "Charts of how your scores, volume and consistency have changed over time.",
    icon: BarChart3,
    group: "progress",
  },
  {
    href: "/recovery",
    label: "Recovery",
    description: "How ready you are to train hard today, and what is holding you back.",
    icon: HeartPulse,
    group: "progress",
  },
  {
    href: "/interference",
    label: "Interference",
    description: "Whether your lifting is slowing your running, or your running is costing you strength.",
    icon: Radar,
    group: "progress",
  },
  {
    href: "/activities",
    label: "Logbook",
    description: "Every session you have ever logged, in one list you can search and edit.",
    icon: BookOpen,
    group: "progress",
  },
  {
    href: "/reports",
    label: "Athlete report",
    description: "A summary of your trend, recovery and predictions, written to hand to a coach.",
    icon: FileText,
    group: "progress",
  },
  {
    href: "/social",
    label: "Social",
    description: "Friends, leaderboards, challenges and achievements.",
    icon: Users,
    group: "community",
  },
  {
    href: "/profile",
    label: "Profile",
    description: "Your details, experience level and goals.",
    icon: UserRound,
    group: "account",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Account, units, notifications, subscription, and sign out.",
    icon: Settings,
    group: "account",
  },
  {
    href: "/help",
    label: "Help & guide",
    description: "How the app is laid out and what every score means.",
    icon: CircleHelp,
    group: "account",
  },
];

/**
 * The + button. Not a nav item — it is a control that sits between the tabs —
 * but it is described here so the guide can explain it in the same words the
 * button uses.
 */
export const LOG_WORKOUT = {
  href: "/activities/new",
  label: "Log a workout",
  description:
    "Record a gym session, type in a run or ride you have already done, or start live GPS tracking.",
  icon: PlusCircle,
} as const;

export const PRIMARY_NAV = APP_NAV.filter((item) => item.group === "primary");
export const PROGRESS_NAV = APP_NAV.filter((item) => item.group === "progress");
export const COMMUNITY_NAV = APP_NAV.filter((item) => item.group === "community");
export const ACCOUNT_NAV = APP_NAV.filter((item) => item.group === "account");

/** Whether `pathname` is this destination or sits under it. */
export function navItemMatches(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.matchPrefixes ?? [])];
  return prefixes.some(
    (prefix) =>
      pathname === prefix ||
      // Home is exact: every other page would otherwise also be "under" it.
      (prefix !== "/dashboard" && pathname.startsWith(`${prefix}/`))
  );
}

/** Looks a pathname up in the list: exact match first, then the tab it sits under. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return (
    [...APP_NAV, ...TRAIN_ZONES].find((item) => item.href === pathname) ??
    APP_NAV.find((item) => navItemMatches(item, pathname))
  );
}
