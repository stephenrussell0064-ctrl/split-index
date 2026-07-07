import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { HeroSplit } from "@/components/marketing/hero-split";
import { DataTicker } from "@/components/marketing/data-ticker";
import { DataTiles } from "@/components/marketing/data-tiles";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { PricingSection, CtaStrip } from "@/components/marketing/pricing-cta";
import { Button } from "@/components/ui/button";

export function LandingPage() {
  return (
    <div className="landing-page relative min-h-screen bg-[#050605] text-white">
      <div className="landing-grain pointer-events-none fixed inset-0 z-[100]" aria-hidden />

      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#050605]/80 px-6 backdrop-blur-md md:px-[6vw]">
        <BrandMark variant="full" href="/" logoHeight={34} priority className="shrink-0" />
        <nav className="hidden items-center gap-8 text-xs uppercase tracking-[0.18em] text-white/50 md:flex">
          <a href="#pricing" className="transition hover:text-white">
            Pricing
          </a>
          <Link href="/login" className="transition hover:text-white">
            Log in
          </Link>
        </nav>
        <Link href="/signup">
          <Button size="sm" className="bg-gym-accent font-bold text-[#04120a] hover:bg-gym-accent/90">
            Start free
          </Button>
        </Link>
      </header>

      <HeroSplit />
      <DataTicker />
      <DataTiles />
      <ProductShowcase />
      <PricingSection />
      <CtaStrip />

      <footer className="border-t border-white/[0.06] px-6 py-10 text-center text-xs text-white/35 md:px-[6vw]">
        <p>© {new Date().getFullYear()} Split Index · Strength & endurance scoring</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/privacy" className="hover:text-white/60">
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
