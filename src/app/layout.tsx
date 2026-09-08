import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";
import { ClientBootstrap } from "@/components/providers/client-bootstrap";
import { LaunchOverlay } from "@/components/providers/launch-overlay";
import { RouteRestore } from "@/components/providers/route-restore";
import { SKIP_LINK_HREF } from "@/lib/a11y/main-content";
import { getAppUrl } from "@/lib/app-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

const unbounded = Unbounded({
  variable: "--font-display",
  subsets: ["latin"],
});

const appUrl = getAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Split Index — Hybrid Athlete Analytics",
    template: "%s | Split Index",
  },
  description:
    "The premium analytics platform for hybrid athletes. Objective fitness scoring that updates after every workout.",
  keywords: ["fitness analytics", "hybrid athlete", "training index", "strength", "endurance"],
  openGraph: {
    title: "Split Index",
    description: "Objective fitness scoring for hybrid athletes",
    type: "website",
    images: [{ url: "/splitindex-logo.png", width: 960, height: 240, alt: "Split Index" }],
  },
  icons: {
    icon: [
      { url: "/splitindex-icon.svg", type: "image/svg+xml" },
      { url: "/splitindex-icon.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png" }],
  },
};

// viewport-fit: "cover" lets the native app draw edge-to-edge under the
// notch/Dynamic Island/status bar (capacitor.config.ts ios.contentInset:
// "never") — without it, env(safe-area-inset-*) always resolves to 0 in
// WebKit, and every safe-area-aware max(1.5rem, env(...)) fallback in this
// app silently collapses to a fixed 24px instead of the real ~47-59px
// status bar height, which is why top-bar content was colliding with it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/*
 * The Organization JSON-LD used to be rendered here, in the root layout, and
 * therefore on every route in the application. It now lives on `/` — see
 * src/app/page.tsx.
 *
 * Two reasons, and the second is the one that forced it:
 *
 *  1. It never did anything on the other 40-odd routes. /dashboard and
 *     /activities require a login, so no crawler has ever seen the block there.
 *     Organization markup belongs on the page that identifies the organisation.
 *
 *  2. M9. The authenticated surface now runs a nonce-based CSP, and Next nonces
 *     only its OWN script tags — framework bundles, page chunks, and <Script>
 *     components. A hand-written <script> in a layout gets nothing, so this
 *     block would have been silently blocked on every app route. Giving it a
 *     nonce means calling `headers()` in the root layout, which would opt EVERY
 *     route into dynamic rendering and throw away the entire point of the split.
 *
 * So the structured data sits on the static public page, where it is read, and
 * the strict policy covers the pages holding athlete data, where it matters.
 */

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${unbounded.variable} h-full antialiased dark selection:bg-accent/35`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {/*
          Skip link. First focusable thing in the document, visually hidden
          until it takes focus.

          Keyboard and screen-reader users otherwise tab through the whole
          sidebar and top bar on every page before reaching the content — this
          app's nav is around thirty stops. WCAG 2.2 2.4.1 (Bypass Blocks).

          This link is rendered on EVERY page, so every page owes it a target.
          That was the bug: the id lived in app-shell.tsx, which only wraps the
          authenticated routes, so the skip link went nowhere on the landing
          page, /login, /signup and all four public documents. See
          lib/a11y/main-content.ts, and skip-link.test.ts for the gate.
        */}
        <a
          href={SKIP_LINK_HREF}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground focus:outline-2 focus:outline-offset-2 focus:outline-accent"
        >
          Skip to main content
        </a>
        <ClientBootstrap />
        <RouteRestore />
        <LaunchOverlay />
        {children}
      </body>
    </html>
  );
}
