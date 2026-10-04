import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { formatIndex } from "@/lib/utils/format";
import {
  ACCOUNT_NAV,
  COMMUNITY_NAV,
  LOG_WORKOUT,
  PROGRESS_NAV,
  type NavItem,
} from "@/lib/navigation/app-nav";

/**
 * The Progress hub's UI.
 *
 * A LIST OF LABELS IS NOT A MAP. The thing that made the old "More" sheet
 * useless was not that it was a popover — it was that every row said only what
 * it was called. This page's whole reason to exist is the right-hand column:
 * the logbook says how many sessions are in it and when the last one was, the
 * Social row says how many friends you have, the report row says it is paid
 * before you walk into a paywall. An athlete can tell from here which of these
 * pages has anything for them today.
 *
 * THE DESTINATIONS ARE NOT LISTED HERE. They come from PROGRESS_NAV,
 * COMMUNITY_NAV and ACCOUNT_NAV — the same list the tab bar, the account menu
 * and /help render from — so a label, a description and a destination cannot
 * drift between this page and the tab that leads to it, and a new destination
 * cannot be left off this page. All this file owns is which rows get a stat and
 * what that stat says. progress-hub.test.ts pins that.
 *
 * NO SEPARATE EMPTY STATE. A brand-new athlete sees this exact page with "TBC"
 * where the scores go and "No sessions yet" against the logbook, plus one line
 * pointing at the + button. An empty-state screen would have hidden the map
 * from the only people who actually need one.
 */

interface ProgressHubProps {
  /** All three on the stored 0–1000 scale; null when there is no scored session yet. */
  splitIndex: number | null;
  strengthIndex: number | null;
  enduranceIndex: number | null;
  sessionCount: number;
  /** ISO timestamp of the most recent non-draft session, or null. */
  lastSessionAt: string | null;
  friendCount: number;
  /** Showcase access — used ONLY to label the athlete report row, never to gate it. */
  premium: boolean;
}

export function ProgressHub({
  splitIndex,
  strengthIndex,
  enduranceIndex,
  sessionCount,
  lastSessionAt,
  friendCount,
  premium,
}: ProgressHubProps) {
  /*
   * One stat per destination, keyed by the destination's own href rather than
   * by position, so reordering the nav list cannot silently hand the logbook's
   * session count to Recovery. A destination with nothing live worth saying
   * (Recovery and Interference both explain themselves in a single number that
   * needs its own page to mean anything) is simply absent.
   */
  const stats: Record<string, React.ReactNode> = {
    "/activities":
      sessionCount > 0
        ? `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}${
            lastSessionAt
              ? ` · last ${formatDistanceToNow(new Date(lastSessionAt), { addSuffix: true })}`
              : ""
          }`
        : "No sessions yet",
    // Honest about the dependency rather than showing a chart count of zero:
    // the charts are drawn from logged sessions and have nothing to draw yet.
    ...(sessionCount === 0 ? { "/analytics": "From your first session" } : {}),
    ...(premium ? {} : { "/reports": <PremiumPill /> }),
    "/social": friendCount > 0 ? `${friendCount} ${friendCount === 1 ? "friend" : "friends"}` : "Add your first friend",
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Progress"
        title="Your progress"
        subtitle="Everything that looks back at your training, and the people you train alongside."
        help={
          <p>
            This page is the map of everything that looks backwards. Your three scores are at the
            top; underneath, each row leads to one way of reading your training — the charts, how
            recovered you are, whether your lifting and running are fighting each other, every
            session you have logged, and a report you can hand to a coach. The number beside each
            row tells you what is waiting in there before you tap it.
          </p>
        }
        helpHref="/help#getting-around"
      />

      <section aria-labelledby="your-scores" className="space-y-3">
        <h2 id="your-scores" className="micro-label text-muted">
          Your scores
        </h2>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <ScoreTile href="/analytics" label="Split Index" value={splitIndex} />
          <ScoreTile
            href="/gym"
            label="Strength"
            brandName="The Lab"
            value={strengthIndex}
            valueClassName="text-strength"
          />
          <ScoreTile
            href="/cardio"
            label="Endurance"
            brandName="The Engine"
            value={enduranceIndex}
            valueClassName="text-endurance"
          />
        </div>

        {sessionCount === 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm leading-relaxed text-muted">
              Log your first session and every page below starts filling in.
            </p>
            <Link href={LOG_WORKOUT.href} className={buttonVariants({ size: "sm" })}>
              {LOG_WORKOUT.label}
            </Link>
          </div>
        )}
      </section>

      {/*
        Two columns from `lg` up and one below it. The rows are self-contained —
        icon, label, sentence, stat — so they tile without needing to line up
        with their neighbour, and on a wide screen a single column would put
        the account rows most of a screen below the fold.
      */}
      <NavSection id="look-back" title="Look back" items={PROGRESS_NAV} stats={stats} twoUp />
      <NavSection id="community" title="Community" items={COMMUNITY_NAV} stats={stats} />
      <NavSection id="account" title="Account" items={ACCOUNT_NAV} stats={stats} />
    </div>
  );
}

