import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "How Scoring Works",
  description: "How Split Index scores easy, recovery, and long endurance sessions using personalized heart-rate zones.",
};

export default function HowScoringWorksPage() {
  return (
    <div className="min-h-screen bg-[#050508] text-foreground">
      <header className="border-b border-white/[0.06] glass-strong">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BrandMark variant="compact" href="/" iconSize={30} wordmarkSize="sm" />
          <Link
            href="/"
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
          <header className="mb-10 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">How Scoring Works</h1>
            <p className="mt-2 text-sm text-muted">
              Heart-rate-zone scoring for easy, recovery, and long sessions.
            </p>
          </header>

          <div className="prose-invert space-y-8 text-sm leading-relaxed text-muted">
            <section>
              <h2 className="text-lg font-semibold text-foreground">Why easy runs are scored differently</h2>
              <p className="mt-3">
                A race, tempo, or interval session is meant to test your absolute pace — so it&apos;s
                scored against a fixed pace-vs-benchmark table. An easy, recovery, or long session is
                designed to be run slow and controlled, at a deliberately low heart rate. Judging both
                on the same absolute scale means a well-executed easy run — one that&apos;s doing exactly
                what it&apos;s supposed to do — reads as a mediocre score. Split Index scores these session
                types differently: on how appropriate your effort was, not on raw pace.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Your personalized heart-rate zones</h2>
              <p className="mt-3">
                If you provide your <strong>resting heart rate</strong> and <strong>max heart rate</strong> (in
                onboarding or Settings), your easy/recovery/long sessions in running, rowing, swimming,
                cycling, and SkiErg are scored against zones built entirely from your own physiology —
                not a population average. Walking is excluded, since it&apos;s typically done at low,
                non-zone-driven intensity.
              </p>
              <p className="mt-3">The zones are built like this:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <strong>Base</strong> = your max HR − your resting HR. This is your aerobic floor.
                </li>
                <li>
                  Each <strong>zone</strong> spans 20% of your resting HR, stacked upward from base to
                  max HR — five zones in total.
                </li>
                <li>
                  <strong>Target</strong> = base + 30% of your resting HR. This sits in the lower half
                  of zone 2 — a textbook, well-paced easy effort.
                </li>
              </ul>
              <p className="mt-3">
                Worked example — max HR 207, resting HR 50:
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-xs">
                <li>Base = 207 − 50 = 157</li>
                <li>Zone 1: 157–167 · Zone 2: 167–177 · Zone 3: 177–187 · Zone 4: 187–197 · Zone 5: 197–207</li>
                <li>Target = 157 + (0.30 × 50) = 172</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Credit and penalty</h2>
              <p className="mt-3">
                Landing right at your target heart rate means you&apos;ve executed a genuinely good easy
                effort — so it earns a solid credit floor on its own, not a neutral, unrewarded score.
                From there, your average heart rate for the session shifts that credit further up or
                down:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <strong>At target</strong> — a flat credit floor, earned just for executing a
                  well-paced, well-controlled easy effort.
                </li>
                <li>
                  <strong>Below target</strong> — the lower your average HR (down to base), the more
                  credit is added on top of that floor, up to <strong>+10%</strong> more. A lower heart
                  rate at the same pace and distance means you&apos;re working less hard to produce the
                  same result — genuine efficiency.
                </li>
                <li>
                  <strong>Above target</strong> — the higher your average HR (up to max HR), the more
                  that floor is eroded, by up to <strong>−10%</strong>. Drifting toward your max HR on a
                  session tagged &quot;easy&quot; usually means overexertion, or the session wasn&apos;t
                  really easy.
                </li>
                <li>
                  Both effects clip at the base and max-HR boundaries — going even lower or higher
                  doesn&apos;t change the adjustment further.
                </li>
              </ul>
              <p className="mt-3">
                Elevation, temperature, distance, and pace still play a (smaller) role separately — a
                hilly or hot session still earns its own modest credit, on top of the heart-rate-zone
                adjustment above.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Guarding against noisy readings</h2>
              <p className="mt-3">
                Heart-rate monitors aren&apos;t perfect, and different activities can read differently for
                the same effort — rowing, for example, often reads lower than running at the same felt
                exertion. If your average HR reads at or below your base value, Split Index cross-checks
                it against your own typical easy-effort pace for that sport before granting the full
                bonus. If your pace doesn&apos;t back up an unusually easy effort, the credit is scaled back
                instead of applied in full — a single low reading can&apos;t award maximum credit on its
                own.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-foreground">Without heart-rate data</h2>
              <p className="mt-3">
                If a session has an average HR reading but you haven&apos;t set up personalized zones yet,
                it&apos;s scored against your own recent easy-effort history instead — still a real,
                evidence-based signal, just less precise than your personalized zones.
              </p>
              <p className="mt-3">
                If there&apos;s no heart-rate data at all for a session — no reading logged, and no
                history to compare against — Split Index assumes you executed it right at your target
                heart-rate zone (a well-paced, well-controlled easy effort) and scores it accordingly.
                This is a guess, not a measurement, so it&apos;s clearly flagged on the session, and it may
                not be accurate for that specific run.
              </p>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
