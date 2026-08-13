"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { RoutePoint } from "@/lib/scoring/gps-track";

/**
 * Fits the map to the whole route, and re-fits when the container resizes.
 *
 * Split out of RouteMap because `useMap` only works inside a MapContainer, and
 * MapContainer is dynamically imported to keep Leaflet out of the server
 * bundle — a hook calling `useMap` in the same module would be evaluated
 * before the provider exists.
 *
 * The invalidateSize call is the same fix gps-map.tsx already carries: Leaflet
 * caches its container's pixel size at construction and never re-measures, so
 * a map that mounts while its flex parent is still settling fits its bounds
 * against a stale size and draws the route off-centre or half out of frame.
 */
export function FitRouteBounds({ route }: { route: RoutePoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (route.length < 2) return;

    const fit = () => {
      map.invalidateSize();
      // Padding scaled to the box: a fixed 12px inset eats a third of a
      // 64px logbook thumbnail and leaves the route squeezed into the middle.
      const { clientWidth, clientHeight } = map.getContainer();
      const inset = Math.max(4, Math.round(Math.min(clientWidth, clientHeight) * 0.08));
      map.fitBounds(route as [number, number][], { padding: [inset, inset], animate: false });
    };

    // Once after the first paint settles, then on any container resize.
    const timer = setTimeout(fit, 60);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
    observer?.observe(map.getContainer());

    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [map, route]);

  return null;
}
