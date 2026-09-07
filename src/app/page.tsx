import { LandingPage } from "@/components/marketing/landing-page";
import { jsonLdScript } from "@/lib/utils/json-ld";
import { getAppUrl } from "@/lib/app-url";

const appUrl = getAppUrl();

/**
 * Organization structured data, moved here from the root layout (M9).
 *
 * This is the page that identifies the organisation, and — unlike the app
 * routes it used to render on — the one a crawler can actually reach. It also
 * has to live on a statically-rendered public page: the nonce-based CSP now
 * covering the authenticated surface would block a hand-written inline script,
 * and nonce-ing it would mean reading request headers in the root layout, which
 * makes every route dynamic. See src/lib/security/csp.ts.
 *
 * Escaped through `jsonLdScript` rather than `JSON.stringify` (L2): the HTML
 * parser ends a script element at the literal `</script`, before any JSON is
 * parsed, so valid JSON is not the same thing as safe markup.
 */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Split Index",
  url: appUrl,
  logo: `${appUrl}/splitindex-icon.png`,
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd) }}
      />
      <LandingPage />
    </>
  );
}
