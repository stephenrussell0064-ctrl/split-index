import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { HeroSplit } from "@/components/marketing/hero-split";
import { DataTicker } from "@/components/marketing/data-ticker";
import { DataTiles } from "@/components/marketing/data-tiles";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { PricingSection, CtaStrip } from "@/components/marketing/pricing-cta";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function LandingPage() {
  return (
    <div className="landing-page relative min-h-dvh bg-[#050605] text-white">
      <div className="landing-grain pointer-events-none fixed inset-0 z-[100]" aria-hidden />

      {/*
        The status bar sits ON TOP of this header in the native app.
        `viewport-fit=cover` (see app/layout.tsx) hands the webview the full
        screen including the notch area, so a `sticky top-0` header starts at
        y=0 — underneath the clock and the battery icon. On the marketing page
        this was never noticed, because nobody reaches it from inside the app
        except by logging out, which is exactly where it lands you.

        Worse than ugly: iOS treats taps in the status bar strip as its own
        (scroll-to-top), so the "Start free" button was not merely overlapping
        the clock, it was largely UNTAPPABLE. The padding is what makes the
        button reachable; `h-16` stays the bar's own height so the layout is
        unchanged on the web, where the inset resolves to 0.
      */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#050605]/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 md:px-[6vw]">
          <BrandMark variant="full" href="/" logoHeight={34} priority className="shrink-0" />
          <nav className="hidden items-center text-xs uppercase tracking-[0.18em] text-white/50 md:flex">
            <a href="#pricing" className="transition hover:text-white">
              Pricing
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            {/*
              Log in is NOT desktop-only, because of where this page is reached
              from. Logging out of the native app lands you here, and this used
              to be the whole route back: sign up, then find "Already have an
              account?" at the bottom of the signup form. Someone who has just
              logged out is, by definition, the person most likely to want to
              log back in, and on a phone the one link for it was hidden.

              It sits outside the `md:flex` nav rather than inside it so the
              breakpoint governs Pricing alone. There is room: at 375px the
              logo ends around x=140 and the button starts around x=261.
            */}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-2 text-xs uppercase tracking-[0.14em] text-white/60 transition hover:text-white sm:tracking-[0.18em]"
            >
              Log in
            </Link>
            {/*
              One anchor styled as a button, not an anchor wrapping a <button>.
              The latter is what this was, and it emits `<a><button>`:
              interactive content nested inside interactive content, which
              WKWebView declines to navigate — the tap lands on the button, the
              button has no form to submit, and Next's click handler on the
              anchor never runs. It works in a desktop browser, which is why it
              survived review.
            */}
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ size: "sm" }),
                "min-h-11 shrink-0 bg-gym-accent font-bold text-[#04120a] hover:bg-gym-accent/90"
              )}
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      <HeroSplit />
      <DataTicker />
      <DataTiles />
      <ProductShowcase />
      <PricingSection />
      <CtaStrip />

      <footer className="border-t border-white/[0.06] px-6 py-10 text-center text-xs text-white/55 md:px-[6vw]">
        <p>© {new Date().getFullYear()} Split Index · Strength & endurance scoring</p>
        <p className="mt-2 flex justify-center gap-4">
          <Link href="/how-scoring-works" className="hover:text-white/80">
            How scoring works
          </Link>
          <Link href="/privacy" className="hover:text-white/80">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-white/80">
            Terms
          </Link>
          {/* WP12.8 asks for the statement at a stable URL, linked from the
              footer. A statement nobody can find is not published. */}
          <Link href="/accessibility" className="hover:text-white/80">
            Accessibility
          </Link>
        </p>
      </footer>
    </div>
  );
}
