/**
 * Site map: the waste heat sources of the Plattform für Abwärme (PfA) and its panel section. "Waste heat sources in
 * view" reads the reported sources of the view (at most 40 × 40 km) from the local import (scripts/import_pfa.py) and
 * draws them as circles, sized by their maximum power and coloured by temperature; a click on one takes it as a second
 * source beside the data center: the quick analysis (QuickWindow.tsx) then lets it cover what the data center leaves.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { fetchHeatSources, type HeatSource, type HeatSourceBox } from "../../api";
import { errorMessage } from "../../lib/errors";
import { fmt } from "../../lib/format";
import { InfoMark } from "../../ui/InfoMark";
import { boxKm } from "./waermeatlas";
import { ATTRIBUTION, MAX_BOX_KM, radiusOf, sourceHtml, TEMP_CLASSES, tempColor, tempOf } from "./pfa";

const boxOf = (b: L.LatLngBounds): [number, number, number, number] => [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];

interface Props {
  map: { current: L.Map | null };
  bounds: L.LatLngBounds | null; // the current view
  selected: HeatSource | null; // the second source taken
  onSelect: (s: HeatSource | null) => void;
  setStatus: (s: string | null) => void;
}

export default function HeatSourcesPanel({ map, bounds, selected, onSelect, setStatus }: Props) {
  const [box, setBox] = useState<HeatSourceBox | null>(null);
  const [loading, setLoading] = useState(false);
  const layer = useRef(L.layerGroup([], { attribution: ATTRIBUTION }));
  const renderer = useRef<L.Renderer | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const view = bounds && boxKm(boxOf(bounds));
  const tooBig = !view || Math.max(view.width, view.height) > MAX_BOX_KM;

  // the circles, the largest under the smaller ones (drawn first); the one taken ringed
  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const m = map.current;
    if (!box || !m) return void g.remove();
    if (!renderer.current) {
      // over the site's own bubbles and pipes: the sources are to be found and clicked
      m.createPane("sources", m.getPane("overlayPane")!.parentElement!).style.zIndex = "460";
      renderer.current = L.svg({ pane: "sources" });
    }
    for (const s of box.sources) {
      const on = selected?.id === s.id;
      L.circleMarker([s.lat, s.lon], {
        renderer: renderer.current,
        className: "site__pfa",
        radius: radiusOf(s.max_kw),
        color: on ? "#111" : "#3f3f46",
        weight: on ? 3 : 1,
        dashArray: s.geo === "postcode" ? "3 3" : undefined, // placed at its postcode only: not its own spot
        fillColor: tempColor(tempOf(s)),
        fillOpacity: 0.85,
      })
        .bindTooltip(() => sourceHtml(s) + (on ? "<br><i>the second source of the quick analysis</i>" : "<br><i>click: take it as a second source</i>"), {
          sticky: true,
        })
        .on("click", () => pick.current(s))
        .addTo(g);
    }
    g.addTo(m);
  }, [box, map, selected]);
  useEffect(() => () => void layer.current.remove(), []);

  const load = async () => {
    if (!bounds) return;
    setLoading(true);
    try {
      const got = await fetchHeatSources(boxOf(bounds));
      setBox(got);
      const mwh = got.sources.reduce((a, s) => a + (s.mwh ?? 0), 0);
      setStatus(
        `${fmt(got.sources.length)} waste heat sources${got.truncated ? " (the largest)" : ""}, ${fmt(mwh / 1000, 1)} GWh/a. Click one to take it as a second source.`,
      );
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="site__atlas">
      <div className="site__buttons">
        <button type="button" className="btn btn--sm" onClick={load} disabled={tooBig || loading}>
          {loading ? "Loading…" : box ? "Reload sources for this view" : "Waste heat sources in view"}
        </button>
        {box && (
          <button type="button" className="btn btn--sm" onClick={() => setBox(null)}>
            Hide sources
          </button>
        )}
        <InfoMark
          term="the waste heat sources layer"
          mark="?"
          hover
          text={`The waste heat potentials companies report to the Plattform für Abwärme (§ 17 EnEfG), from the local import of its table (scripts/import_pfa.py; the addresses geocoded once with OpenStreetMap). Size: maximum power; colour: temperature; dashed: placed at its postcode only. Click one to take it as a second source: the quick analysis lets it cover what the data center leaves. ${ATTRIBUTION}.`}
        />
      </div>
      {tooBig && view && <div className="site__hint">{`Zoom in: the view is ${fmt(view.width)} × ${fmt(view.height)} km, the sources load for at most ${MAX_BOX_KM} × ${MAX_BOX_KM} km.`}</div>}
      {box && (
        <div className="site__legend" aria-label="Waste heat sources legend">
          {TEMP_CLASSES.map((c) => (
            <span key={c.color}>
              <i style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      )}
      {selected && (
        <div className="site__hint" aria-label="Second source">
          <b>Second source:</b> {selected.name ?? "Waste heat"} · {selected.company ?? ""} · {fmt(selected.mwh ?? 0)} MWh/a at{" "}
          {tempOf(selected) == null ? "unknown" : `${fmt(tempOf(selected)!)} °C`}{" "}
          <button type="button" className="btn btn--xs" onClick={() => onSelect(null)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
