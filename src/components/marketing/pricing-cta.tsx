import Link from "next/link";
import { FREE_TIER_FEATURES, PREMIUM_TIER_FEATURES } from "@/lib/premium/features";
import { PREMIUM_PRICE_GBP } from "@/lib/stripe/config";
import { Button } from "@/components/ui/button";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";

export function PricingSection() {
  return (
    <section id="pricing" className="border-t border-white/[0.06] bg-[#050605] px-6 py-24 md:px-[6vw]">
      <div className="mx-auto max-w-4xl text-center">
        <p className="landing-eyebrow text-gym-accent">Pricing</p>
        <h2 className="font-display text-3xl font-black text-white md:text-4xl">
          Start free. Upgrade when you&apos;re hooked.
        </h2>
      </div>
      <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
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
          <p className="text-[10px] uppercase tracking-[0.24em] text-gym-accent">Premium</p>
          <p className="font-display mt-3 text-5xl font-black text-white">
            £{PREMIUM_PRICE_GBP}
            <span className="text-base font-medium text-white/40">/mo</span>
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
