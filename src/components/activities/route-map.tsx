"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
// Leaflet positions every tile absolutely from its own stylesheet. Without
// this the map mounts, the tiles download, and nothing is visible — which is
// exactly what it looked like before this line existed.
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils/cn";
import type { RoutePoint } from "@/lib/scoring/gps-track";

/**
 * A run's route, drawn on a map, for the logbook.
 *
 * Three constraints shape this and none of them are cosmetic:
 *
 *  1. **Mounted only when visible.** The logbook is a long list. Mounting a
 *     Leaflet instance per row on page load would fire a tile request storm
 *     for runs the athlete never scrolls to, on a phone, probably on mobile
 *     data. An IntersectionObserver defers each map until it is actually
 *     about to be seen.
 *  2. **Non-interactive.** Dragging and scroll-wheel zoom are off. A map that
 *     captures scroll inside a scrolling list traps the user's thumb, which
 *     is the single most common way an embedded map makes a page worse.
 *     Tapping the row still opens the full activity.
 *  3. **Bounds-fitted, not centre-and-zoom.** The whole route has to be
 *     visible at a glance or the map is decoration rather than information.
 */

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then((m) => m.CircleMarker), { ssr: false });
const FitRouteBounds = dynamic(() => import("./fit-route-bounds").then((m) => m.FitRouteBounds), { ssr: false });

/**
 * Basemap tiles have to follow the zone they're rendered into. The Engine is
 * a white surface, and a dark-tiled thumbnail on it reads as a black hole
 * punched through the row rather than as a map.
 */
const TILE_URLS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
} as const;

export function RouteMap({
  route,
  className,
  ariaLabel = "Route map for this run",
  variant = "dark",
}: {
  route: RoutePoint[];
  className?: string;
  ariaLabel?: string;
  variant?: "dark" | "light";
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // No IntersectionObserver (old browser, or a test environment) means we
    // render rather than hide — a missing optimisation must never become a
    // missing feature. Deferred a tick so the state update lands outside the
    // synchronous effect body.
    if (typeof IntersectionObserver === "undefined") {
      const fallback = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(fallback);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Start loading slightly before the row scrolls in, so the map is
      // already drawn by the time it is looked at.
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (route.length < 2) return null;

  const start = route[0];
  const finish = route[route.length - 1];

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-2xl border",
        variant === "light"
          ? "border-cardio-border/50 bg-cardio-bg-elevated"
          : "border-white/[0.06] bg-white/[0.02]",
        className
      )}
      role="img"
      aria-label={ariaLabel}
    >
      {visible ? (
        <MapContainer
          // Placeholder view; FitRouteBounds replaces it on mount. Leaflet
          // requires a center and zoom at construction time.
          center={[start[0], start[1]]}
          zoom={14}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          zoomControl={false}
          attributionControl={false}
          keyboard={false}
          // Leaflet's tile fade-in starts each tile at opacity 0 and clears it
          // on a load handler. When the container is resized during mount —
          // which is exactly what fitting bounds to the route does — tiles can
          // finish loading before that handler is wired and stay invisible.
          // A static thumbnail has nothing to gain from the fade anyway.
          fadeAnimation={false}
          style={{ height: "100%", width: "100%", background: "transparent" }}
        >
          <TileLayer url={TILE_URLS[variant]} />
          <FitRouteBounds route={route} />
          <Polyline positions={route} pathOptions={{ color: "#22d3ee", weight: 3, opacity: 0.9 }} />
          <CircleMarker center={[start[0], start[1]]} radius={4} pathOptions={{ color: "#22c55e", fillOpacity: 1 }} />
          <CircleMarker center={[finish[0], finish[1]]} radius={4} pathOptions={{ color: "#f43f5e", fillOpacity: 1 }} />
        </MapContainer>
      ) : (
        // Reserves the same box before the map loads, so the list does not
        // jump as rows scroll into view.
        <div className="h-full w-full" aria-hidden />
      )}
    </div>
  );
}
