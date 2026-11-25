/**
 * The Quick analysis's tree KPI: the CO₂ the heat recovery saves in a year as a grove, the trees that take up as much
 * in a year (trees.ts). One icon is a round number of trees, the last a sapling of its share; the grove grows (each new
 * tree springs up) as the site is edited. Nothing saved, no grove. Its button draws the forest on the Site map in the
 * Frankfurter Stadtwald (or the nearest forest), as soccer fields side by side, and flies there; pressed again it goes
 * back. "Place the area" puts it where the next click on the map is.
 */
import L from "leaflet";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmt } from "../../lib/format";
import { useSnapshotDetail } from "../../lib/live";
import { nearestForest } from "./osm";
import {
  FIELD_SOURCE,
  fieldBlock,
  fieldsFor,
  FOREST_CO2_T_PER_HA,
  FOREST_SOURCE,
  FOREST_TREES_PER_HA,
  forestOf,
  grove,
  MAX_FIELDS,
  roughly,
  nearFrankfurt,
  STADTWALD_CENTRE,
  STADTWALD_HA,
  TREE_KG_PER_YEAR,
  TREE_SOURCE,
  homesLine,
} from "./trees";

const ROW = 20; // icons in the front row; the rest stand behind it
const W = 320;
const CELL = W / ROW;
const LINES_ZOOM = 14; // the pitch lines from this zoom on, a field some 17 px long; below they only blur it
type MapRef = { current: L.Map | null } | undefined;

/** A headline number of fields or hectares: a decimal below 10 (half a field is not none), else roughly. */
const about = (x: number) => (x < 10 ? fmt(x, 1) : fmt(roughly(x)));

/** One tree, its foot at (0, 0), 26 high: a fir or a round broadleaf, so the grove reads as a wood and not as a chart. */
function Tree({ fir }: { fir: boolean }) {
  return fir ? (
    <>
      <rect className="grove__trunk" x={-1.2} y={-6} width={2.4} height={6} />
      <polygon className="grove__crown" points="0,-26 -6,-16 -3.5,-16 -8,-6 8,-6 3.5,-16 6,-16" />
    </>
  ) : (
    <>
      <rect className="grove__trunk" x={-1.3} y={-9} width={2.6} height={9} />
      <circle className="grove__crown grove__crown--leaf" cx={0} cy={-16} r={8} />
      <circle className="grove__shine" cx={-2.6} cy={-18.6} r={2.6} />
    </>
  );
}

/**
 * `ha` of forest on the map while `on`: soccer fields side by side in the forest at `at` (fieldBlock), all in one path so
 * that thousands draw as fast as one, their pitch lines once zoomed in, the label (`tip`, HTML) always shown under it.
 */
function useFields(map: MapRef, on: boolean, ha: number, tip: string, at: [number, number]) {
  const kind = "co2";
  const n = fieldsFor(ha);
  const [lat, lon] = at; // its numbers are the key: the place is a new array on every render
  useEffect(() => {
    const m = map?.current;
    if (!on || !m) return;
    const b = fieldBlock(n, [lat, lon]);
    const lines = L.polyline(b.lines, { className: "grove__pitch", interactive: false });
    const [[s, w], [, e]] = b.bounds;
    const outline = L.rectangle(b.bounds, { className: `grove__block grove__block--${kind}`, interactive: false });
    const g = L.layerGroup([
      L.polygon(
        b.fields.map((f) => [f]),
        { className: `grove__fields grove__fields--${kind}`, interactive: false },
      ),
      outline,
      // the label under the block, not on it: on a few fields it would hide them all
      L.tooltip({ permanent: true, direction: "bottom", className: `grove__forest-label grove__forest-label--${kind}` })
        .setLatLng([s, (w + e) / 2])
        .setContent(tip),
    ]).addTo(m);
    const zoomed = () => void (m.getZoom() >= LINES_ZOOM ? g.addLayer(lines) : g.removeLayer(lines));
    zoomed();
    m.on("zoomend", zoomed);
    return () => {
      m.off("zoomend", zoomed);
      g.remove();
    };
  }, [map, on, n, kind, tip, lat, lon]);
}

/**
 * The grove of `co2T` t of CO₂ saved a year, with its headline and its Stadtwald button; `heatMwh` (delivered a year)
 * only for the label's everyday terms; null when nothing is saved.
 */