/** One of the three headline numbers, linking to the page that explains it. */
function ScoreTile({
  href,
  label,
  brandName,
  value,
  valueClassName,
}: {
  href: string;
  label: string;
  brandName?: string;
  /** On the stored 0–1000 scale. `formatIndex` is the single rescale-to-display boundary. */
  value: number | null;
  valueClassName?: string;
}) {
  return (
    <Link
      href={href}
      className="glass card-interactive flex min-h-11 flex-col justify-between rounded-2xl border border-white/[0.06] p-3 hover:border-white/[0.1] sm:p-4"
    >
      <p className="micro-label text-muted">{label}</p>
      <p
        className={`index-display headline-tight mt-2 text-2xl font-bold sm:text-3xl ${
          value === null ? "text-muted" : (valueClassName ?? "")
        }`}
      >
        {value === null ? "TBC" : formatIndex(value)}
      </p>
      {/*
        The product's own name for the half, second and quieter — the plain word
        above is what people read first (app-nav.test.ts enforces that ordering
        on the nav list, and this strip should not contradict it). Hidden on the
        narrowest screens, where three tiles across leave about 110px and the
        "out of 100" that makes the number mean anything has to win.
      */}
      <p className="mt-1 text-[10px] leading-snug text-muted">
        {brandName && <span className="hidden sm:inline">{brandName} · </span>}out of 100
      </p>
    </Link>
  );
}

/** One titled group of destinations, rendered from the shared nav list. */
function NavSection({
  id,
  title,
  items,
  stats,
  twoUp = false,
}: {
  id: string;
  title: string;
  items: readonly NavItem[];
  stats: Record<string, React.ReactNode>;
  twoUp?: boolean;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="micro-label text-muted">
        {title}
      </h2>
      <ul className={twoUp ? "grid gap-2 lg:grid-cols-2" : "grid gap-2"}>
        {items.map((item) => (
          <NavHubRow key={item.href} item={item} stat={stats[item.href]} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One destination as a tappable row: what it is, what you will find there, and
 * what is in there right now.
 *
 * The stat wraps onto its own line below `sm` rather than being hidden there.
 * Hiding it would have removed the entire point of this page on the device the
 * app is mostly used on; `basis-full` plus `order-last` keeps it after the
 * chevron on a phone and pulls it back inline, right-aligned, from `sm` up —
 * one node, one rendering, no duplicated markup to fall out of step.
 */
function NavHubRow({ item, stat }: { item: NavItem; stat?: React.ReactNode }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        className="glass card-interactive flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/[0.06] p-4 hover:border-white/[0.1]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {item.label}
            {item.brandName && <span className="font-normal text-muted"> · {item.brandName}</span>}
          </span>
          <span className="block text-sm leading-snug text-muted">{item.description}</span>
        </span>
        {stat !== undefined && (
          <span className="order-last min-w-0 basis-full pl-14 text-xs leading-snug text-muted sm:order-none sm:basis-auto sm:pl-0 sm:text-right">
            {stat}
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/** Says a destination is paid BEFORE the tap, rather than after it. */
function PremiumPill() {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
      Premium
    </span>
  );
}
