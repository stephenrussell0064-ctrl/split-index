"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils/cn";
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
 * Loaded via next/dynamic({ ssr: false }) — Leaflet touches `window` at
 * import time, so this can never run during SSR. Dark CARTO basemap tiles
 * (free, no API key) rather than default OSM tiles, to match the app's dark
 * theme instead of a jarring bright-white map dropped into a dark card.
 */
export default function GpsMap({ points, className }: GpsMapProps) {
  if (points.length === 0) {
    return (
      <div className={cn("flex items-center justify-center bg-white/[0.03] text-xs text-muted", className)}>
        Waiting for GPS fix…
      </div>
    );
  }

  const latest = points[points.length - 1];
  const positions: [number, number][] = points.map((p) => [p.latitude, p.longitude]);

  return (
    <div className={className}>
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
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <Polyline positions={positions} pathOptions={{ color: "#3dff6e", weight: 4 }} />
        <CircleMarker
          center={[latest.latitude, latest.longitude]}
          radius={7}
          pathOptions={{ color: "#ffffff", fillColor: "#3dff6e", fillOpacity: 1, weight: 2 }}
        />
        <FollowRoute points={points} />
      </MapContainer>
    </div>
  );
}
