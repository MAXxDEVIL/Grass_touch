"use client";

// Only ever loaded through next/dynamic with ssr disabled, because Leaflet
// reads window on import. That keeps the rest of the app server-rendered.
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import {
  METRES_PER_DEGREE,
  VISION_M,
  type Fix,
  type Sighted,
} from "@/lib/realtime";

/** 40 m across is about a third of the screen here. */
const ZOOM = 18;

// shortcut: the public OSM tile server is fine for five phones and forbids load
// heavier than that — switch to a paid or self-hosted tile source before this
// goes past a hobby scale.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_CREDIT =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DOT = "#7cff6b";
const DOT_EDGE = "#0b0f14";
const SPREAD = "#6c8cff";
const VISION = "#ff4d67";
const SIGHTED = "#ffb84d";

interface Scene {
  map: L.Map;
  dot: L.CircleMarker;
  spread: L.Circle;
  /** Only the impostor gets one. */
  vision: L.Rectangle | null;
  /** Survivors the impostor has been told about. Empty for everyone else. */
  others: L.LayerGroup;
}

export function GameMap({
  position,
  impostor,
  sighted,
}: {
  position: Fix;
  impostor: boolean;
  sighted: Sighted[];
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    const map = L.map(node, { zoomControl: false, scrollWheelZoom: false });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(map);

    // Circle markers are SVG, so the default marker images (which break under a
    // bundler) are never involved.
    const spread = L.circle([0, 0], {
      radius: 0,
      color: SPREAD,
      weight: 1,
      opacity: 0.6,
      fillOpacity: 0.12,
    }).addTo(map);
    const dot = L.circleMarker([0, 0], {
      radius: 7,
      color: DOT_EDGE,
      weight: 2,
      fillColor: DOT,
      fillOpacity: 1,
    }).addTo(map);
    const vision = impostor
      ? L.rectangle(
          [
            [0, 0],
            [0, 0],
          ],
          { color: VISION, weight: 1, opacity: 0.8, fillOpacity: 0.08 },
        ).addTo(map)
      : null;
    const others = L.layerGroup().addTo(map);

    setScene({ map, dot, spread, vision, others });

    return () => {
      map.remove();
      setScene(null);
    };
  }, [impostor]);

  useEffect(() => {
    if (!scene) return;
    const { map, dot, spread, vision, others } = scene;

    const here = L.latLng(position.lat, position.lng);
    dot.setLatLng(here);
    spread.setLatLng(here).setRadius(position.accuracy);

    if (vision) {
      // Metres turned into degrees, which is near enough over 40 m.
      const halfLat = VISION_M / 2 / METRES_PER_DEGREE;
      const halfLng = halfLat / Math.cos((position.lat * Math.PI) / 180);
      vision.setBounds([
        [position.lat - halfLat, position.lng - halfLng],
        [position.lat + halfLat, position.lng + halfLng],
      ]);
    }

    // Four players at most, so rebuilding the layer is cheaper than tracking
    // which marker belongs to which socket.
    others.clearLayers();
    for (const player of sighted) {
      L.circleMarker([player.lat, player.lng], {
        radius: 6,
        color: DOT_EDGE,
        weight: 2,
        fillColor: SIGHTED,
        fillOpacity: 1,
      }).addTo(others);
    }

    // Leaflet has no zoom until the first setView, so this centres it as well.
    map.setView(here, map.getZoom() ?? ZOOM, { animate: false });
  }, [scene, position, sighted]);

  return (
    <div
      className="h-[55vh] min-h-64 w-full overflow-hidden rounded-xl border border-white/10"
      ref={nodeRef}
    />
  );
}
