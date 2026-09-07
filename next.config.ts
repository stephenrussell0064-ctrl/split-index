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
          {
            /*
             * HSTS. Vercel serves HTTPS and redirects, but without this the
             * FIRST request of a session is downgradeable — a redirect can be
             * intercepted, and the CSP's `upgrade-insecure-requests` only
             * covers subresources, not the initial navigation.
             *
             * Two years, subdomains included. `preload` is deliberately absent:
             * it is a one-way door — getting a domain OUT of the browsers'
             * preload list takes months — and it should be a decision made
             * knowingly, not one that arrives inside a security fix.
             *
             * Capacitor is unaffected: the native shell already pins
             * `cleartext: false` and only navigates splitindex.co.uk hosts.
             */
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            /*
             * geolocation=() is correct TODAY and is a trap for tomorrow.
             *
             * GPS run tracking exists, but it goes through Capacitor's native
             * background-geolocation plugin, which does not consult a
             * Permissions-Policy header — `navigator.geolocation` appears
             * nowhere in this codebase. So denying it costs nothing now.
             *
             * The day a web GPS path ships, this header will block it silently:
             * no console error the developer will connect to a header set in a
             * config file. Change it to `geolocation=(self)` at that point, and
             * narrowly — the brief's instruction is to grant it only when the
             * feature needs it.
             */
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
