/**
 * The heat network on the Site map (HeatNetwork.tsx): its own pane over the site's outlines and bubbles, drawn once per
 * plan (networkLayer.ts drawNetwork), the hour shown only repainted; removed when hidden or unmounted. Dragging the
 * station calls `onStation` (the latest one passed).
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Site } from "../../api";
import type { HeatNetwork as Network } from "./network";
import type { NetworkHour, networkEconomics } from "./networkCost";
import { drawNetwork } from "./networkLayer";

export function useNetworkLayer({
  map,
  show,
  onMap,
  net,
  econ,
  inputs,
  src,
  topKw,
  now,
  onStation,
}: {
  map: { current: L.Map | null };
  show: boolean;
  onMap: boolean;
  net: Network | undefined;
  econ: ReturnType<typeof networkEconomics> | null;
  inputs: Site | null;
  src: Site["source"] | undefined;
  topKw: number;
  now: NetworkHour | null;
  onStation: (at: { lat: number; lon: number } | null) => void;
}) {
  // the plan on the map, in its own pane over the site's outlines and bubbles (clicks pass through but on the pipes);
  // drawn once per plan, the hour only repainted (networkLayer.ts)
  const layer = useRef(L.layerGroup());
  const renderer = useRef<L.Renderer | null>(null);
  const paint = useRef<((now: NetworkHour | null) => void) | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const placeStation = useRef(onStation);
  placeStation.current = onStation;
  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    paint.current = null;
    const m = map.current;
    if (!m || !show || !onMap || !net?.station || !econ || !inputs) return void g.remove();
    if (!renderer.current) {
      // beside the overlay pane, over it (400), in leaflet-rotate's turning pane: the pipes turn with the map, the
      // station marker (its pane does not turn) stays upright over them
      m.createPane("network", m.getPane("overlayPane")!.parentElement!).style.zIndex = "450";
      m.getPane("network")!.style.pointerEvents = "none";
      renderer.current = L.svg({ pane: "network" });
    }
    const outline = new Map(inputs.sinks.map((s) => [s.id, s.outline ?? null]));
    paint.current = drawNetwork(g, renderer.current, {
      net,
      econ,
      outlines: net.chosen.map((id) => outline.get(id) ?? null),
      topKw,
      sourceName: src?.name ?? "",
      now: () => nowRef.current,
      onStation: (at) => placeStation.current(at),
    });
    g.addTo(m);
    paint.current(nowRef.current);
  }, [map, show, onMap, net, econ, inputs, src, topKw]);
  useEffect(() => paint.current?.(now), [now]);
  useEffect(() => () => void layer.current.remove(), []);
}
