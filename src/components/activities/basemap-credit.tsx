import { cn } from "@/lib/utils/cn";

/**
 * The OpenStreetMap and CARTO credit for a surface that renders route maps.
 *
 * WHY THIS IS NOT ON THE THUMBNAIL. Both licences ask for credit that is
 * actually visible, and a logbook thumbnail is 48px square — 56x64 at the
 * `sm` breakpoint. Leaflet's own attribution control on a box that size is
 * wider than the map, covers the route it is crediting, and renders at a
 * size nobody can read. Stamping it on each thumbnail would satisfy the
 * letter of the requirement by producing something illegible, and would do
 * it twenty times down a scrolling list.
 *
 * So the credit is drawn ONCE per surface that shows routes, which is what
 * OSM's attribution guidance asks for when a map is too small to carry its
 * own: the credit must be visible in the same view as the map, not
 * necessarily inside its frame.
 *
 * The live tracking map and the full-size activity route are a different
 * case — those are large enough for Leaflet's own control and they use it.
 */
export function BasemapCredit({ className }: { className?: string }) {
  return (
    <p className={cn("px-4 py-2 text-[10px] leading-relaxed sm:px-5", className)}>
      Route maps &copy;{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2"
      >
        OpenStreetMap
      </a>{" "}
      contributors, tiles &copy;{" "}
      <a
        href="https://carto.com/attributions"
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2"
      >
        CARTO
      </a>
    </p>
  );
}
