import Link from "next/link";
import { ShieldAlert, TrendingUp, Layers, Award } from "lucide-react";
import { FREE_TIER_FEATURES, PREMIUM_TIER_FEATURES } from "@/lib/premium/features";
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT_GBP } from "@/lib/pricing/config";
import { Button } from "@/components/ui/button";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";

const OUTCOMES = [
  {
    icon: ShieldAlert,
    title: "Know when to back off",
    body: "Your Injury Risk Index tracks ACWR against your own training baseline, so a load spike shows up before it becomes an injury — not after.",
  },
  {
    icon: TrendingUp,
    title: "Know what you're capable of",
    body: "Race predictions built on Riegel's formula, personalized to your own pace curve across distances — not a generic, one-size-fits-all exponent.",
  },
  {
    icon: Layers,
    title: "See the whole picture",
    body: "One Split Index fusing Engine (cardio) and Lab (strength), backed by real trend history — not a single-sport snapshot that ignores half your training.",
  },
  {
    icon: Award,
    title: "Prove it",
    body: "DOTS, IPF GL, and published age-graded standards — evidence-based benchmarks you can defend, not an arbitrary points system.",
  },
] as const;

export function PricingSection() {
  return (
    <section id="pricing" className="border-t border-white/[0.06] bg-[#050605] px-6 py-24 md:px-[6vw]">
      <div className="mx-auto max-w-4xl text-center">
        <p className="landing-eyebrow text-gym-accent">Pricing</p>
        <h2 className="font-display text-3xl font-black text-white md:text-4xl">
          Start free. Upgrade when you&apos;re hooked.
        </h2>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
        {OUTCOMES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left"
          >
            <Icon className="h-5 w-5 text-gym-accent" />
            <p className="mt-3 font-display text-lg font-bold text-white">{title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/55">{body}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-8 grid max-w-4xl gap-6 md:grid-cols-2">
        <article className="landing-price-card">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/45">Free</p>
          <p className="font-display mt-3 text-5xl font-black text-white">
            £0
            <span className="text-base font-medium text-white/40">/mo</span>
          </p>
          <ul className="mt-8 space-y-3 text-left text-sm text-white/55">
            {FREE_TIER_FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-gym-accent">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="mt-8 block">
            <Button variant="outline" className="w-full border-white/15 bg-transparent text-white hover:bg-white/5">
              Get started
            </Button>
          </Link>
        </article>

        <article className="landing-price-card landing-price-card-premium">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.24em] text-gym-accent">Premium</p>
            <span className="rounded-full bg-gym-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#04120a]">
              Best value: annual
            </span>
          </div>
          <p className="font-display mt-3 text-5xl font-black text-white">
            £{PRICING.ANNUAL_GBP}
            <span className="text-base font-medium text-white/40">/yr</span>
          </p>
          <p className="mt-1 text-sm text-white/45">
            <span className="line-through opacity-60">£{PRICING.MONTHLY_GBP}/mo billed monthly</span>{" "}
            — just £{ANNUAL_MONTHLY_EQUIVALENT_GBP.toFixed(2)}/mo
          </p>
          <ul className="mt-8 space-y-3 text-left text-sm text-white/55">
            {PREMIUM_TIER_FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-gym-accent">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/signup" className="mt-8 block">
            <Button className="w-full bg-gym-accent font-bold text-[#04120a] hover:bg-gym-accent/90">
              Start free trial
            </Button>
          </Link>
          <p className="mt-4 text-center text-xs text-white/40">
            Also available monthly (£{PRICING.MONTHLY_GBP}/mo) or lifetime (£{PRICING.LIFETIME_GBP}, one-time) after signup.
          </p>
        </article>
      </div>
      <ScoreDisclaimer className="mx-auto mt-10 max-w-2xl text-center" variant="compact" />
    </section>
  );
}

export function CtaStrip() {
  return (
    <section className="grid md:grid-cols-2">
      <Link
        href="/signup"
        className="group flex flex-col items-center justify-center gap-2 bg-gym-bg px-8 py-16 text-center transition hover:bg-[#0a0d0b]"
      >
        <p className="landing-eyebrow text-gym-accent">The Lab</p>
        <p className="font-display text-2xl font-black text-gym-text group-hover:text-gym-accent">
          Enter the Lab →
        </p>
      </Link>
      <Link
        href="/signup"
        className="group flex flex-col items-center justify-center gap-2 bg-cardio-bg px-8 py-16 text-center transition hover:bg-[#eef6ff]"
      >
        <p className="landing-eyebrow text-[#0B69C7]">The Engine</p>
        <p className="font-display text-2xl font-black text-cardio-text group-hover:text-cardio-accent">
          Start the Engine →
        </p>
      </Link>
    </section>
  );
}
