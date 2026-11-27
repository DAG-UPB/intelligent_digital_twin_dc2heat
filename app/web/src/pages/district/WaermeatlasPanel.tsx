/**
 * Site map: the Wärmeatlas layer and its panel group. "Load heat demand" reads the buildings of the current view
 * (at most 2 × 2 km) from the local import, draws them coloured by annual heat demand, and a click on one adds it
 * as a heat sink; "Add all in view" adds every loaded building in the view after a confirmation. `auto`: a box loaded by
 * itself, once, when it is given (the District step: the buildings around the site, all local, no internet);
 * `shown`: false keeps the loaded buildings off the map (another step is shown). With them the streets'
 * heat line density (Wärmeliniendichte: the buildings' heat per m of street and year), drawn as coloured lines under
 * the buildings; the heat network prefers the dense streets (HeatNetwork.tsx loads them for its own box).
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { fetchBuildings, fetchHeatLines, type HeatLineBox, type Site, type WaermeatlasBox, type WaermeatlasBuilding } from "../../api";
import { errorMessage } from "../../lib/errors";
import { fmt } from "../../lib/format";
import { InfoMark } from "../../ui/InfoMark";
import { NumberField } from "../../ui/NumberField";
import {
  annualKwh,
  boxKm,
  creditOf,
  HEAT_CLASSES,
  heatColor,
  LINE_CLASSES,
  lineColor,
  MAX_ADD_ALL,
  MAX_BOX_KM,
  sinkId,
  toSink,
  tooltipHtml,
  atlasBuildingAt,
  withBuildings,
} from "./waermeatlas";
import { escapeHtml } from "./html";
import { demandEntries } from "../../lib/demand";
import { sinkCard } from "./drawSite";
import { useCommand } from "../../lib/live";

const boxOf = (b: L.LatLngBounds): [number, number, number, number] => [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];

interface Props {
  map: { current: L.Map | null };
  bounds: L.LatLngBounds | null; // the current view
  site: Site | null;
  active: boolean; // no other map mode: a click on a building adds it
  update: (fn: (s: Site) => Site) => void;
  setStatus: (s: string | null) => void;
  onProfile: (id: string) => void; // a sink's profile in the district's Modelling
  auto?: [number, number, number, number] | null; // south, west, north, east: loaded by itself
  shown?: boolean;
  onLoaded?: (buildings: WaermeatlasBuilding[], quiet: boolean) => void; // loaded (on the button, or by itself when shown: the caller shows them)
}

export default function WaermeatlasPanel({ map, bounds, site, active, update, setStatus, onProfile, auto, shown = true, onLoaded }: Props) {
  const [heat, setHeat] = useState<WaermeatlasBox | null>(null);
  const [lines, setLines] = useState<HeatLineBox | null>(null); // the streets' heat line density, loaded with the buildings
  const [showLines, setShowLines] = useState(true);
  const lineLayer = useRef(L.layerGroup([]));
  const [factor, setFactor] = useState(1);
  const [loading, setLoading] = useState(false);
  const layer = useRef(L.layerGroup([])); // its attribution (the sources in view) shows while the layer is on the map
  const renderer = useRef<L.Renderer | null>(null);
  const view = bounds && boxKm(boxOf(bounds));
  const credit = heat ? creditOf(heat.buildings, heat.sources) : "";
  const lineCredit = lines ? creditOf(lines.lines, lines.sources) : "";

  const sinkIds = new Set(site?.sinks.map((s) => s.id));
  const add = (buildings: WaermeatlasBuilding[]) => update((s) => withBuildings(s, buildings, factor));
  // the layer is drawn once per load: its click handler reads the latest state through this ref
  const onClick = useRef((_: WaermeatlasBuilding) => {});
  onClick.current = (b) => {
    if (!active || !site) return; // another map mode handles the click (picking the data center, placing sinks, drawing an area); no site yet
    if (sinkIds.has(sinkId(b))) return setStatus(`${b.use ?? "This building"} is already a heat sink.`);
    add([b]);
    // its profile stays shown where it was clicked, with the way to it in Modelling
    const sink = toSink(b, factor);
    const m = map.current;
    if (m)
      L.popup()
        .setLatLng([b.lat, b.lon])
        .setContent(sinkCard(sink, demandEntries({ ...site, sinks: [sink] })[0], onProfile))
        .openOn(m);
    setStatus(`Added ${b.use ?? "building"} ${b.id} (${fmt(annualKwh(b, factor) / 1000, 1)} MWh/a). Save the site to keep it.`);
  };

  // the assistant clicks a building by its position (lib/live.ts): inside its outline, else the nearest within ~30 m
  useCommand("pick_atlas_building", (args) => {
    if (!heat) throw new Error("No Wärmeatlas buildings are loaded: click its load button first");
    const [lat, lon] = [Number(args.lat), Number(args.lon)];
    const near = atlasBuildingAt(heat.buildings, lat, lon);
    if (!near) throw new Error("No Wärmeatlas building at that point");
    onClick.current(near);
    return `clicked Wärmeatlas building ${near.id}`;
  });

  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const m = map.current;
    if (!heat || !m || !shown) return void g.remove();
    if (!renderer.current) {
      // beside the tiles and the overlay pane (in leaflet-rotate's turning pane: else the tiles would cover it), between them
      m.createPane("heat", m.getPane("tilePane")!.parentElement!).style.zIndex = "350";
      renderer.current = L.svg({ pane: "heat" });
    }
    for (const b of heat.buildings) {
      const style = { renderer: renderer.current, color: "#7c2d12", weight: 0.8, opacity: 0.7, fillColor: heatColor(b.total_kwh ?? 0), fillOpacity: 0.8 };
      const shape = b.outline ? L.polygon(b.outline, style) : L.circleMarker([b.lat, b.lon], { ...style, radius: 4 });
      shape.bindTooltip(() => tooltipHtml(b), { sticky: true }).on("click", () => onClick.current(b)); // its profile: in the popup of that click (sinkCard)
      shape.addTo(g);
    }
    g.options.attribution = `Wärmebedarf ${creditOf(heat.buildings, heat.sources)}`; // read when the layer is added
    g.addTo(m);
  }, [heat, map, shown]);

  // the heat line density under the buildings (their pane, drawn first): each segment coloured by its MWh/(m·a)
  useEffect(() => {
    const g = lineLayer.current;
    g.clearLayers();
    const m = map.current;
    if (!lines || !showLines || !heat || !m || !shown || !renderer.current) return void g.remove();
    for (const l of lines.lines) {
      const tip = `<b>${escapeHtml(l.name ?? "Street")}</b><br>${fmt(l.mwh_per_m, 2)} MWh/(m·a) heat line density<br>${fmt(l.mwh ?? 0)} MWh/a along ${fmt(l.length_m ?? 0)} m`;
      L.polyline(l.line, { renderer: renderer.current, className: "site__heat-line", color: lineColor(l.mwh_per_m), weight: 5, opacity: 0.85, lineCap: "round" })
        .bindTooltip(tip, { sticky: true })
        .addTo(g);
    }
    g.options.attribution = `Wärmeliniendichte ${creditOf(lines.lines, lines.sources)}`;
    g.addTo(m);
    // the buildings over the lines
    layer.current.eachLayer((x) => (x as L.Path).bringToFront?.());
  }, [lines, showLines, heat, map, shown]);
  useEffect(() => () => void lineLayer.current.remove(), []);

  const tooBig = !view || Math.max(view.width, view.height) > MAX_BOX_KM;

  // quiet: loaded by itself, not shown (for the sinks' colours): no message, not even when there is no local Wärmeatlas
  const load = async (at = bounds && boxOf(bounds), quiet = false) => {
    if (!at) return;
    setLoading(true);
    try {
      // the buildings and, beside them, the streets' heat line density (an import from before the street segments: the buildings only)
      const [box, lineBox] = await Promise.all([fetchBuildings(at), fetchHeatLines(at).catch(() => null)]);
      setLines(lineBox);
      setHeat(box);
      onLoaded?.(box.buildings, quiet);
      if (quiet) return;
      const mwh = box.buildings.reduce((a, b) => a + (b.total_kwh ?? 0), 0) / 1000;
      setStatus(
        box.truncated
          ? `Showing the ${box.buildings.length} buildings with the most demand; zoom in to see all.`
          : `${box.buildings.length} buildings, ${fmt(mwh)} MWh/a. Click one to add it as a heat sink.`,
      );
    } catch (e) {
      if (!quiet) setStatus(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // given a box: loaded by itself, once (again only after it was taken away and given anew)
  const autoDone = useRef(false);
  useEffect(() => {
    if (!auto) return void (autoDone.current = false);
    const km = boxKm(auto);
    if (autoDone.current || heat || loading || Math.max(km.width, km.height) > MAX_BOX_KM) return; // too big: the button, zoomed in
    autoDone.current = true;
    void load(auto, !shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads the latest state; once per box given
  }, [auto?.join(",")]);

  const addAll = () => {
    if (!heat || !bounds) return;
    // the answer is sorted biggest first, so a capped list keeps the largest consumers
    const fresh = heat.buildings.filter((b) => bounds.contains([b.lat, b.lon]) && !sinkIds.has(sinkId(b)));
    if (!fresh.length) return setStatus("No new buildings in the view.");
    const todo = fresh.slice(0, MAX_ADD_ALL);
    const mwh = todo.reduce((a, b) => a + annualKwh(b, factor), 0) / 1000;
    const capped = fresh.length > todo.length ? ` (the ${todo.length} largest of ${fresh.length}; zoom in for the rest)` : "";
    if (!confirm(`Add ${todo.length} buildings as heat sinks${capped}, ${fmt(mwh)} MWh/a in total?`)) return;
    add(todo);
    setStatus(`Added ${todo.length} buildings (${fmt(mwh)} MWh/a). Save the site to keep them.`);
  };

  return (
    // a section of the Heat sinks card (SitePage): the buildings around, to take heat sinks from
    <div className="site__atlas">
      <div className="site__buttons">
        <button type="button" className="btn btn--sm" onClick={() => void load()} disabled={tooBig || loading}>
          {loading ? "Loading…" : heat ? "Reload for this view" : "Load heat demand in view"}
        </button>
        {heat && (
          <>
            <button type="button" className="btn btn--sm" onClick={addAll} disabled={!site}>
              Add all in view
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setHeat(null)}>
              Hide
            </button>
            {lines && (
              <label className="net__show">
                <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} /> Heat line density
              </label>
            )}
          </>
        )}
        <InfoMark
          term="the heat demand in view"
          mark="?"
          hover
          text={`The buildings of this view (at most ${MAX_BOX_KM} × ${MAX_BOX_KM} km) from the local heat demand imports (the Wärmeatlas Hessen, the open atlases of app/sources/), coloured by their modelled heat demand; nothing is sent anywhere. Click one to add it as a heat sink.${credit ? ` Wärmebedarf ${credit}.` : ""}`}
        />
      </div>
      {tooBig && view && (
        <div className="site__hint">{`Zoom in: the view is ${fmt(view.width, 1)} × ${fmt(view.height, 1)} km, heat demand loads for at most ${MAX_BOX_KM} × ${MAX_BOX_KM} km.`}</div>
      )}
      {heat && (
        <div className="site__legend" aria-label="Heat demand legend">
          {HEAT_CLASSES.map((c, i) => (
            <span key={c.color}>
              <i style={{ background: c.color }} />
              {i === HEAT_CLASSES.length - 1 ? `> ${HEAT_CLASSES[i - 1].upTo}` : `≤ ${c.upTo}`}
            </span>
          ))}
          <span>MWh/a</span>
        </div>
      )}
      {heat && lines && showLines && (
        <div className="site__legend" aria-label="Heat line density legend">
          {LINE_CLASSES.map((c, i) => (
            <span key={c.color}>
              <i style={{ background: c.color }} />
              {i === LINE_CLASSES.length - 1 ? `> ${fmt(LINE_CLASSES[i - 1].upTo, 1)}` : `≤ ${fmt(c.upTo, 2)}`}
            </span>
          ))}
          <span>MWh/(m·a)</span>
          <InfoMark
            term="the heat line density"
            text={`Wärmeliniendichte: the modelled useful heat of the buildings its source assigns to each street segment, per metre of street and year (${fmt(lines.lines.length)} segments in view${lines.truncated ? ", the densest" : ""}). Under about 1.5 MWh/(m·a) a heat network rarely pays; the heat network's plan prefers the dense streets. Wärmeliniendichte ${lineCredit}.`}
          />
        </div>
      )}
      {heat && !lines && <div className="site__hint">No heat line density: run scripts/import_waermeatlas.py --rebuild once to import the street segments.</div>}
      {heat && (
        <div className="site__info-row">
          <NumberField label="Non-residential correction" value={factor} onChange={setFactor} min={0.1} max={5} step={0.05} unit="×" />
          <InfoMark
            term="the non-residential correction"
            text={`Multiplies the demand of non-residential buildings you add. LEA notes its modelled non-residential demand is about 45% below the state energy statistics (× 1.8 would undo that). Another municipality of Hessen: import it once with scripts/import_waermeatlas.py and its LEA delivery name (e.g. 06411000_Darmstadt); one of NRW: sources/nrw/fetch.py and its name (e.g. Bonn); it shows here with the others.`}
          />
        </div>
      )}
    </div>
  );
}
