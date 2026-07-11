import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";
import { ClientBootstrap } from "@/components/providers/client-bootstrap";
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
        {children}
      </body>
    </html>
  );
}
