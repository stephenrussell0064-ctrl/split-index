"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils/cn";
import { basemapTileUrl, BASEMAP_ATTRIBUTION } from "@/lib/maps/basemap";
import type { GpsPoint } from "@/lib/scoring/gps-track";

interface GpsMapProps {
  points: GpsPoint[];
  className?: string;
}

/** Keeps the map centered on the latest fix as new points arrive, without forcing the user's own pan/zoom to snap back every render. */
function FollowRoute({ points }: { points: GpsPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const latest = points[points.length - 1];
    if (points.length === 1) {
      map.setView([latest.latitude, latest.longitude], 16);
    } else {
      map.panTo([latest.latitude, latest.longitude], { animate: true });
    }
  }, [points, map]);

  return null;
}

/**
 * Leaflet caches its container's pixel size at construction time and never
 * re-measures on its own — CSS layout changes (the flex container settling
 * after first paint, a device rotation) don't fire a resize event Leaflet
 * listens for. Without telling it to re-measure, every subsequent pan/zoom
 * computes pixel offsets against a stale size, and the error compounds the
 * further the map pans from its initial center — exactly why this only
 * became visible "after a few minutes of following," not immediately, and
 * why rotating to landscape broke the layout outright.
 */
function InvalidateSizeOnResize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    // Once for the very first paint settling (flex/dvh layout can still be
    // adjusting on the frame this mounts).
    const initialTimer = setTimeout(() => map.invalidateSize(), 100);

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

/**
 * Loaded via next/dynamic({ ssr: false }) — Leaflet touches `window` at
 * import time, so this can never run during SSR. Light CARTO basemap tiles
 * (free, no API key) to match the app's light cardio theme instead of a
 * dark map fighting the surrounding light UI.
 */
export default function GpsMap({ points, className }: GpsMapProps) {
  if (points.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center border border-[#0c1a24]/10 bg-[#eef6ff] text-sm font-medium text-[#0c1a24]",
          className
        )}
      >
        Waiting for GPS fix…
      </div>
    );
  }

  const latest = points[points.length - 1];
  const positions: [number, number][] = points.map((p) => [p.latitude, p.longitude]);

  return (
    // `isolate` for the same reason as route-map.tsx: Leaflet's panes carry
    // z-indexes up to 1000 and every overlay in this app sits at z-40, so
    // without a stacking context the live map draws over the tab bar and any
    // sheet above it.
    <div className={cn("isolate", className)}>
      <MapContainer
        center={[latest.latitude, latest.longitude]}
        zoom={16}
        zoomControl={false}
        dragging={false}
        touchZoom={false}
        doubleClickZoom={false}
        scrollWheelZoom={false}
        boxZoom={false}
        keyboard={false}
        className="h-full w-full"
      >
        <TileLayer url={basemapTileUrl("light")} attribution={BASEMAP_ATTRIBUTION} />
        <Polyline positions={positions} pathOptions={{ color: "#3ba6ff", weight: 4 }} />
        <CircleMarker
          center={[latest.latitude, latest.longitude]}
          radius={7}
          pathOptions={{ color: "#ffffff", fillColor: "#3ba6ff", fillOpacity: 1, weight: 2 }}
        />
        <FollowRoute points={points} />
        <InvalidateSizeOnResize />
      </MapContainer>
    </div>
  );
}
