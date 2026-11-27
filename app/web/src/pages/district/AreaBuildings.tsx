/**
 * Site map: the buildings of each drawn district (an area sink). As soon as an area is there (drawn, or with the saved
 * site) the Wärmeatlas buildings whose centre lies inside it load by themselves and show as points coloured by their
 * annual heat demand; their summed demand is the area's demand (areaDemand in waermeatlas.ts): set by itself while the
 * area has none of its own, else offered with "Use". The card lists each area's buildings and MWh.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { HeatPoint, Site } from "../../api";
import { errorMessage } from "../../lib/errors";
import { fmt } from "../../lib/format";
import { areaDemand, creditOf, heatColor, sinkId, tooltipHtml } from "./waermeatlas";
import { areaBuildingsOf } from "./loadAreaBuildings";

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "done"; demand: ReturnType<typeof areaDemand>; truncated: boolean };
const keyOf = (s: HeatPoint) => `${s.id}:${JSON.stringify(s.outline)}`; // a moved corner loads again

/** Whether the area's demand settings are those of its buildings. */
const sameDemand = (s: HeatPoint, d: NonNullable<ReturnType<typeof areaDemand>>) =>
  s.demand?.houses === d.demand.houses && s.demand?.kwhPerHouse === d.demand.kwhPerHouse;

/** The area with its buildings' demand; a profile chosen for it stays. */
const withDemand = (s: HeatPoint, d: NonNullable<ReturnType<typeof areaDemand>>): HeatPoint => ({
  ...s,
  demand: { ...d.demand, ...(s.demand?.profile ? { profile: s.demand.profile } : {}) },
  power_kw: d.power_kw,
});


interface Props {
  map: { current: L.Map | null };
  site: Site | null;
  update: (fn: (s: Site) => Site) => void;
  setStatus: (s: string | null) => void;
}

export default function AreaBuildings({ map, site, update, setStatus }: Props) {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const layer = useRef(L.layerGroup([]));
  const renderer = useRef<L.Renderer | null>(null);
  const areas = (site?.sinks ?? []).filter((s) => s.area && s.outline && s.outline.length >= 3);
  const say = useRef(setStatus);
  say.current = setStatus;

  // load each area's buildings once; an area without demand of its own takes theirs
  const wanted = areas.map(keyOf).join("|");
  // an area redrawn or removed while its buildings load: that answer must not set the demand of the area now there
  const current = useRef<string[]>([]);
  current.current = areas.map(keyOf);
  useEffect(() => {
    for (const a of areas) {
      const key = keyOf(a);
      if (loaded[key]) continue;
      setLoaded((l) => ({ ...l, [key]: { state: "loading" } }));
      areaBuildingsOf(a.outline!)
        .then(({ buildings, truncated }) => {
          if (!current.current.includes(key)) return;
          const demand = areaDemand(a.outline!, buildings);
          setLoaded((l) => ({ ...l, [key]: { state: "done", demand, truncated } }));
          if (!demand) return say.current(`${a.name}: no Wärmeatlas building inside.`);
          if (a.demand?.houses == null) {
            update((s) => ({ ...s, sinks: s.sinks.map((x) => (x.id === a.id ? withDemand(x, demand) : x)) }));
            say.current(`${a.name}: ${fmt(demand.buildings.length)} buildings, ${fmt(demand.mwh)} MWh/a heat demand. Save the site to keep it.`);
          }
        })
        .catch((e) => setLoaded((l) => ({ ...l, [key]: { state: "error", message: errorMessage(e) } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per area and outline
  }, [wanted]);

  // the buildings as points, over the areas' fill, under the bubbles
  const shown = areas.map((a) => loaded[keyOf(a)]).filter((x): x is Extract<Loaded, { state: "done" }> => x?.state === "done");
  const points = shown.flatMap((x) => x.demand?.buildings ?? []);
  const pointsKey = points.map(sinkId).join(",");
  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const m = map.current;
    if (!m || !points.length) return void g.remove();
    if (!renderer.current) {
      m.createPane("areaBuildings", m.getPane("overlayPane")!.parentElement!).style.zIndex = "410";
      renderer.current = L.svg({ pane: "areaBuildings" });
    }
    for (const b of points)
      L.circleMarker([b.lat, b.lon], {
        renderer: renderer.current,
        className: "site__area-building",
        radius: 3.5,
        color: "#7c2d12",
        weight: 0.6,
        fillColor: heatColor(b.total_kwh ?? 0),
        fillOpacity: 0.95,
      })
        .bindTooltip(tooltipHtml(b), { sticky: true })
        .addTo(g);
    g.options.attribution = `Wärmebedarf ${creditOf(points)}`;
    g.addTo(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redrawn when the set of buildings changes
  }, [pointsKey, map]);
  useEffect(() => () => void layer.current.remove(), []);

  if (!areas.length) return null;
  return (
    <div className="site__areas" aria-label="Districts' buildings">
      {areas.map((a) => {
        const l = loaded[keyOf(a)];
        const d = l?.state === "done" ? l.demand : null;
        return (
          <div key={a.id} className="site__hint">
            <b>{a.name}:</b>{" "}
            {!l || l.state === "loading"
              ? "loading its buildings…"
              : l.state === "error"
                ? l.message
                : !d
                  ? "no Wärmeatlas building inside"
                  : `${fmt(d.buildings.length)} buildings${l.truncated ? " (the largest)" : ""}, ${fmt(d.mwh)} MWh/a`}
            {d && !sameDemand(a, d) && (
              <>
                {" "}
                (its own demand set){" "}
                <button
                  type="button"
                  className="btn btn--xs"
                  onClick={() => update((s) => ({ ...s, sinks: s.sinks.map((x) => (x.id === a.id ? withDemand(x, d) : x)) }))}
                >
                  Use
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
