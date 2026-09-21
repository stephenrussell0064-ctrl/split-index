import type { Metadata } from "next";
import { jsonLdScript } from "@/lib/utils/json-ld";
import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { getAppUrl } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";
import { mainContentProps } from "@/lib/a11y/main-content";

const PAGE_TITLE = "How Scoring Works";
const PAGE_DESCRIPTION =
  "How Split Index gives every session two scores — one against the population's standards and one against your own recent training — plus strength via DOTS/IPF GL, race predictions via a personalized Riegel exponent, and injury risk via ACWR.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    "personal fitness score",
    "heart rate adjusted pace",
    "grade adjusted pace",
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
  { id: "two-scores", label: "Every session gets two scores" },
  { id: "fitness-equivalent", label: "The one number both scores read" },
  { id: "effort", label: "How hard you were working" },
  { id: "conditions", label: "Hills, weather and bodyweight" },
  { id: "personal-score", label: "The score against yourself" },
  { id: "without-hr-data", label: "Without heart-rate data" },
  { id: "trimp", label: "TRIMP" },
  { id: "efficiency-factor", label: "Efficiency factor" },
  { id: "decoupling", label: "Decoupling" },
  { id: "dots-gl", label: "Strength Index: DOTS and IPF GL" },
  { id: "age-grading", label: "Age grading" },
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
      "Heart-rate-adjusted performance scoring",
      "Personal-baseline fitness comparison",
      "DOTS and IPF GL strength scoring",
      "Acute:Chronic Workload Ratio injury risk",
    ],
  };

  return (
    <div className="min-h-dvh bg-[#050508] text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleJsonLd) }}
      />
      <header className="border-b border-white/[0.06] glass-strong pt-[max(1rem,env(safe-area-inset-top))]">
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

      <main {...mainContentProps} className="mx-auto max-w-3xl px-6 py-12">
        <article className="glass-strong rounded-2xl border border-white/[0.08] p-8 md:p-10">
          <header className="mb-8 border-b border-white/[0.06] pb-8">
            <h1 className="text-3xl font-bold tracking-tight">How Scoring Works</h1>
            <p className="mt-2 text-sm text-muted">
              The methodology behind every number Split Index shows you — the two scores every
              session gets, DOTS/IPF GL strength, personalized race predictions, and ACWR injury
              risk.
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

            <section id="two-scores">
              <h2 className="text-lg font-semibold text-foreground">Every session gets two scores</h2>
              <p className="mt-3">
                One number cannot answer both of the questions you have about a session. &quot;Was
                that any good?&quot; and &quot;was that any good <em>for me</em>?&quot; have
                different answers, and forcing them into one number is how a scoring engine ends up
                telling you nothing: your standing against everyone else barely moves between a good
                easy run and a bad one, so a single score that tracks it barely moves either.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <strong>vs everyone</strong> — this session measured against calibrated
                  population standards for your sex and age. It is what the Engine Index, the Lab
                  Index and the leaderboards are built from, and it moves slowly on purpose.
                </li>
                <li>
                  <strong>vs you</strong> — the same session measured against your own recent
                  sessions in that sport, at a comparable heart rate. 50.0 is your normal. Above it
                  is a better day than usual, below it a worse one. This is the number that actually
                  moves when a session goes well or badly.
                </li>
              </ul>
              <p className="mt-3">
                The second one needs three comparable sessions in the last 90 days before it says
                anything. Until then it reads &quot;calibrating&quot; rather than inventing a
                middle.
              </p>
              <p className="mt-3">
                What neither score reads is the session type you tagged it with. Easy, tempo, race
                — the tag says what you intended, your heart rate says what happened, and only the
                second of those is evidence. An identical session scores identically under every
                tag.
              </p>
            </section>

            <section id="fitness-equivalent">
              <h2 className="text-lg font-semibold text-foreground">The one number both scores read</h2>
              <p className="mt-3">
                Both scores come from a single intermediate figure: the time this session implies
                you could post at your sport&apos;s benchmark distance — 5 km running, 2 km rowing,
                400 m swimming, 20 km cycling, 2 km SkiErg, or per-kilometre pace for a walk — had
                it been a maximal effort, on flat ground, in comfortable conditions.
              </p>
              <p className="mt-3">Building it takes five steps, in this order:</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>Project the session to the benchmark distance (Riegel&apos;s formula, with your own exponent when there is enough evidence for one).</li>
                <li>Take out the time the hills cost you.</li>
                <li>Take out the time the heat or the cold cost you.</li>
                <li>On an erg, re-reference the time to the bodyweight the standards assume.</li>
                <li>Scale for how hard you were working.</li>
              </ol>
              <p className="mt-3">
                The same figure anchors your race predictions, which is why a well-executed easy run
                predicts sensible race times instead of stretching its deliberately slow pace out to
                a marathon.
              </p>
            </section>

            <section id="effort">
              <h2 className="text-lg font-semibold text-foreground">How hard you were working</h2>
              <p className="mt-3">
                Your average heart rate is read as a fraction of your own heart-rate reserve — the
                range between your resting and maximum heart rates — not as an absolute number. 150
                bpm is an easy jog for one athlete and near-threshold for another, and the engine
                should not confuse the two.
              </p>
              <p className="mt-3">
                What your heart rate is compared against is the intensity a maximal effort{" "}
                <em>of that session&apos;s own length</em> would be held at — not a fixed number. A
                maximal 20-minute effort sits near 92% of your reserve; a maximal 90-minute one
                nearer 84%. Judging a 95-minute run against a 20-minute bar reads it as far easier
                than it was, and used to hand long steady runs a much larger advantage over shorter,
                faster ones than they had earned.
              </p>
              <p className="mt-3">
                A session run below that bar implies you could have gone faster, so it earns credit.
                A session at or above it earns none and is never penalised: the average heart rate
                of an all-out 5 km always sits well below your true maximum, because heart rate
                ramps over minutes, and that gap is the effort rather than unused reserve.
              </p>
              <p className="mt-3">
                How much pace a gap in effort buys is not constant either. Easing off buys
                proportionally more the further below race intensity you already are, so the
                conversion eases from about 2.2 at race-pace efforts to about 1.3 at easy-pace ones.
                That is Daniels&apos; own pace table&apos;s shape, and it matters because easy pace
                is not one pace: people run easy anywhere between 4:00 and 7:00 per kilometre, and a
                model that reads every second of that spread as fitness over-reads it.
              </p>
              <p className="mt-3">
                How much pace a given gap in effort buys depends on the sport, and the difference is
                large. On an erg, in the pool and on a bike, power rises with the <em>cube</em> of
                speed, so 20% more effort is only about 6% more speed. On the road the relationship
                is much more direct. Scoring a rowing piece with running&apos;s conversion is what
                used to let a steady 6 km row read as a near-elite 2 km.
              </p>
              <p className="mt-3">
                There is no ceiling on what an easy run can be worth. Through the whole range that
                has actually been measured, the credit is simply what the physiology says, so an
                outstandingly well-executed easy run scores like one instead of stopping at an
                arbitrary limit. Past that range the credit tapers, because beyond it the estimate
                is a guess rather than a reading, and the session&apos;s confidence falls away over
                the same stretch to say so. It never stops rising, so two sessions at different
                heart rates always score differently however easy both of them were.
              </p>
              <p className="mt-3">
                Rowing, the SkiErg, swimming and cycling are damped sooner, and the reason is their
                scoring tables rather than their physiology. Erg pace compresses a wide range of
                fitness into a narrow band of time, so a few percent is worth hundreds of points
                there where the same few percent is worth tens on the road.
              </p>
              <p className="mt-3">
                Walking is deliberately left unscaled: its economy changes sharply with speed and it
                is rarely a maximal effort, so a low heart rate on a stroll is not evidence of a
                fast benchmark walk.
              </p>
            </section>

            <section id="conditions">
              <h2 className="text-lg font-semibold text-foreground">Hills, weather and bodyweight</h2>
              <p className="mt-3">
                These adjust the score itself, not a separate secondary metric — the same pace on a
                hilly, hot day is a better performance than on flat ground in comfortable air, and
                the score should say so.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                <li>
                  <strong>Hills</strong> — only total ascent is recorded, so a route is treated as a
                  loop: what goes up comes back down. The net cost is roughly 2% of your time per
                  10 m of climb per kilometre for running, less for walking and cycling, nothing on
                  an erg or in a pool. It saturates, so each further metre of climb is worth
                  slightly less than the last.
                </li>
                <li>
                  <strong>Weather</strong> — credited above about 15°C and below about 5°C, in both
                  directions and for outdoor sports only. Cycling carries a slightly larger cold
                  adjustment than running, because wind chill scales with speed.
                </li>
                <li>
                  <strong>Bodyweight</strong> — applied to rowing and SkiErg only, where the machine
                  carries your mass and the standards assume a reference weight. It uses the same
                  relationship Concept2&apos;s own weight adjustment does. Running, cycling and
                  swimming have no accepted weight grading, so none is invented for them.
                </li>
              </ul>
            </section>

            <section id="personal-score">
              <h2 className="text-lg font-semibold text-foreground">The score against yourself</h2>
              <p className="mt-3">
                Your baseline is the recency-weighted median of your own recent sessions in that
                sport, each read through the same five steps above. A median rather than an average,
                so one mis-logged session or one race does not redefine what counts as normal for
                you; weighted by recency, halving every 30 days, so this month&apos;s form counts
                for more than a block you finished six weeks ago.
              </p>
              <p className="mt-3">
                Sessions are compared at a comparable heart rate. Your recovery jogs are judged
                against your recovery jogs and your tempos against your tempos, so a recovery jog
                does not permanently read as a terrible day and a tempo does not permanently read as
                a breakthrough. When you have not done a session at that intensity lately, the
                comparison stretches across intensities and says so.
              </p>
              <p className="mt-3">
                Roughly 1% of performance is worth 2 points on the 0–100 scale, and the scale
                compresses smoothly at the extremes, so a genuine breakthrough still reads higher
                than a merely good day without either of them pinning to the top.
              </p>
              <p className="mt-3">
                Your lifts work the same way: each one is scored against published strength standards
                for your sex, age and bodyweight, and separately against your own recent sessions of
                that lift, using your best set from each session rather than every set — warm-ups
                and back-off sets say nothing about what you could manage that day.
              </p>
            </section>

            <section id="without-hr-data">
              <h2 className="text-lg font-semibold text-foreground">Without heart-rate data</h2>
              <p className="mt-3">
                If the session has no heart rate but you rated your effort, that rating is used
                instead. It is a rougher signal than a measurement, so the session is scored with
                visibly lower confidence, and it is never preferred over a real heart-rate reading
                when both exist.
              </p>
              <p className="mt-3">
                With neither, the session is scored on pace alone. That is honest rather than
                generous: nothing is assumed about how hard you were working, so an easy run reads as
                the modest performance its pace shows. The fix is a heart-rate strap or an effort
                rating, and the session says which is missing.
              </p>
              <p className="mt-3">
                Sessions recorded with and without heart rate are never compared against each other
                in your personal score, since one carries effort credit the other cannot. When there
                are too few of the same kind to form a baseline, the comparison widens to everything
                and tells you it has.
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

            <section id="fitness-estimates">
              <h2 className="text-lg font-semibold text-foreground">Lactate threshold and VO2max</h2>
              <p className="mt-3">
                Neither of these is a lab measurement — no consumer wearable measures actual blood
                lactate or gas exchange. Both are estimated from your own logged training.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Lactate threshold</strong> uses your own
                sessions explicitly tagged &quot;Threshold&quot; or &quot;Tempo&quot; — sustained
                efforts of 15 to 70 minutes. Races are deliberately excluded: a 5K sits near your
                VO2max effort, a marathon sits well below threshold, and mixing the two in would
                corrupt the estimate. The average heart rate and pace across your most recent
                (up to 3) qualifying sessions becomes the reading — more sessions means higher
                confidence, not a different number.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">VO2max</strong> uses Jack Daniels and Jimmy
                Gilbert&apos;s published VDOT formula, applied to your most recent logged race, or
                your predicted 5K time if you haven&apos;t logged a race recently. VDOT corrects
                for how long an effort was sustained, which is why it&apos;s calculated from a
                genuine hard effort rather than an easy run — feeding it an easy pace would read
                as a much lower fitness level than you actually have.
              </p>
            </section>

            <section id="one-rm">
              <h2 className="text-lg font-semibold text-foreground">
                Your two 1RMs: all-time best and current
              </h2>
              <p className="mt-3">
                &quot;My one-rep max&quot; means two different things depending on when you ask, so
                you get both rather than one number pretending to be both.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">All-time best</strong> is the heaviest single
                rep your logged sets have ever implied. It is a high-water mark: a bad session, a
                deload or six months off cannot lower it. Only beating it moves it.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Current 1RM</strong> is what your recent
                training says you could do today. Each session counts by how recently it happened,
                with a three-week half-life — a session from six weeks ago carries about a quarter
                of the weight of one logged today. So it rises when you train well and falls when
                you train worse, which is exactly what an all-time best must never do. Three weeks
                is our estimate rather than a measured constant: it sits inside the two-to-four
                weeks after which detraining studies start to see measurable strength loss, and
                roughly matches the length of a training block.
              </p>
              <p className="mt-3">
                Each session is read by its best set, so warm-ups and back-off sets never make a
                good day look like a bad one. Neither number is stored — both are recalculated from
                your logged sets, so correcting a mis-typed session corrects them too.
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

            <section id="age-grading">
              <h2 className="text-lg font-semibold text-foreground">Age grading</h2>
              <p className="mt-3">
                A 50-year-old and a 25-year-old lifting the same weight, or running the same time,
                have not done equally hard things. Age grading is how that gets accounted for, and
                the mechanism matters: <strong className="text-foreground">your own numbers are
                never touched</strong>. Your lift, your bodyweight ratio, your finish time and your
                race predictions are exactly what you did. What moves is the standard you are
                judged against.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Endurance</strong> uses the established
                age-grading approach: your benchmark-equivalent time is compared against an
                age-adjusted standard rather than the open-class one, the same way published
                age-graded tables work. Under 36 the factor is exactly 1.0 — nothing is applied,
                and nothing is shown. Where it does apply, you are shown the exact figure: how
                much more lenient your standard is, and the factor behind it. Your predicted race
                times are never graded — those stay the real times you would have to run.
              </p>
              <p className="mt-3">
                <strong className="text-foreground">Strength</strong> works the same way — the
                anchor your ratio is measured against is eased by the age factor — and it covers
                both ends of the curve: juniors from 14 up, flat through the 23–35 peak, then a
                gentle masters climb. Where the factor is applied, the exact figure is shown to you
                on the lift.
              </p>
              <p className="mt-3">
                The strength curve is marked <strong className="text-foreground">beta</strong>, and
                that label is meant literally. The junior half comes from published Foster
                coefficients, but the masters half is our own estimate derived from a
                strength-by-age chart rather than a calibration against population data, and the
                two halves do not even agree on where the peak ends. We would rather show you the
                adjustment and tell you it is provisional than apply it silently or claim an
                accuracy it has not earned. Any lift carrying it is labelled beta.
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
