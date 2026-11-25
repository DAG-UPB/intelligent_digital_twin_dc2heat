/**
 * The Leaflet map of the Site page: created once on the returned element ref, with Street / Dark / Satellite
 * base layers and the example data centers as an overlay (built in, plus the machine-local ones the backend serves). The street map follows the app's light/dark theme (a chosen Satellite layer stays). It turns
 * (leaflet-rotate, GPL-3.0: ⟲ ⟳ by 15°, the north arrow back to north; shift + drag or two fingers too). Map clicks
 * go to the latest `onClick`, so the caller can pass a fresh closure on every render. `bounds` is the view after
 * every move (null until the map exists).
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-rotate"; // patches the global L that leaflet sets: L.map takes `rotate`, the map gets setBearing
import { fetchMapExamples } from "../../api";
import { currentTheme, useThemeKey } from "../../app/theme";
import { DATASET } from "../../dataset";
import { drawExampleDataCenters } from "./drawSite";

const START: [number, number] = [50.1131, 8.672]; // Frankfurt, until the site's data center is known
export const ZOOM = 17;
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Where the map was when the page was left (this tab, also across a reload): coming back to the same data center shows
 * it there again, not centred anew. */
type Left = { dataset: string; at: [number, number]; zoom: number; bearing: number };
const LEFT_KEY = "site-map-left";
let left: Left | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(LEFT_KEY) ?? "null") as Left | null;
  } catch {
    return null;
  }
})();
export const leftView = () => (left?.dataset === DATASET ? left : null);
/** `dataset`: the one the map opened on (DATASET already names the next page's when this page closes). */
function keepLeft(m: L.Map & { getBearing(): number }, dataset: string) {
  const el = m.getContainer();
  if (el.isConnected && !el.clientWidth) return; // hidden beside Planning: a resize then gives it size 0, its centre wrong
  const c = m.getCenter();
  left = { dataset, at: [c.lat, c.lng], zoom: m.getZoom(), bearing: m.getBearing() };
  try {
    sessionStorage.setItem(LEFT_KEY, JSON.stringify(left));
  } catch {
    /* storage off: kept until a reload */
  }
}

/** The map with leaflet-rotate's bearing (degrees clockwise from north). */
type Turning = L.Map & { setBearing(deg: number): void; getBearing(): number };

/** ⟲ ⟳ and the north arrow (its needle points north as the map turns; a click goes back to north), as a Leaflet bar. */
function turnControl(m: Turning): HTMLElement {
  const bar = L.DomUtil.create("div", "leaflet-bar site__turn");
  const button = (text: string, label: string, go: () => void) => {
    const b = L.DomUtil.create("a", "", bar);
    b.href = "#";
    b.role = "button";
    b.innerHTML = text;
    b.title = label;
    b.setAttribute("aria-label", label);
    L.DomEvent.on(b, "click", (e) => {
      L.DomEvent.preventDefault(e);
      go();
    });
    return b;
  };
  button("⟲", "Turn the map left", () => m.setBearing(m.getBearing() - 15));
  const north = button('<span class="site__needle">▲</span>', "North up", () => m.setBearing(0));
  button("⟳", "Turn the map right", () => m.setBearing(m.getBearing() + 15));
  const needle = north.firstElementChild as HTMLElement;
  m.on("rotate", () => (needle.style.transform = `rotate(${-m.getBearing()}deg)`));
  L.DomEvent.disableClickPropagation(bar);
  return bar;
}

export function useSiteMap(onClick: (lat: number, lon: number) => void) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef(L.layerGroup()); // the site's outlines and bubbles, redrawn by the page
  const streets = useRef<{ light: L.TileLayer; dark: L.TileLayer } | null>(null);
  const click = useRef(onClick);
  click.current = onClick;
  const themeKey = useThemeKey();
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  // the map's own tools (zoom, the layers), for the page to place in its panel (they work wherever they sit)
  const [tools, setTools] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!el.current) return;
    const osm = { maxZoom: 19, attribution: "© OpenStreetMap contributors" };
    const light = L.tileLayer(OSM_TILES, osm);
    // Esri World Dark Gray Canvas: keyless (CARTO dark_all now serves "API key required" tiles with status 200)
    const dark = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      maxNativeZoom: 16,
      attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
    });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri" });
    streets.current = { light, dark };
    const m = L.map(el.current, {
      layers: [currentTheme() === "dark" ? dark : light],
      zoomControl: false,
      // smooth zooming: quarter steps, and a trackpad's scroll takes more pixels per level (default: whole levels, 60 px)
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      wheelPxPerZoomLevel: 90,
      rotate: true,
      rotateControl: false,
      touchRotate: true,
      shiftKeyRotate: true,
      bearing: 0,
    } as L.MapOptions) as Turning;
    const dataset = DATASET;
    const back = leftView();
    m.setView(back?.at ?? START, back?.zoom ?? ZOOM);
    if (back) m.setBearing(back.bearing);
    const zoom = L.control.zoom().addTo(m);
    const turn = turnControl(m);
    // the example data centers as a standard layer, on by default except on Blank (switch it in the layer control); the
    // machine-local ones join when they arrive, and without them (or on an error) only the built-in ones show
    const examples = L.layerGroup();
    drawExampleDataCenters(examples);
    fetchMapExamples()
      .then((local) => local.length && drawExampleDataCenters(examples, local))
      .catch(() => undefined);
    if (DATASET !== "sim_blank") examples.addTo(m); // Blank: an empty map, the examples only when switched on
    const layers = L.control.layers({ Street: light, Dark: dark, Satellite: sat }, { "Data centers (example)": examples }).addTo(m);
    // folded to its icon, opened by a click and kept open (a click on the icon again, or on the map, folds it): opened
    // on hover it folded as soon as the pointer left, on the way to a layer. ponytail: unhooks Leaflet 1.9's own hover
    // handlers by their (private) names; on a Leaflet upgrade check the menu still stays open
    const box = layers.getContainer()!;
    const own = layers as unknown as { _expandSafely: () => void };
    L.DomEvent.off(box, { mouseenter: own._expandSafely, mouseleave: layers.collapse }, layers);
    const toggle = box.querySelector<HTMLElement>(".leaflet-control-layers-toggle");
    if (toggle) {
      // Leaflet's own click opens it; open before the click: this one folds it again
      let wasOpen = false;
      L.DomEvent.on(toggle, "pointerdown", () => (wasOpen = box.classList.contains("leaflet-control-layers-expanded")));
      L.DomEvent.on(toggle, "click", () => wasOpen && layers.collapse());
    }
    setTools([zoom.getContainer()!, turn, layers.getContainer()!]);
    layer.current.addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => click.current(e.latlng.lat, e.latlng.lng));
    m.on("moveend", () => {
      setBounds(m.getBounds());
      keepLeft(m, dataset); // every move, not only on leaving: a reload or a crash keeps it too
    });
    setBounds(m.getBounds());
    map.current = m;
    return () => {
      keepLeft(m, dataset); // left mid-move, before its moveend
      m.remove();
      map.current = null;
    };
  }, []);

  // Street <-> Dark on a theme change; only when one of the two is showing.
  useEffect(() => {
    const m = map.current;
    const b = streets.current;
    if (!m || !b) return;
    const [want, other] = currentTheme() === "dark" ? [b.dark, b.light] : [b.light, b.dark];
    if (m.hasLayer(other)) {
      m.removeLayer(other);
      m.addLayer(want);
    }
  }, [themeKey]);

  return { el, map, layer, bounds, tools };
}
