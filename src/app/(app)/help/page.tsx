import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  ACCOUNT_NAV,
  INSIGHTS_NAV,
  LOG_WORKOUT,
  PRIMARY_NAV,
  type NavItem,
} from "@/lib/navigation/app-nav";

export const metadata: Metadata = {
  title: "Help & guide",
};

/**
 * The in-app guide: how the app is laid out, and what every number means, in
 * plain English.
 *
 * User feedback: the biggest thing putting people off is that the app is hard
 * to navigate and nothing explains itself. Before this page the only
 * explanation anywhere was /how-scoring-works — a public page about the maths,
 * written for search engines, with no link to it from inside the app.
 *
 * The "Getting around" section is rendered from lib/navigation/app-nav.ts, the
 * same list the tab bar and menus are drawn from, so the guide cannot describe
 * a destination differently from the menu that leads to it — and cannot miss
 * one (app-nav.test.ts checks). The score definitions below are the short
 * versions; each links to the full methodology for anyone who wants the
 * formulas.
 */
export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Help"
        title="Help & guide"
        subtitle="How the app is laid out, what every score means, and how to log a session."
      />

      <nav aria-label="On this page" className="flex flex-wrap gap-2 text-sm">
        {[
          ["#getting-around", "Getting around"],
          ["#scores", "What the scores mean"],
          ["#logging", "Logging a workout"],
          ["#support", "Still stuck?"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-11 items-center rounded-full border border-white/10 px-4 text-muted transition-colors hover:border-white/20 hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <section id="getting-around" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold">Getting around</h2>
        <p className="text-sm leading-relaxed text-muted">
          On a phone, five controls along the bottom of the screen take you everywhere. On a
          bigger screen the same things are listed down the left-hand side.
        </p>

        <ul className="space-y-2">
          {PRIMARY_NAV.map((item) => (
            <NavGuideRow key={item.href} item={item} />
          ))}
          <li>
            <Link
              href={LOG_WORKOUT.href}
              className="glass card-interactive flex items-center gap-4 rounded-2xl border border-white/[0.06] p-4 hover:border-white/[0.1]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <LOG_WORKOUT.icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">The + button</span>
                <span className="block text-sm leading-snug text-muted">{LOG_WORKOUT.description}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
          <li className="glass flex items-center gap-4 rounded-2xl border border-white/[0.06] p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted">
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">More</span>
              <span className="block text-sm leading-snug text-muted">
                Everything below, each with a line saying what it is.
              </span>
            </span>
          </li>
        </ul>

        <h3 className="pt-2 text-sm font-semibold uppercase tracking-wider text-muted">
          In the More menu
        </h3>
        <ul className="space-y-2">
          {INSIGHTS_NAV.map((item) => (
            <NavGuideRow key={item.href} item={item} />
          ))}
          {ACCOUNT_NAV.map((item) => (
            <NavGuideRow key={item.href} item={item} />
          ))}
        </ul>

        <p className="text-sm leading-relaxed text-muted">
          Wherever you are, the arrow at the top left takes you back, and the{" "}
          <span className="font-medium text-foreground">?</span> at the top right brings you here.
        </p>
      </section>

      <section id="scores" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold">What the scores mean</h2>
        <p className="text-sm leading-relaxed text-muted">
          Every score in the app is out of 100. Tap the small{" "}
          <span className="font-medium text-foreground">?</span> next to any of them for a one-line
          version of this.
        </p>

        <dl className="space-y-3">
          <Definition id="split-index" term="Split Index">
            Your strength and your endurance combined into one number. It is the headline on Home,
            it is worked out from the sessions you log, and it moves a little after every one. The
            word beside it — Beginner, Intermediate, Semi-Pro, Advanced, Elite or World Class — is
            the band the number falls into.
          </Definition>
          <Definition id="endurance-score" term="Endurance score (The Engine)">
            How your runs, rides, rows and swims compare with published standards for your age and
            sex. The app calls the endurance half of your training The Engine, which is why that
            word appears on the Endurance tab.
          </Definition>
          <Definition id="strength-score" term="Strength score (The Lab)">
            How your lifting compares with published strength standards for your bodyweight, age
            and sex, using your best sets. The strength half of your training is The Lab.
          </Definition>
          <Definition id="two-scores" term="“vs everyone” and “vs you”">
            Every session gets two scores. <em>vs everyone</em> is how that session rates against
            the standards above — it moves slowly, on purpose. <em>vs you</em> is how it rates
            against your own recent sessions of the same sport at a similar effort: 50 is your
            normal, above 50 is a better day than usual, below 50 a worse one. It needs three
            comparable sessions in the last 90 days before it will say anything.
          </Definition>
          <Definition id="recovery" term="Recovery score">
            How ready your body is to train hard today. High means go for it; low means an easy or
            rest day will do you more good. It is built from your recent training load, your
            heart-rate variability if you record it, how many days in a row you have trained, and
            any drinks you logged. Every input is shown on the Recovery page.
          </Definition>
          <Definition id="interference" term="Interference">
            When one kind of training gets in the way of the other — a heavy leg day slowing the run
            two days later, or a long run taking the edge off your squat. The Interference page
            looks at pairs of your own sessions that were close together and shows where that is
            happening, and where the two are helping each other instead.
          </Definition>
          <Definition id="race-predictions" term="Race predictions">
            What you could run right now for 1500 m, 5K, 10K, half marathon and marathon, worked
            out from the runs you have logged. The app needs five runs before it will show a time;
            until then it says it is calibrating rather than guessing. A long break makes the
            times drift slower, and the app tells you when that is why.
          </Definition>
          <Definition id="lift-predictions" term="Lift predictions">
            For squat, bench and deadlift: the heaviest single lift the app estimates you could do
            now, shown next to the heaviest set you have actually logged, so you can tell which is
            which.
          </Definition>
          <Definition id="streak" term="Streak and sessions this week">
            Your streak is the number of days in a row you have logged a session, counted up to
            today or yesterday, so a rest day today does not break it. The ring on Home counts the
            sessions you have logged this week against a target of four.
          </Definition>
        </dl>

        <p className="text-sm leading-relaxed text-muted">
          Want the formulas?{" "}
          <Link href="/how-scoring-works" className="font-medium text-accent underline-offset-4 hover:underline">
            How scoring works
          </Link>{" "}
          walks through every one of them.
        </p>
      </section>

      <section id="logging" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-semibold">Logging a workout</h2>
        <p className="text-sm leading-relaxed text-muted">
          Press the <span className="font-medium text-foreground">+</span> in the middle of the
          bottom bar. There are three ways to record a session:
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            <span className="font-medium text-foreground">Gym session.</span> Pick your exercises,
            then enter each set as you go. A rest timer runs between sets. Finish and the session
            is scored straight away.
          </li>
          <li>
            <span className="font-medium text-foreground">A run, ride, row or swim you have already
            done.</span> Type in the distance and time, and the heart rate if you have it. The more
            you give it, the better the score.
          </li>
          <li>
            <span className="font-medium text-foreground">Live GPS.</span> Start a run, ride or walk
            and the app tracks it as you go. You can lock your phone; tracking keeps going.
          </li>
        </ol>
        <p className="text-sm leading-relaxed text-muted">
          Half-finished logs are saved automatically, so switching tabs or closing the app does not
          lose them. Every session you have logged is in the Logbook, where it can be edited.
        </p>
      </section>

      <section id="support" className="scroll-mt-24 space-y-3">
        <h2 className="text-lg font-semibold">Still stuck?</h2>
        <p className="text-sm leading-relaxed text-muted">
          <Link href="/support" className="font-medium text-accent underline-offset-4 hover:underline">
            Contact support
          </Link>{" "}
          and say what you were trying to do — a screenshot helps. If something in the app is hard
          to see, read or operate, the{" "}
          <Link href="/accessibility" className="font-medium text-accent underline-offset-4 hover:underline">
            accessibility statement
          </Link>{" "}
          says what we know about and how to tell us about anything else.
        </p>
      </section>
    </div>
  );
}

/** One destination, as a row you can tap: the label, its product name if it has one, and what you will find there. */
function NavGuideRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        className="glass card-interactive flex items-center gap-4 rounded-2xl border border-white/[0.06] p-4 hover:border-white/[0.1]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-muted">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {item.label}
            {item.brandName && (
              <span className="font-normal text-muted"> · {item.brandName}</span>
            )}
          </span>
          <span className="block text-sm leading-snug text-muted">{item.description}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

function Definition({ id, term, children }: { id: string; term: string; children: React.ReactNode }) {
  return (
    <Card id={id} padding="sm" className="scroll-mt-24 rounded-2xl">
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-muted">{children}</dd>
    </Card>
  );
}
