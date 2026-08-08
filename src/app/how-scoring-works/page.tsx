import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { getAppUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";

const PAGE_TITLE = "How Scoring Works";
const PAGE_DESCRIPTION =
  "How Split Index scores easy/recovery/long sessions via personalized heart-rate zones, strength via DOTS/IPF GL, race predictions via a personalized Riegel exponent, and injury risk via ACWR — not generic population formulas.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    "Riegel formula",
    "race time prediction",
    "personalized heart rate zones",
    "DOTS strength score",
    "IPF GL",
    "ACWR injury risk",
    "acute chronic workload ratio",
    "VDOT",
    "training load",
  ],
  alternates: {
    canonical: "/how-scoring-works",
  },
  openGraph: {
    title: `${PAGE_TITLE} — Split Index`,
    description: PAGE_DESCRIPTION,
    type: "article",
    url: "/how-scoring-works",
    images: [{ url: "/splitindex-logo.png", width: 960, height: 240, alt: "Split Index" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${PAGE_TITLE} — Split Index`,
    description: PAGE_DESCRIPTION,
    images: ["/splitindex-logo.png"],
  },
};

const TOC = [
  { id: "generic-vs-personalized", label: "Why generic predictions fall short" },
  { id: "easy-runs-scored-differently", label: "Why easy runs are scored differently" },
  { id: "personalized-hr-zones", label: "Your personalized heart-rate zones" },
  { id: "credit-and-penalty", label: "Credit and penalty" },
  { id: "noisy-readings", label: "Guarding against noisy readings" },
  { id: "without-hr-data", label: "Without heart-rate data" },
  { id: "trimp", label: "TRIMP" },
  { id: "efficiency-factor", label: "Efficiency factor" },
  { id: "decoupling", label: "Decoupling" },
  { id: "dots-gl", label: "Strength Index: DOTS and IPF GL" },
  { id: "race-predictions", label: "Race predictions" },
  { id: "injury-risk", label: "Injury risk (ACWR)" },
] as const;

export default async function HowScoringWorksPage() {
  // This page is public (linked from search/marketing, sees anonymous
  // traffic) but is also linked from inside the signed-in app via every
  // ScoringExplainerNote — a logged-in visitor clicking back had no way
  // back INTO the app, only to the public marketing homepage (user
  // feedback: "there is no way back to get to home page"). Route signed-in
  // visitors to their dashboard, everyone else to the marketing homepage.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const backHref = user ? "/dashboard" : "/";
  const backLabel = user ? "Back to Split Index" : "Back to home";

  const appUrl = getAppUrl();
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: `${appUrl}/how-scoring-works`,
    publisher: {
      "@type": "Organization",
      name: "Split Index",
      url: appUrl,
      logo: `${appUrl}/splitindex-icon.png`,
    },
    about: [
      "Riegel race time prediction",
      "Personalized heart-rate-zone training",
      "DOTS and IPF GL strength scoring",
      "Acute:Chronic Workload Ratio injury risk",
    ],
  };

  return (
    <div className="min-h-dvh bg-[#050508] text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <header className="border-b border-white/[0.06] glass-strong">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BrandMark variant="compact" href={backHref} iconSize={30} wordmarkSize="sm" />
          <Link
            href={backHref}
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            {backLabel}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
          <header className="mb-8 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">How Scoring Works</h1>
            <p className="mt-2 text-sm text-muted">
              The methodology behind every number Split Index shows you — heart-rate-zone scoring,
              DOTS/IPF GL strength, personalized race predictions, and ACWR injury risk.
            </p>
          </header>

          <nav aria-label="Table of contents" className="mb-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/70">
              On this page
            </p>
            <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="text-muted transition-colors hover:text-foreground">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="prose-invert space-y-8 text-sm leading-relaxed text-muted">
            <section id="generic-vs-personalized">
              <h2 className="text-lg font-semibold text-foreground">Why generic predictions fall short</h2>
              <p className="mt-3">
                Most race-time calculators and fitness trackers predict your times with a single,
                fixed formula applied identically to every athlete — the same population-average
                exponent whether you&apos;re a sprinter-built 5K runner or an ultra-endurance
                specialist, and the same &quot;easy pace&quot; credit whether your heart rate that day
                was textbook-controlled or drifting toward your max. That&apos;s a reasonable default
                with zero data on you — but it stops being the best available estimate the moment
                real evidence about <em>your own</em> physiology exists.
              </p>
              <p className="mt-3">
                Split Index starts from the same published, standard formulas everyone else does —
                Riegel for race projections, DOTS/IPF GL for strength, ACWR for training load — but
                personalizes every one of them to your own logged history as soon as there&apos;s
                enough evidence to trust it, and is explicit about exactly when it&apos;s still
                falling back to a population default versus using your own data. The rest of this
                page is that methodology in full, not marketing copy — every constant and threshold
                named below is the real one the engine runs.
              </p>
            </section>

            <section id="easy-runs-scored-differently">
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

            <section id="personalized-hr-zones">
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

            <section id="credit-and-penalty">
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

            <section id="noisy-readings">
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

            <section id="without-hr-data">
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

            <section id="trimp">
              <h2 className="text-lg font-semibold text-foreground">TRIMP</h2>
              <p className="mt-3">
                TRIMP (Training Impulse) is a single number blending how long a session lasted
                and how hard your heart was working throughout it — a rough measure of a
                workout&apos;s total training &quot;cost,&quot; rather than a score of how well it
                went. A short, easy jog and a much longer one at the same intensity produce very
                different TRIMP values even though both might score similarly on effort quality.
              </p>
              <p className="mt-3">
                As a rough guide: under 50 reads as light, 50–100 as moderate, 100–150 as hard,
                and above 150 as very hard. A 45-minute easy run might land around 60–80
                (moderate); a hard interval session can push past 150. It uses the published
                Banister TRIMP formula (1991), weighted for your sex and heart-rate reserve.
              </p>
            </section>

            <section id="efficiency-factor">
              <h2 className="text-lg font-semibold text-foreground">Efficiency factor</h2>
              <p className="mt-3">
                Efficiency factor is how much speed (or power, for erg/bike sessions) you&apos;re
                getting per heartbeat — a rough proxy for aerobic fitness at a given effort. It has
                no fixed &quot;good&quot; or &quot;bad&quot; number: Split Index doesn&apos;t
                compare your efficiency factor against anyone else&apos;s, only against your own
                history. Trending upward over weeks at a similar effort means your aerobic
                fitness is genuinely improving; trending downward can be a sign of fatigue,
                illness, or detraining.
              </p>
              <p className="mt-3">
                Erg/bike sessions show this as watts per beat-per-minute; pace-based sessions
                (running, rowing, swimming without a power meter) show it as meters-per-minute per
                beat-per-minute — the two aren&apos;t on the same scale, so don&apos;t compare a
                power-based reading against a pace-based one.
              </p>
            </section>

            <section id="decoupling">
              <h2 className="text-lg font-semibold text-foreground">Decoupling</h2>
              <p className="mt-3">
                Decoupling compares your heart rate in the first half of a session against the
                second half, at a similar pace or power. A small amount of upward drift (your
                heart rate creeping higher for the same output) is normal, especially in heat or
                on longer efforts. A larger drift is a sign of fading aerobic durability or
                accumulated fatigue — even on a session that felt evenly paced throughout.
              </p>
            </section>

            <section id="dots-gl">
              <h2 className="text-lg font-semibold text-foreground">Strength Index: DOTS and IPF GL</h2>
              <p className="mt-3">
                A raw total (squat + bench + deadlift) rewards bodyweight above almost everything
                else — a heavier lifter and a lighter lifter can move very different loads for the
                same underlying strength. DOTS and IPF GL are published, sport-standard formulas
                that adjust your total against your own bodyweight, so it can be compared fairly
                against lifters of any size, or tracked meaningfully over time as your bodyweight
                changes.
              </p>
              <p className="mt-3">
                They&apos;re two independent formulas on two different scales — a DOTS score and a GL
                score for the same lift are not directly comparable to each other. Track each on its
                own axis over time rather than treating one as a conversion of the other.
              </p>
              <p className="mt-3">
                Accessory and isolation lifts (anything outside squat/bench/deadlift) aren&apos;t part
                of either formula — they&apos;re scored instead against ExRx bodyweight-ratio tiers, a
                separate published standard for judging relative strength on lifts DOTS/GL don&apos;t
                cover.
              </p>
            </section>

            <section id="race-predictions">
              <h2 className="text-lg font-semibold text-foreground">Race predictions</h2>
              <p className="mt-3">
                Predictions across distances use <strong>Riegel&apos;s formula</strong>
                {" "}— <em>T2 = T1 × (D2/D1)^k</em> — the standard, published approach for translating a
                known performance at one distance into a projected time at another. The exponent{" "}
                <strong>k</strong> represents how much your pace naturally falls off as distance
                increases; a generic population value (roughly 1.06) is the reasonable default for
                an athlete with no history yet.
              </p>
              <p className="mt-3">
                Once you&apos;ve logged enough races and hard efforts across a couple of different
                distances, Split Index fits <strong>k</strong> to your own pace curve instead —
                somewhere in a realistic 1.03–1.10 range — so the ladder reflects how your own
                endurance actually degrades with distance, not a stranger&apos;s average. A real race
                result at or near a benchmark distance is trusted close to fully; an inferred
                projection from a different distance or session type is blended in more cautiously,
                so one unusual session can&apos;t swing your prediction on its own.
              </p>
              <p className="mt-3">
                Predictions stay in a &quot;calibrating&quot; state until there&apos;s enough evidence logged
                to be worth showing — a single session isn&apos;t enough signal to project from
                confidently.
              </p>
            </section>

            <section id="injury-risk">
              <h2 className="text-lg font-semibold text-foreground">Injury risk (ACWR)</h2>
              <p className="mt-3">
                The Injury Risk Index is built on the{" "}
                <strong>Acute:Chronic Workload Ratio</strong> — your rolling 7-day training load
                divided by your rolling 28-day average weekly load. It&apos;s widely used in sports
                science as a proxy for whether recent training has spiked well above what your body
                has adapted to, which is when soft-tissue injury risk rises.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <strong>Below 0.8</strong> — Undertraining: recent load is well under your own
                  baseline.
                </li>
                <li>
                  <strong>0.8–1.3</strong> — Optimal: the well-supported sweet spot for building
                  fitness without spiking risk.
                </li>
                <li>
                  <strong>1.3–1.5</strong> — Caution: load is climbing meaningfully above your
                  baseline.
                </li>
                <li>
                  <strong>Above 1.5</strong> — Danger: a spike large enough that the research
                  literature links it to materially higher injury risk.
                </li>
              </ul>
              <p className="mt-3">
                This needs a real baseline to mean anything — with less than ~2 weeks of consistent
                logging, the 28-day window is mostly empty and the ratio collapses toward a fixed,
                meaningless extreme rather than reflecting genuine overreaching, so it&apos;s hidden
                until there&apos;s enough history behind it. If you log a morning HRV reading, it
                nudges the index further — a suppressed HRV relative to your own baseline raises the
                index a little beyond what load alone would say, since incomplete recovery is itself
                a risk signal independent of training volume.
              </p>
              <p className="mt-3">
                This is a training-load accountability tool, not a medical diagnosis — it reflects
                relative risk against your own history, not an absolute probability of injury.
              </p>
            </section>
          </div>

          <div className="mt-12 rounded-2xl border border-accent/20 bg-accent/[0.04] p-6 text-center sm:p-8">
            <p className="text-base font-semibold text-foreground">
              Want your own numbers scored this way?
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              If you&apos;re a runner or rower who&apos;s ever looked at a generic race-time
              calculator and thought &quot;that&apos;s not really how <em>my</em> pace holds up over
              distance&quot; — this is built for exactly that. Log a few sessions and Split Index
              starts fitting the methodology above to your own data.
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-flex items-center justify-center rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              Start free
            </Link>
          </div>
        </article>
      </main>
    </div>
  );
}
