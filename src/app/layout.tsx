import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";
import { ClientBootstrap } from "@/components/providers/client-bootstrap";
import { LaunchOverlay } from "@/components/providers/launch-overlay";
import { MotionProvider } from "@/components/providers/motion-provider";
import { RouteRestore } from "@/components/providers/route-restore";
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

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Split Index",
  url: appUrl,
  logo: `${appUrl}/splitindex-icon.png`,
};

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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <ClientBootstrap />
        <RouteRestore />
        {/* LaunchOverlay animates too, so it sits inside the provider rather than beside it. */}
        <MotionProvider>
          <LaunchOverlay />
          {children}
        </MotionProvider>
      </body>
    </html>
  );
}
