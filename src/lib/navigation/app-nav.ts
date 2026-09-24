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
  LayoutDashboard,
  PlusCircle,
  Radar,
  Settings,
  UserRound,
  Users,
} from "lucide-react";

/**
 * Every place the app can take you, described once, in plain English.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * User feedback: the app is "too difficult to navigate", and the biggest thing
 * putting people off is not knowing what anything is or where anything lives.
 * Three things were behind that, and all three are addressed from here:
 *
 *   1. The two main tabs were labelled with the product's own names — "The
 *      Lab" and "The Engine" — and a first-time user has no way to know that
 *      one is the gym and the other is running. The brand names are kept, but
 *      as the SECOND thing you read, under a word that says what it is.
 *
 *   2. The "More" menu was six bare icons with one-word labels. A menu entry
 *      called "Interference" tells you nothing. Every destination now carries a
 *      one-sentence description, and the menu shows it.
 *
 *   3. Three screens — the full logbook, your profile, and the athlete report —
 *      were not in any menu at all on a phone. You could only reach them by
 *      knowing which "View all" link to tap, or not at all.
 *
 * The shell's tab bar and sidebar, the More menu, and the in-app guide
 * (/help) all render from THIS list, so a label, a description and the guide's
 * explanation of it cannot drift apart. app-nav.test.ts checks that every entry
 * has a real page behind it and that every page gets the strict CSP.
 */

export type NavGroup =
  /** The bottom tab bar on a phone; the "Train" section of the sidebar. */
  | "primary"
  /** The More sheet on a phone; the "Insights" section of the sidebar. */
  | "insights"
  /** The bottom of the More sheet; the "Account" section of the sidebar. */
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
  /** Which colour theme this destination belongs to. Primary items only. */
  mode?: AppMode;
}

export const APP_NAV: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    shortLabel: "Home",
    description: "Your score, today's session, and what you could run or lift right now.",
    icon: LayoutDashboard,
    group: "primary",
    mode: "neutral",
  },
  {
    href: "/gym",
    label: "Strength",
    shortLabel: "Strength",
    brandName: "The Lab",
    description: "Your gym sessions, your best lifts, and your strength score.",
    icon: Dumbbell,
    group: "primary",
    mode: "gym",
  },
  {
    href: "/cardio",
    label: "Endurance",
    shortLabel: "Endurance",
    brandName: "The Engine",
    description: "Your runs, rides, rows and swims, and your endurance score.",
    icon: Activity,
    group: "primary",
    mode: "cardio",
  },
  {
    href: "/hybrid-plan",
    label: "Hybrid Plan",
    description: "A training block built for you, balanced between lifting and endurance.",
    icon: CalendarRange,
    group: "insights",
  },
  {
    href: "/recovery",
    label: "Recovery",
    description: "How ready you are to train hard today, and what is holding you back.",
    icon: HeartPulse,
    group: "insights",
  },
  {
    href: "/interference",
    label: "Interference",
    description: "Whether your lifting is slowing your running, or your running is costing you strength.",
    icon: Radar,
    group: "insights",
  },
  {
    href: "/analytics",
    label: "Analytics",
    description: "Charts of how your scores, volume and consistency have changed over time.",
    icon: BarChart3,
    group: "insights",
  },
  {
    href: "/activities",
    label: "Logbook",
    description: "Every session you have ever logged, in one list you can search and edit.",
    icon: BookOpen,
    group: "insights",
  },
  {
    href: "/reports",
    label: "Athlete report",
    description: "A summary of your trend, recovery and predictions, written to hand to a coach.",
    icon: FileText,
    group: "insights",
  },
  {
    href: "/social",
    label: "Social",
    description: "Friends, leaderboards, challenges and achievements.",
    icon: Users,
    group: "insights",
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
export const INSIGHTS_NAV = APP_NAV.filter((item) => item.group === "insights");
export const ACCOUNT_NAV = APP_NAV.filter((item) => item.group === "account");

/** Looks a pathname up in the list: exact match first, then the tab it sits under. */
export function navItemForPath(pathname: string): NavItem | undefined {
  return (
    APP_NAV.find((item) => item.href === pathname) ??
    APP_NAV.find((item) => item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
  );
}
