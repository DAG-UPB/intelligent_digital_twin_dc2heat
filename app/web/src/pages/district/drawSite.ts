/**
 * Draws a site onto a Leaflet layer: the data center's building (red outline), sink buildings (blue) and
 * drawn district areas (dashed blue), the area being drawn (dashed line with corner markers), and one bubble
 * per heat source / sink (see bubbles.ts; a sink's size by its peak hour, sinkProfile.ts bubbleKw). A sink's tooltip
 * (its outline's and its bubble's) shows its profile, when it has one, built when it opens (sinkProfile.ts); a click
 * keeps it shown (a popup), with a button to its profile in
 * the district's Modelling. `supplied`: the Heat distribution card's supplied sinks while its network is on the map: only
 * they are drawn, an unseen outline (the network tints the building) for the tooltip, no bubble. Clears the layer first.
 */
import L from "leaflet";
import type { ExampleDataCenter, HeatPoint, Site } from "../../api";
import { bubbleColor, radiusScale } from "./bubbles";
import { BUILT_IN_EXAMPLES, heatLabel, markerRadius } from "./frankfurtDataCenters";
import { demandEntries, type DemandEntry } from "../../lib/demand";
import { escapeHtml } from "./html";
import { bubbleKw, profileHtml, sinkLine } from "./sinkProfile";
import type { Ring } from "./osm";

const DRAFT = "#34435b";

type Entry = Pick<DemandEntry, "id" | "name" | "settings">;

/** What a sink's tooltip says (on hover): its name, and its supply temperature and peak as its demand has them
 * (sinkProfile.ts sinkLine: what the calculations read, not the bubble's temp_c and power_kw). */
export const sinkHtml = (p: Pick<HeatPoint, "name">, e: Entry | undefined) => `<b>${escapeHtml(p.name)}</b>${e ? `<br>${sinkLine(e.settings)}` : ""}`;

/** A sink's popup (opened by a double click, kept open): its tooltip, the way to its profile, and
 * (`onRemove`) a button taking it out of the district. */
export function sinkCard(
  p: Pick<HeatPoint, "id" | "name">,
  e: Entry | undefined,
  onProfile?: (id: string) => void,
  onRemove?: (id: string) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = sinkHtml(p, e) + (e ? profileHtml(e) : ""); // its profile (Automatic, from the weather, unless one is chosen)
  if (e && onProfile) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--sm site__tip-go";
    go.textContent = "Its profile in Modelling →";
    go.addEventListener("click", () => onProfile(e.id));
    el.append(go);
  }
  if (onRemove) {
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn--sm btn--ghost site__tip-go";
    rm.textContent = "Remove from the district";
    rm.addEventListener("click", () => onRemove(p.id));
    el.append(rm);
  }
  return el;
}

/** The sink's card on a double click, not a click (a click stays the map's: placing, picking), and roomier than
 * Leaflet's default. ponytail: unhooks Leaflet 1.9's own click opener by its (private) name; on a Leaflet upgrade check
 * a single click still opens nothing. */
function popupOnDoubleClick(l: L.Path, card: () => HTMLElement): L.Path {
  // keepInView: a drag that would push the open card past the map's edge pans it back inside
  l.bindPopup(card, { className: "site__sink-pop", minWidth: 320, maxWidth: 400, keepInView: true, autoPanPadding: [16, 16] });
  l.off("click", (l as unknown as { _openPopup: L.LeafletEventHandlerFn })._openPopup, l);
  return l.on("dblclick", (e: L.LeafletMouseEvent) => {
    L.DomEvent.stop(e); // not the map's double-click zoom
    l.openPopup(e.latlng);
  });
}

