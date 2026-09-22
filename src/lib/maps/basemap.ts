/**
 * CARTO basemap tiles — one definition, read by every map in the app.
 *
 * WHY THIS EXISTS AS A MODULE. CARTO moved its basemaps behind an API key,
 * and the failure mode is invisible to code: the anonymous endpoint still
 * answers `200 image/png` with a real tile, so nothing throws, no console
 * warning fires and no network panel goes red. It simply paints
 * "API KEY REQUIRED / carto.com/basemaps/apikey" diagonally across every
 * tile. That is why this reached us as a screenshot of the live tracking
 * screen rather than as an error, and why the URL now belongs in one place
 * instead of being spelled out at each call site — there were three, and a
 * key appended to two of them is the same bug with better odds.
 *
 * THE KEY IS NOT A SECRET AND CANNOT BE ONE. These are tile requests the
 * browser makes, so whatever is here is readable by anyone who opens
 * devtools. Restrict it by domain in the CARTO dashboard; do not reason
 * about it as a credential.
 *
 * NOTE THE PREFIX, for the same reason `native/billing.ts` notes it:
 * NEXT_PUBLIC_ is inlined at BUILD time. Setting this in Vercel without
 * triggering a redeploy changes nothing on device — the iOS app is a
 * WebView over production and loads whatever Vercel last built.
 */

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY;

/**
 * Positron and Dark Matter, the two styles the app's light and dark zones
 * are designed around. The Engine is a white surface and the Lab is not, so
 * a map that cannot follow its zone reads as a hole punched through the row
 * rather than as a map.
 */
const STYLE = { light: "light_all", dark: "dark_all" } as const;

export type BasemapVariant = keyof typeof STYLE;

/**
 * Required by CARTO's terms and by OSM's licence, both of which ask for
 * visible credit rather than credit in a source file.
 *
 * HTML, because this is what Leaflet's own attribution control renders. A
 * surface that draws its own credit wants `BasemapCredit` instead — see the
 * note there about why the logbook cannot use this one.
 */
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Whether a key is configured at all. Exported so a surface can say plainly
 * that its tiles are unlicensed rather than leaving a watermark to imply it.
 */
export const BASEMAP_KEY_CONFIGURED = Boolean(CARTO_KEY);

/**
 * The tile URL for a variant.
 *
 * Without a key this returns the anonymous endpoint, deliberately: a
 * watermarked map still shows the athlete where they are, and a run in
 * progress is the worst possible moment to replace a working map with an
 * error state over a configuration problem they cannot fix.
 */
export function basemapTileUrl(variant: BasemapVariant): string {
  const base = `https://{s}.basemaps.cartocdn.com/${STYLE[variant]}/{z}/{x}/{y}{r}.png`;
  return CARTO_KEY ? `${base}?key=${encodeURIComponent(CARTO_KEY)}` : base;
}
