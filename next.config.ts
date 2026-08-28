import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self' ${supabaseUrl};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  images: {
    // Only our own static brand assets (public/splitindex-*.svg) go through
    // next/image as SVG — never user-uploaded content — so this is safe.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async redirects() {
    return [
      {
        // The Training Plan wizard is gone (user feedback: "Remove the
        // training plan page as this is not as good as hybrid plan and may
        // cause confusion to the user (only keep hybrid plan)"). Deleting the
        // route alone would 404 anyone holding a bookmark, a home-screen
        // shortcut, or an open tab — the athletes most invested in the
        // feature would be the ones who hit the error. 308 rather than a hard
        // removal sends them to the plan that is still maintained.
        //
        // Permanent (308, not 307) because this is not coming back, and 308
        // preserves the request method rather than silently rewriting it to
        // GET the way a legacy 301 would.
        //
        // Note the deliberate absence of `/training-plan/:path*`: the route
        // had no child pages, so a wildcard would only invent redirects for
        // URLs that never existed.
        source: "/training-plan",
        destination: "/hybrid-plan",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