export function drawSite(
  layer: L.LayerGroup,
  site: Site,
  draft: Ring,
  onProfile?: (id: string) => void,
  supplied?: Set<string> | null,
  onRemove?: (id: string) => void,
  useFills?: Map<string, string> | null, // a sink's bubble in its building's use colour (waermeatlas.ts), else by its temperature
) {
  layer.clearLayers();
  const sinks = supplied ? site.sinks.filter((s) => supplied.has(s.id)) : site.sinks;
  const entries = new Map(demandEntries(site).map((e) => [e.id, e]));
  const sinkTip = (p: HeatPoint) => () => `${sinkHtml(p, entries.get(p.id))}<br><small>Double-click: its profile</small>`;
  const sinkPopup = (p: HeatPoint) => () => sinkCard(p, entries.get(p.id), onProfile, onRemove);
  if (site.building) {
    L.polygon(site.building.outline, { color: "#dc2626", weight: 2, fillOpacity: 0.08 }).bindTooltip(escapeHtml(site.building.name)).addTo(layer);
  }
  // supplied: unseen (the network's tint is drawn over it), there for its tooltip and popup
  const hidden = supplied ? { opacity: 0, fillOpacity: 0 } : {};
  for (const s of sinks)
    if (s.outline)
      popupOnDoubleClick(
        L.polygon(
          s.outline,
          s.area
            ? { color: "#1f4fa8", weight: 3, dashArray: "8 5", fillColor: "#2e6fd8", fillOpacity: 0.2, ...hidden }
            : { color: "#2563eb", weight: 1.5, fillOpacity: 0.08, ...hidden },
        ).bindTooltip(sinkTip(s), { sticky: true }),
        sinkPopup(s),
      ).addTo(layer);
  if (draft.length) {
    L.polyline(draft.length > 2 ? [...draft, draft[0]] : draft, { color: DRAFT, weight: 3, dashArray: "6 4" }).addTo(layer);
    draft.forEach((pt) => L.circleMarker(pt, { radius: 5, color: DRAFT, fillColor: "#ffffff", fillOpacity: 1, weight: 2 }).addTo(layer));
  }
  const points = [...(site.source ? [site.source] : []), ...site.sinks]; // the bubbles' scale: all of them, as without supplied
  if (!points.length) return;
  // a sink by its peak hour (as its row), not its stored power_kw, which no calculation reads
  const kwOf = new Map(points.map((p) => [p, bubbleKw(p, p === site.source ? undefined : entries.get(p.id))]));
  const r = radiusScale([...kwOf.values()]);
  const bubble = (p: HeatPoint, kind: "source" | "sink") => {
    const c = bubbleColor(kind, p.temp_c);
    const fill = (kind === "sink" && useFills?.get(p.id)) || c.fill;
    const m = L.circleMarker([p.lat, p.lon], { radius: r(kwOf.get(p) ?? p.power_kw), color: c.stroke, weight: 1.5, fillColor: fill, fillOpacity: 0.9 });
    if (kind === "sink") popupOnDoubleClick(m.bindTooltip(sinkTip(p)), sinkPopup(p));
    else m.bindTooltip(`${escapeHtml(p.name)}<br>${p.temp_c} °C · ${p.power_kw} kW`);
    m.addTo(layer);
  };
  sinks.forEach((s) => !(supplied && s.outline) && bubble(s, "sink"));
  if (site.source) bubble(site.source, "source"); // on top
}

/**
 * The built-in example data centers plus the machine-local ones (`local`) as labelled red markers (the app's datasets
 * as red rings) on `layer` (clicks on them do not reach the map).
 */
export function drawExampleDataCenters(layer: L.LayerGroup, local: ExampleDataCenter[] = []) {
  layer.clearLayers();
  for (const d of [...BUILT_IN_EXAMPLES, ...local]) {
    // The app's own datasets: red outline with a white fill, to tell them from the real sites.
    const fill = d.appDataset ? { weight: 2.5, fillColor: "#ffffff", fillOpacity: 0.9 } : { weight: 1.5, fillColor: "#dc2626", fillOpacity: 0.75 };
    // the building itself, preloaded (red outline like the selected data center), under its marker; display only,
    // so clicks still reach the map (picking a building, placing sinks, drawing areas)
    for (const ring of d.buildings ?? []) L.polygon(ring, { color: "#dc2626", weight: 2, fillColor: "#dc2626", fillOpacity: 0.12, interactive: false }).addTo(layer);
    L.circleMarker([d.lat, d.lon], { radius: markerRadius(d.heatKw), color: "#7f1d1d", ...fill, bubblingMouseEvents: false })
      // the app's own datasets share one building: no one figure is theirs (the open data center's bubble has its own)
      .bindTooltip(d.appDataset ? escapeHtml(d.name) : `${escapeHtml(d.name)} · ${heatLabel(d.heatKw)}`, { permanent: true, direction: d.labelLeft ? "left" : "right", offset: [d.labelLeft ? -8 : 8, 0], className: "site__dc-label" })
      .bindPopup(
        `<strong>${escapeHtml(d.name)}</strong><br>${escapeHtml(d.address)}<br>` +
          (d.appDataset ? "" : `Waste heat up to <strong>${heatLabel(d.heatKw)}</strong><br>`) +
          `<small>${escapeHtml(d.basis)} · <a href="${escapeHtml(d.source)}" target="_blank" rel="noreferrer">source</a></small>`,
      )
      .addTo(layer);
  }
  // Drawn again when the local examples arrive, i.e. after the site's own layer: keep them under it, in their order.
  const drawn: L.Path[] = [];
  layer.eachLayer((l) => drawn.push(l as L.Path));
  drawn.reverse().forEach((p) => p.bringToBack());
}
