/**
 * The planned heat network on the Site map (HeatNetwork.tsx), in its own pane over the site's outlines: each pipe in
 * its role's colour (the transmission line's data-center water orange, the hot streets red, the house
 * connections thinner), as wide as its DN, with a soft glow by its load and the water as dots running along it
 * downstream (from the data center to the station, from the station out to the buildings), faster where the water
 * is faster at the hour shown and still where none flows; the supplied buildings tinted by their heat at that hour
 * (a large building at its peak the deepest);
 * the station pulsing with its heat pump's load, its boiler's flame shown while it runs. Drawn once per plan; an hour
 * only sets the elements' data and style (paint): the movement is CSS (district.css), no script per frame.
 */
import L from "leaflet";
import { fmt } from "../../lib/format";
import { escapeHtml } from "./html";
import type { HeatNetwork } from "./network";
import { copLabel, type Economics, type NetworkHour, type SizedPipe } from "./networkCost";
import { flowStep, heatStep } from "./networkView";

const KIND = { transmission: "Transmission line (data center → station)", distribution: "Distribution pipe", service: "House connection" };

/** Line width on the map by DN: DN20 thin, DN300 thick. */
const widthOf = (dn: number) => 1.5 + (4.5 * Math.log(dn / 20)) / Math.log(15);

const tipOf = (x: SizedPipe, now: NetworkHour["pipes"][number] | undefined) =>
  `<b>${KIND[x.pipe.kind]}</b><br>DN ${x.dn.dn}${x.dn.over ? ` (too small: ${x.dn.n} side by side)` : ""} · ${fmt(x.pipe.m)} m · sized for ${fmt(x.kw)} kW` +
  `<br>${x.pipe.buildings} building${x.pipe.buildings === 1 ? "" : "s"} · ${fmt(x.pipe.annualMwh)} MWh/yr · ${fmt(x.eurPerM)} €/m` +
  (now ? `<br><i>Now: ${fmt(now.kw)} kW, the water at ${fmt(now.velocity, 2)} m/s</i>` : "");

/** Draws the plan on `g` (not yet on the map); the returned paint shows an hour once `g` is on the map. */
export function drawNetwork(
  g: L.LayerGroup,
  renderer: L.Renderer,
  o: {
    net: HeatNetwork;
    econ: Economics;
    outlines: (L.LatLngExpression[] | null)[]; // each supplied building's (HeatNetwork.chosen's order)
    topKw: number; // a large one's peak hour: the buildings' tint is their heat now against it (the deepest from it up)
    sourceName: string;
    now: () => NetworkHour | null; // the hour shown, for the tooltips
    onStation: (at: { lat: number; lon: number }) => void;
  },
): (now: NetworkHour | null) => void {
  const { net, econ } = o;
  const houses = o.outlines.map((ring) => ring && L.polygon(ring, { renderer, className: "net__house", weight: 1.5, interactive: false }).addTo(g));
  // under the pipes a wide soft line by the load (the trunk and the streets only: few, the house connections are many)
  const halos = econ.pipes.map((x) =>
    x.pipe.kind === "service"
      ? null
      : L.polyline(x.pipe.line, { renderer, className: `net__halo net__halo--${x.pipe.kind}`, weight: widthOf(x.dn.dn) + 7, interactive: false }).addTo(g),
  );
  const widths = econ.pipes.map((x) => (x.pipe.kind === "service" ? 2 : widthOf(x.dn.dn)));
  econ.pipes.forEach((x, i) =>
    L.polyline(x.pipe.line, { renderer, className: `net__pipe net__pipe--${x.pipe.kind}`, weight: widths[i] })
      .bindTooltip(() => tipOf(x, o.now()?.pipes[i]), { sticky: true })
      .addTo(g),
  );
  const flows = econ.pipes.map((x, i) =>
    L.polyline(x.pipe.line, { renderer, className: `net__flow net__flow--${x.pipe.kind}`, weight: Math.max(1.2, widths[i] * 0.35), interactive: false }).addTo(
      g,
    ),
  );
  const icon = L.divIcon({
    className: "net__station",
    html: '<span class="net__station-hp">HP</span><span class="net__station-boiler"></span>',
    iconSize: [30, 30],
  });
  const station = L.marker([net.station!.lat, net.station!.lon], { icon, draggable: true, keyboard: false, bubblingMouseEvents: false })
    .bindTooltip(() => {
      const now = o.now();
      return (
        `<b>Heat-pump station</b><br>${fmt(econ.hpKw)} kW heat · ${copLabel(econ.cop)} · peak boiler ${fmt(econ.boilerKw)} kW` +
        `<br>${escapeHtml(o.sourceName)} → ${fmt(net.m.transmission)} m` +
        (now ? `<br><i>Now: heat pump ${fmt(now.hpKw)} kW, boiler ${fmt(now.boilerKw)} kW</i>` : "") +
        "<br><i>Drag to move it: the plan follows</i>"
      );
    })
    .on("dragend", (e) => {
      const at = (e.target as L.Marker).getLatLng();
      o.onStation({ lat: at.lat, lon: at.lng });
    })
    .addTo(g);

  const svg = (l: L.Path | null) => l?.getElement() as SVGElement | undefined;
  return (now) => {
    if (!now) return;
    econ.pipes.forEach((x, i) => {
      const p = now.pipes[i];
      const load = (x.kw > 0 ? Math.min(1.5, p.kw / x.kw) : 0).toFixed(2);
      const f = svg(flows[i]);
      if (f) {
        f.dataset.v = String(flowStep(p.velocity));
        f.style.setProperty("--net-load", load);
      }
      svg(halos[i])?.style.setProperty("--net-load", load);
    });
    houses.forEach((h, i) => {
      const el = svg(h);
      if (el) el.dataset.q = String(heatStep(now.buildingKw[i], o.topKw));
    });
    const el = station.getElement();
    if (el) {
      el.style.setProperty("--net-hp", (econ.hpKw > 0 ? Math.min(1, now.hpKw / econ.hpKw) : 0).toFixed(2));
      el.dataset.boiler = now.boilerKw > 1 ? "1" : "0";
    }
  };
}
