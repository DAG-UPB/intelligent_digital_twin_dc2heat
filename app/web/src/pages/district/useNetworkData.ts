/**
 * The heat network's data (HeatNetwork.tsx): the streets it is planned on (set by the card: the stored ones or
 * OpenStreetMap's), the site as it was 200 ms ago with a drawn district's Wärmeatlas houses as buildings, and the
 * streets' heat line density of the network's box. Houses and heat lines load only once the card plans (`planned`);
 * the plan waits for both (`inputs` / `heatLines` null while loading).
 */
import { useEffect, useMemo, useState } from "react";
import { fetchHeatLines, type HeatLine, type Site, type StreetWay, type WaermeatlasBuilding } from "../../api";
import { annualMwh, demandEntries } from "../../lib/demand";
import { errorMessage } from "../../lib/errors";
import { streetBox, type HeatLineIn } from "./network";
import { areaBuildingsOf } from "./loadAreaBuildings";
import { areasAsBuildings, tiles } from "./waermeatlas";

export function useNetworkData(site: Site | null, planned: boolean) {
  const [streets, setStreets] = useState<{ ways: StreetWay[]; from: string } | null>(null);
  const [noStreets, setNoStreets] = useState<string | null>(null); // why none are stored: then OpenStreetMap on a click
  // the site as it was 200 ms ago: typing a power or adding sinks in a row plans once
  const [typed, setTyped] = useState(site);
  useEffect(() => {
    const t = window.setTimeout(() => setTyped(site), 200);
    return () => window.clearTimeout(t);
  }, [site]);
  // a drawn district is supplied building by building: its Wärmeatlas buildings (the local import), each with its share
  // of the district's demand (waermeatlas.ts areasAsBuildings); the plan waits for them, as for the heat lines
  const areas = useMemo(() => (typed?.sinks ?? []).filter((s) => s.area && s.outline), [typed]);
  const areaKey = planned ? areas.map((a) => `${a.id}:${JSON.stringify(a.outline)}`).join("|") : "";
  const [areaHouses, setAreaHouses] = useState<{ key: string; byArea: Map<string, WaermeatlasBuilding[]> }>({ key: "", byArea: new Map() });
  useEffect(() => {
    if (!areaKey) return;
    let live = true;
    type Got = [string, WaermeatlasBuilding[]];
    Promise.all(areas.map((a) => areaBuildingsOf(a.outline!).then((r): Got => [a.id, r.buildings], (): Got => [a.id, []]))).then(
      (got) => live && setAreaHouses({ key: areaKey, byArea: new Map(got) }), // none loaded: the district stays one sink
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the areas' identity (their outlines) is areaKey: areas itself is new with every site
  }, [areaKey]);
  const inputs = useMemo(() => {
    if (!typed || !areaKey) return typed;
    if (areaHouses.key !== areaKey) return null; // still loading
    const kwh = new Map(demandEntries(typed).map((e) => [e.id, annualMwh(e.settings) * 1000]));
    return areasAsBuildings(typed, areaHouses.byArea, (id) => kwh.get(id) ?? null);
  }, [typed, areaKey, areaHouses]);

  const src = inputs?.source;
  // the streets' heat line density of the network's box (the local Wärmeatlas import, tile by tile): the pipes prefer
  // the dense streets; none imported, or a box of more than 16 tiles: the plan without (note says why)
  const box = inputs?.source ? streetBox([inputs.source, ...inputs.sinks]) : null;
  const boxKey = box && planned ? box.map((v) => v.toFixed(4)).join(",") : "";
  const [lines, setLines] = useState<{ key: string; lines: HeatLineIn[]; note: string | null }>({ key: "", lines: [], note: null });
  useEffect(() => {
    if (!boxKey) return;
    let live = true;
    const parts = tiles(boxKey.split(",").map(Number) as [number, number, number, number]);
    if (!parts.length) return void setLines({ key: boxKey, lines: [], note: "the area is too large to load the heat line density" });
    Promise.all(parts.map(fetchHeatLines))
      .then((boxes) => {
        const byId = new Map<number, HeatLine>();
        for (const b of boxes) for (const l of b.lines) byId.set(l.id, l);
        const got = [...byId.values()].map((l) => ({ line: l.line, mwhPerM: l.mwh_per_m }));
        if (live) setLines({ key: boxKey, lines: got, note: got.length ? null : "no street with heat in the Wärmeatlas here" });
      })
      .catch((e) => live && setLines({ key: boxKey, lines: [], note: errorMessage(e) }));
    return () => {
      live = false;
    };
  }, [boxKey]);
  const heatLines = lines.key === boxKey ? lines.lines : null; // null: still loading (the plan waits for them)
  return { streets, setStreets, noStreets, setNoStreets, inputs, src, box, lines, heatLines };
}