export default function TreeGrove({ co2T, heatMwh, map, near }: { co2T: number; heatMwh: number; map?: MapRef; near?: { lat: number; lon: number } | null }) {
  // where the forest is drawn: the Frankfurter Stadtwald by Frankfurt (local, no internet), elsewhere the nearest forest
  // around the data center, asked of OpenStreetMap on the first click (the Stadtwald when it does not answer)
  const local = !near || nearFrankfurt(near.lat, near.lon);
  const [forest, setForest] = useState<{ at: [number, number]; name: string | null; for: string } | null>(null);
  const key = near ? `${near.lat},${near.lon}` : "";
  const found: [number, number] = !local && forest?.for === key ? forest.at : STADTWALD_CENTRE;
  const [dragged, setDragged] = useState<[number, number] | null>(null); // where the user placed the forest
  const at = dragged ?? found;
  const [seeking, setSeeking] = useState(false);
  const findForest = async (): Promise<[number, number]> => {
    if (dragged) return dragged;
    if (local || !near) return STADTWALD_CENTRE;
    if (forest?.for === key) return forest.at;
    setSeeking(true);
    const f = await nearestForest(near.lat, near.lon).catch(() => null);
    setSeeking(false);
    const there: [number, number] = f ? [f.lat, f.lon] : STADTWALD_CENTRE;
    setForest({ at: there, name: f?.name ?? null, for: key });
    return there;
  };
  const g = grove(co2T);
  const [shown, setShown] = useState<boolean>(false);
  const back0 = useRef<{ c: L.LatLng; z: number } | null>(null); // the view before the flight, to go back to
  const has = g.icons.length > 0;
  const co2Ha = forestOf(g.trees).ha;
  const co2Label = `≈ ${about(fieldsFor(co2Ha))} soccer fields · ${about(co2Ha)} ha of forest`;
  // the year's heat in everyday terms, in the forest's label (lib/heatFacts.ts)
  const homes = `<br>${homesLine(heatMwh, co2T)}`;
  // numbers only in the tooltips' HTML, nothing from the site
  const notes = (ha: number) =>
    (fieldsFor(ha) > MAX_FIELDS ? `<br><small>drawn as one area: too many fields to draw one by one</small>` : "") +
    (local && ha > STADTWALD_HA ? `<br><small>more than the whole Frankfurter Stadtwald, about ${fmt(STADTWALD_HA)} ha</small>` : "");
  useFields(
    map,
    has && shown,
    co2Ha,
    `<b>${co2Label}</b>${homes}<br><small>a hectare of Hessian forest takes up ${fmt(FOREST_CO2_T_PER_HA, 1)} t of CO₂ a year as it grows: ${fmt(roughly(g.trees))} trees at about ${fmt(roughly(FOREST_TREES_PER_HA))} per ha; a soccer field 105 × 68 m</small>${notes(co2Ha)}`,
    at,
  );
  // "Place the area": the next click on the map is the forest's centre, drawn there (Esc: not placed); the map stays
  // where the user moved it
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    const m = map?.current;
    if (!placing || !m) return;
    const box = m.getContainer();
    const put = (ev: L.LeafletMouseEvent) => {
      setDragged([ev.latlng.lat, ev.latlng.lng]);
      setShown(true);
      setPlacing(false);
    };
    const esc = (ev: KeyboardEvent) => void (ev.key === "Escape" && setPlacing(false));
    box.classList.add("grove-placing");
    m.on("preclick", put); // before any layer takes the click: a heat sink under it does not swallow it
    document.addEventListener("keydown", esc);
    return () => {
      box.classList.remove("grove-placing");
      m.off("preclick", put);
      document.removeEventListener("keydown", esc);
    };
  }, [map, placing]);
  // what the map shows, for the assistant (lib/live.ts)
  useSnapshotDetail(() => ({
    quick_analysis_stadtwald: !has || !shown ? "nothing drawn" : `CO₂ forest: ${co2Label}`,
  }));
  if (!has) return null;
  const front = g.icons.slice(0, ROW);
  const back = g.icons.slice(ROW);
  const unit = g.per === 1 ? "one tree" : `${fmt(g.per)} trees`;
  const said = `About ${fmt(g.shown)} trees: the ${fmt(co2T, 1)} t of CO₂ saved a year is what that many grown trees take up in a year (about ${fmt(TREE_KG_PER_YEAR, 1)} kg each). One tree icon is ${unit}.`;
  // the forest's button: draws it and flies there, or, drawn, goes back
  const show = async (panel: Element | null) => {
    const m = map?.current;
    const next = !shown;
    const where = next ? await findForest() : at;
    if (m && next) {
      back0.current = { c: m.getCenter(), z: m.getZoom() };
      // the padding keeps the fields clear of the Site panel floating over the map, on whichever side it is
      const c = m.getContainer().getBoundingClientRect();
      const p = panel?.getBoundingClientRect();
      const left = p && p.left - c.left < c.right - p.right ? Math.max(0, p.right - c.left) : 0;
      const right = p && !left ? Math.max(0, c.right - p.left) : 0;
      const bounds = fieldBlock(fieldsFor(co2Ha), where).bounds;
      // and room below for its label; a few fields come close enough to see their lines
      m.flyToBounds(bounds, { duration: 1.2, maxZoom: 17, paddingTopLeft: [left + 24, 24], paddingBottomRight: [right + 24, 130] });
    } else if (m && near) m.flyTo([near.lat, near.lon], back0.current?.z ?? m.getZoom(), { duration: 1.2 }); // hidden: back to the data center
    else if (m && back0.current) m.flyTo(back0.current.c, back0.current.z, { duration: 1.2 });
    setShown(next);
  };
  // a tree's place: the front row centred on the ground, the back row higher, smaller and between the front's trees
  const place = (row: number[], i: number, isBack: boolean) => {
    const x = (W - row.length * CELL) / 2 + (i + (isBack ? 1 : 0.5)) * CELL;
    const s = (isBack ? 0.72 : 0.95) * (0.85 + (0.15 * ((i * 7 + (isBack ? 3 : 0)) % 5)) / 4); // a little uneven, as a real wood
    return `translate(${x.toFixed(1)} ${isBack ? 42 : 58}) scale(${s.toFixed(3)})`;
  };
  const trees = (row: number[], isBack: boolean, from: number) =>
    row.map((size, i) => (
      <g key={from + i} transform={place(row, i, isBack)}>
        <g className={size < 1 ? "grove__tree grove__tree--young" : "grove__tree"} style={{ "--i": from + i } as CSSProperties}>
          <g transform={size < 1 ? `scale(${Math.max(0.3, Math.sqrt(size)).toFixed(3)})` : undefined}>
            <Tree fir={(from + i) % 3 !== 1} />
          </g>
        </g>
      </g>
    ));

  return (
    <div className="grove">
      <div role="img" aria-label={said} title={`${said}\nSource: ${TREE_SOURCE}. An order of magnitude: species, age and site vary it.`}>
        <div className="grove__head">
          <span className="mono grove__count">≈ {fmt(g.shown)}</span>
          <span className="grove__what">
            <b>trees</b> take up the {fmt(co2T, 1)} t of CO₂ saved, in a year
          </span>
        </div>
        <svg className="grove__wood" viewBox={`0 8 ${W} 54`} aria-hidden="true">
          <path className="grove__hill" d={`M0 62 Q${W / 4} 44 ${W / 2} 52 T${W} 50 V62 Z`} />
          <g className="grove__back">{trees(back, true, ROW)}</g>
          {trees(front, false, 0)}
          <path className="grove__ground" d={`M0 58.5 H${W}`} />
        </svg>
      </div>
      <div className="grove__note">
        one <span className="grove__key" aria-hidden="true" /> = {unit} · ≈ {fmt(TREE_KG_PER_YEAR, 1)} kg CO₂ per tree a year (a grown tree)
      </div>
      {map && (
        <div className="grove__forest-row">
          <button
            type="button"
            className="btn btn--xs"
            aria-pressed={shown}
            title={`The forest these trees make: ${FOREST_SOURCE}; ${FIELD_SOURCE}`}
            onClick={(e) => void show(e.currentTarget.closest(".site__panel"))}
            disabled={seeking}
          >
            {seeking ? "Looking for the nearest forest…" : shown ? "Hide the forest" : "Show in the forest"}
          </button>
          <button
            type="button"
            className="btn btn--xs"
            aria-pressed={placing}
            title="Move the map to where you want the forest, press this, then click on the map: the area is drawn there (Esc: cancel)"
            onClick={() => setPlacing((p) => !p)}
          >
            {placing ? "Click on the map…" : "Place the area"}
          </button>
          {shown && (
            <span className="grove__forest-says" role="status">
              {co2Label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
