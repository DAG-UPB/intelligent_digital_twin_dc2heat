/**
 * District > Site map: a Leaflet map where you pick the data center's building (the heat source) and add heat
 * sinks: a clicked building, a plain bubble on open ground, or a drawn area standing for a whole district.
 * The side panel edits names, temperatures and powers and saves the whole site (site.json). Buildings with their
 * modelled heat demand (Wärmeatlas Hessen) can be loaded for the current view and added as heat sinks. The Quick
 * analysis window over the map (QuickWindow.tsx) says live what the data center gives the sinks over a year; Heat
 * Matching and Planning is the detailed view of the same site. The Heat distribution card (HeatNetwork.tsx) plans the
 * pipes from the data center through a heat-pump station to the buildings, and what they cost and earn. The steps on
 * top (SiteSteps.tsx) say what to do first: ① Data center → ② District (the heat sinks) → ③ Heat distribution, then
 * the Quick analysis; the cards follow in that order.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMapExamples, saveProject, type HeatSource, type WaermeatlasBuilding } from "../../api";
import { chooseDataset, DATASET } from "../../dataset";
import { errorMessage } from "../../lib/errors";
import { HOURS_PER_YEAR } from "../../lib/constants";
import { fmt } from "../../lib/format";
import { FLAG, readJson, useStored, writeJson } from "../../lib/storage";
import { useCommand, useReportPage, useSnapshotDetail, useUnsaved } from "../../lib/live";
import { BUILT_IN_EXAMPLES } from "./frankfurtDataCenters";
import { putBuilding } from "../../lib/buildingHandoff";
import { annualMwh, demandEntries } from "../../lib/demand";
import { PROFILE_PRESETS } from "../../lib/profilePresets";
import { SideSplitter } from "../datacenter/structure/SideSplitter";
import HeatNetwork from "./HeatNetwork";
import PointEditor from "./PointEditor";
import { sinkFigures } from "./sinkProfile";
import QuickWindow from "./QuickWindow";
import SiteSteps, { stepsOf, type StepKind } from "./SiteSteps";
import WaermeatlasPanel from "./WaermeatlasPanel";
import HeatSourcesPanel from "./HeatSourcesPanel";
import AreaBuildings from "./AreaBuildings";
import { sinkUseColors, USE_CLASSES } from "./waermeatlas";
import { drawSite } from "./drawSite";
import { buildingAt, searchAddress, type Ring } from "./osm";
import { Dialog } from "../../ui/Dialog";
import { InfoMark } from "../../ui/InfoMark";
import { resetBrowser } from "./siteDraft";
import { PANEL_WIDTH, useFloatingPanel } from "./useFloatingPanel";
import { useLeavePrompt } from "./useLeavePrompt";
import { useSiteDocument } from "./useSiteDocument";
import { wasteKw, withArea, withBuilding, withSink } from "./siteEdits";
import { leftView, useSiteMap, ZOOM } from "./useSiteMap";
import "./district.css";

type Mode = "none" | "sink" | "building" | "area";

/** Which cards of the panel are open: closed at first (the map has the room), then as last left in this browser; held
 * here, not in each card, so a click on a step opens its card. */
function useCards() {
  const [open, set] = useState(() => {
    const was = (kind: StepKind) => readJson(`site-card-${kind}`, false, FLAG);
    return { source: was("source"), sink: was("sink"), network: was("network"), quick: was("quick") };
  });
  const setOpen = (kind: StepKind, on: boolean) => {
    set((o) => ({ ...o, [kind]: on }));
    writeJson(`site-card-${kind}`, on, FLAG);
  };
  return [open, setOpen] as const;
}

/** A layer switched on or off, as last left in this browser (`key`). */
const useShown = (key: string, initial: boolean) => useStored(key, initial, FLAG);

/** A card of the panel, shown while its step is open (SiteSteps: a click on a step shows its card); `now`: the current
 * step (a soft ring in its colour); `keep`: closed, its content stays (hidden), so it keeps working (the quick
 * analysis, which the assistant reads). */
function Group({ kind, now, cards: [open], keep, children }: { kind: StepKind; now?: boolean; cards: ReturnType<typeof useCards>; keep?: boolean; children: ReactNode }) {
  if (!open[kind] && !keep) return null;
  return (
    <div className={`site__group site__group--${kind}${now ? " site__group--now" : ""}`} hidden={!open[kind]}>
      {children}
    </div>
  );
}

export default function SitePage() {
  const [mode, setMode] = useState<Mode>("none");
  const [draft, setDraft] = useState<Ring>([]); // corners of the area being drawn
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // what an action says goes again after a while: the panel keeps no lines of text
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(t);
  }, [status]);
  const { site, dirty, update, save, discard: discardEdits, blank } = useSiteDocument(setStatus);

  /** A click on the map does what the mode says (the assistant's map_click does the same). */
  const onMapClick = (lat: number, lon: number) => {
    // mode "none": a click on a Wärmeatlas building is handled by its layer (WaermeatlasPanel)
    if (mode === "building") pickBuilding(lat, lon);
    else if (mode === "sink") addSink(lat, lon);
    else if (mode === "area") setDraft((d) => [...d, [lat, lon]]);
    return mode;
  };
  const { el, map, layer, bounds, tools } = useSiteMap(onMapClick);
  // the map's tools (zoom, the layers) in the panel, under its title bar: everything for the map in one place
  const toolsEl = useRef<HTMLDivElement>(null);
  useEffect(() => void (toolsEl.current && toolsEl.current.append(...tools)), [tools]);

  // working live with the assistant (lib/live.ts): where the map is, and moving it for the user
  const centre = bounds?.getCenter();
  useReportPage({
    map_centre: centre ? [+centre.lat.toFixed(6), +centre.lng.toFixed(6)] : null,
    zoom: map.current?.getZoom() ?? null,
    mode,
    sinks: site?.sinks.length ?? 0,
  });
  useUnsaved(dirty);
  const cards = useCards();
  // the step shown alone (a click on it in the steps): the map shows only its part; the data center alone, the heat
  // sinks with the Wärmeatlas around them, the network; several cards open, or none: everything
  const openKinds = (["source", "sink", "network", "quick"] as const).filter((k) => cards[0][k]);
  const only = openKinds.length === 1 ? openKinds[0] : null;
  // the District step's two layers, each on a click (to show them one after the other): the Wärmeatlas's heat demand
  // in its colours, and the selected buildings (the heat sinks); as last left in this browser
  const [showAtlas, setShowAtlas] = useShown("site-show-atlas", false);
  const [showSinks, setShowSinks] = useShown("site-show-sinks", true);
  const [showNet, setShowNet] = useState(true); // the planned heat network on the map
  // "Show all", beside the layers: the three on or off at once
  const showAll = showAtlas && showSinks && showNet;
  const setShowAll = (on: boolean) => {
    setShowAtlas(on);
    setShowSinks(on);
    setShowNet(on);
  };
  const [netPlanned, setNetPlanned] = useState(false); // a heat network planned (HeatNetwork): step ③ done
  const [netShown, setNetShown] = useState<Set<string> | null>(null); // its supplied sinks while on the map: only they are drawn
  const [extraSource, setExtraSource] = useState<HeatSource | null>(null); // a PfA waste heat source taken beside the data center (this page only)
  const current = stepsOf(site, netPlanned).find((s) => s.state === "current")?.kind;
  const panel = useRef<HTMLElement>(null);
  const [goTo, setGoTo] = useState<{ kind: StepKind } | null>(null);
  /** A click on a step: its card opens and comes into view once open (smoothly unless reduced motion: the panel's CSS). */
  /** A step: its card open, the others closed (a card's own title opens more beside it), and its part in view on the
   * map: the data center, the heat sinks, the data center with them (the network). */
  const openStep = (kind: StepKind) => {
    const kinds: StepKind[] = ["source", "sink", "network", "quick"];
    if (cards[0][kind] && kinds.every((k) => k === kind || !cards[0][k])) return cards[1](kind, false); // shown alone: hidden again
    for (const k of kinds) if (k !== kind && cards[0][k]) cards[1](k, false);
    cards[1](kind, true);
    const m = map.current;
    const src = site?.source;
    const pts = kind === "source" ? (src ? [src] : []) : kind === "sink" ? (site?.sinks ?? []) : kind === "network" ? [...(src ? [src] : []), ...(site?.sinks ?? [])] : [];
    if (m && pts.length === 1) m.flyTo([pts[0].lat, pts[0].lon], Math.max(m.getZoom(), 17), { duration: 0.8 });
    else if (m && pts.length > 1) m.flyToBounds(pts.map((p): [number, number] => [p.lat, p.lon]), { padding: [40, 40], paddingTopLeft: [panelWidth + 60, 40], duration: 0.8 });
    setGoTo({ kind });
  };
  useEffect(() => void (goTo && panel.current?.querySelector(`.site__group--${goTo.kind}`)?.scrollIntoView({ block: "start" })), [goTo]);
  // the Wärmeatlas box the District step loads by itself: the data center and its heat sinks, ~250 m around (local data)
  const atlasBox = useMemo((): [number, number, number, number] | null => {
    const pts = [...(site?.source ? [site.source] : []), ...(site?.sinks ?? [])];
    if (!pts.length) return null;
    const lat = pts.map((p) => p.lat);
    const lon = pts.map((p) => p.lon);
    return [Math.min(...lat) - 0.0023, Math.min(...lon) - 0.0035, Math.max(...lat) + 0.0023, Math.max(...lon) + 0.0035];
  }, [site?.source, site?.sinks]);
  const districtMwh = useMemo(() => (site ? demandEntries(site).reduce((a, e) => a + annualMwh(e.settings), 0) : 0), [site]);
  const [sinksOpen, setSinksOpen] = useState(false); // the list of every heat sink: closed until wanted, then it scrolls
  // each sink's row in the list: what it counts as (its demand's year, peak hour and supply), built when the list opens
  const sinkText = useMemo(() => {
    const out = new Map<string, string>();
    if (site && sinksOpen)
      for (const e of demandEntries(site)) {
        const f = sinkFigures(e.settings);
        out.set(e.id, `${fmt(f.mwh, f.mwh < 100 ? 1 : 0)} MWh/a · peak ${fmt(f.peakKw, f.peakKw < 10 ? 1 : 0)} kW · ${fmt(f.supply)} °C`);
      }
    return out;
  }, [site, sinksOpen]);
  // the map's popups are drawn once per change: they reach the latest openProfile (and site) through this ref
  const openProfileRef = useRef((_: string) => {});
  /** The profile every heat sink follows (its annual demand stays its own): set for all, the individual ones dropped. */
  const setProfileOfAll = (profile: string | undefined) =>
    update((s) => ({
      ...s,
      district: { ...(s.district ?? {}), profile },
      sinks: s.sinks.map((x) => (x.demand?.profile ? { ...x, demand: { ...x.demand, profile: undefined } } : x)),
    }));
  /** One heat sink's own profile (none: as all). */
  const setProfileOf = (id: string, profile: string | undefined) =>
    update((s) => ({ ...s, sinks: s.sinks.map((x) => (x.id === id ? { ...x, demand: { ...(x.demand ?? {}), profile } } : x)) }));
  const { panelWidth, setPanelWidth, min, setMin, top, pos, dragPanel, resetPos } = useFloatingPanel(panel);
  useEffect(() => void map.current?.invalidateSize(), [map, panelWidth]); // the map fills what the panel leaves

  /** A heat sink's profile, for a look in the district's Modelling (its settings go along); back by its "Back to the
   * site map". Unsaved map edits are saved first, so nothing is lost on the way (a failed save stays here). */
  const openProfile = async (id: string) => {
    const e = site && demandEntries(site).find((x) => x.id === id);
    if (!e) return;
    if (dirty && !(await save())) return;
    putBuilding({ id: e.id, name: e.name, settings: e.settings });
    location.hash = "#/district/structure";
  };
  openProfileRef.current = (id) => void openProfile(id);
  /** The district's Modelling, where the profiles are (unsaved map edits saved first). */
  const goModelling = async () => {
    if (dirty && !(await save())) return;
    location.hash = "#/district/structure";
  };
  /** Heat Matching on the same data center and the saved site (unsaved map edits saved first). */
  const goMatching = async () => {
    if (dirty && !(await save())) return;
    chooseDataset("twin/matching", DATASET);
    location.hash = "#/twin/matching";
  };
  useSnapshotDetail(() => ({
    mode,
    unsaved: dirty,
    map_centre: centre ? [+centre.lat.toFixed(6), +centre.lng.toFixed(6)] : null,
    zoom: map.current?.getZoom() ?? null,
    data_center_building: site?.building?.name ?? null,
    heat_source: site?.source ? { name: site.source.name, lat: site.source.lat, lon: site.source.lon, temp_c: site.source.temp_c, power_kw: site.source.power_kw, utilization: site.source.utilization ?? 1, waste_heat_kw: wasteKw(site.source) } : null,
    sinks: (site?.sinks ?? []).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, temp_c: s.temp_c, power_kw: s.power_kw, area: !!s.area })),
    area_corners_drawn: draft.length,
    examples_on_the_map: BUILT_IN_EXAMPLES.map((e) => e.name),
    note: "The map itself (web tiles) is not in the images: use map_centre, the sinks and map_focus / map_click.",
  }));
  useCommand("map_click", (args) => {
    const m = onMapClick(Number(args.lat), Number(args.lon));
    return m === "none" ? "clicked the map (no mode is on: choose one with its button first, or pick_atlas_building)" : `clicked the map in mode "${m}"`;
  });
  useCommand("map_focus", async (args) => {
    const m = map.current;
    if (!m) throw new Error("The map is not ready yet");
    if (typeof args.example === "string") {
      const name = args.example.toLowerCase();
      const all = [...BUILT_IN_EXAMPLES, ...(await fetchMapExamples().catch(() => []))];
      const found = all.find((d) => d.name.toLowerCase().includes(name));
      if (!found) throw new Error(`No example data center called “${args.example}” on the map. Examples: ${all.map((d) => d.name).join(" | ")}`);
      m.setView([found.lat, found.lon], Number(args.zoom) || ZOOM);
      setStatus(`Assistant: ${found.name}`);
      return `moved the map to ${found.name}`;
    }
    m.setView([Number(args.lat), Number(args.lon)], Number(args.zoom) || ZOOM);
    return `moved the map to ${Number(args.lat)}, ${Number(args.lon)}`;
  });

  // Center on the data center the first time the site arrives (not when coming back: the map is where it was left).
  const centered = useRef(!!leftView());
  useEffect(() => {
    if (!site?.source || !map.current || centered.current) return;
    map.current.setView([site.source.lat, site.source.lon], ZOOM);
    centered.current = true;
  }, [site, map]);

  // the loaded Wärmeatlas buildings colour the sinks' bubbles by what they are used for
  const [atlas, setAtlas] = useState<WaermeatlasBuilding[] | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only the sinks colour the bubbles, not the rest of the site
  const useFills = useMemo(() => (atlas && site ? sinkUseColors(atlas, site.sinks) : null), [atlas, site?.sinks]);

  useEffect(() => {
    // a sink's popup takes it out of the district (an unsaved edit like any other: the bin brings it back)
    const remove = (id: string) => {
      update((s) => ({ ...s, sinks: s.sinks.filter((p) => p.id !== id) }));
      setStatus(`Removed ${site?.sinks.find((p) => p.id === id)?.name ?? "it"} from the district`);
    };
    const noSinks = only === "source" || (only === "sink" && !showSinks);
    if (site) drawSite(layer.current, noSinks ? { ...site, sinks: [] } : site, draft, (id) => openProfileRef.current(id), netShown, remove, useFills);
    else layer.current.clearLayers();
  }, [site, draft, layer, netShown, only, showSinks, useFills, update]);

  const search = async () => {
    if (!query.trim() || !map.current) return;
    setStatus("Searching…");
    try {
      const at = await searchAddress(query);
      if (!at) return setStatus("Address not found");
      map.current.setView(at, ZOOM);
      setStatus(null);
    } catch {
      setStatus("Search failed (no connection to OpenStreetMap?)");
    }
  };

  async function pickBuilding(lat: number, lon: number) {
    setStatus("Looking up the building… (up to 30 s if OpenStreetMap only has its address)");
    try {
      const b = await buildingAt(lat, lon);
      if (!b) return setStatus("No building found there. Click directly on a building.");
      update((s) => withBuilding(s, b));
      setMode("none");
      setStatus(`Selected ${b.name}. Save the site to keep it.`);
    } catch {
      setStatus("OpenStreetMap did not answer. Try again in a minute.");
    }
  }

  async function addSink(lat: number, lon: number) {
    setStatus("Looking up the building…");
    // no answer from OpenStreetMap: place a plain bubble
    const b = await buildingAt(lat, lon).catch(() => null);
    update((s) => withSink(s, lat, lon, b));
    setStatus(b ? `Added ${b.name}. Set its temperature and power, then save.` : "No building there: added a bubble. Save to keep it.");
  }

  const finishArea = () => {
    if (draft.length >= 3) {
      update((s) => withArea(s, draft));
      setStatus("District added: loading its buildings and their heat demand…");
    }
    setDraft([]);
    setMode("none");
  };

  // leaving the page with unsaved edits: asked once per edit whether to keep them as a project file (the example, or
  // the data center's site, is not changed), keep them in this browser, or discard them
  const { leaving, setLeaving, leave } = useLeavePrompt(dirty, site);
  const saveAsProject = async () => {
    if (!site) return;
    try {
      const r = await saveProject(DATASET, site);
      setStatus(`Kept as a project file: ${r.path} (Open project loads it again)`);
      leave();
    } catch (e) {
      setStatus(errorMessage(e));
      setLeaving(null);
    }
  };

  // the bin: the unsaved edits go, the saved site comes back (asked first: save them instead?)
  const [asking, setAsking] = useState(false);
  const [resetting, setResetting] = useState(false); // the bin with nothing unsaved: reset this browser
  const discard = () => {
    setAsking(false);
    return discardEdits();
  };

  return (
    <div className="site">
      <div ref={el} className="site__map" style={{ cursor: mode !== "none" ? "crosshair" : undefined }} />
      <aside ref={panel} className={min ? "site__panel site__panel--min" : "site__panel"} style={{ width: panelWidth, left: pos.x, top, maxHeight: `calc(100% - ${top + 12}px)` }}>
        <div className="site__drag" onPointerDown={dragPanel} onDoubleClick={resetPos} title="Drag to move the panel; a double click puts it back">
          <span className="site__grip" aria-hidden />
          <span aria-hidden>Site</span>
          <button
            type="button"
            className="btn btn--xs site__min"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMin(!min)}
            aria-expanded={!min}
            aria-label={min ? "Show the panel" : "Minimise the panel"}
            title={min ? "Show the panel" : "Minimise the panel"}
          >
            {min ? "+" : "−"}
          </button>
        </div>
        <form
          role="search"
          className="site__search"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input className="field field--sm" placeholder="Search an address" aria-label="Search an address" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit" className="btn btn--sm">
            Go
          </button>
        </form>
        <div className="site__toolsrow">
          <div ref={toolsEl} className="site__tools" />
          <label className="net__show site__showall" title="The Wärmeatlas's heat demand, the selected buildings and the heat network on the map, all at once">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} aria-label="Show all" /> All
          </label>
        </div>
        <SiteSteps site={site} planned={netPlanned} open={cards[0]} onOpen={openStep} />
        <h1 className="page__title site__title">
          Site{" "}
          <InfoMark
            term="the map's bubbles"
            mark="?"
            hover
            text="Red = heat source, blue = heat sink. Bigger = more power, deeper colour = hotter. A dashed outline = a whole district as one heat sink."
          />
        </h1>


        {/* the edit buttons wait for the site: an edit before it is loaded (or when it failed to load) would be lost */}
        {/* kept mounted when folded: the waste heat sources loaded and their map layer stay */}
        <Group kind="source" now={current === "source"} cards={cards} keep>
          {!site?.source && <div className="site__building">{site?.building?.name ?? "No building selected"}</div>}
          {site?.source && (
            <PointEditor p={site.source} onChange={(p) => update((s) => ({ ...s, source: p }))} captions={{ temp: "Supply temperature", power: "Installed capacity" }} utilization />
          )}
          {/* the result, under its calculation */}
          {site?.source && (
            <div className="site__sum">
              <b>{fmt((wasteKw(site.source) * (HOURS_PER_YEAR / 1000)) / 1000, 1)} GWh/a</b> waste heat at {fmt(site.source.temp_c)} °C
            </div>
          )}
          <div className="site__buttons">
            <button
              type="button"
              className={`btn${mode === "building" ? " btn--on" : ""}`}
              aria-pressed={mode === "building"}
              disabled={!site}
              onClick={() => {
                setMode(mode === "building" ? "none" : "building");
                setStatus(mode === "building" ? null : "Click on the data center's building on the map.");
              }}
            >
              {mode === "building" ? "Click a building…" : site?.building ? "Pick another building" : "Pick a building"}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => (window.location.hash = "/dc/pid")} disabled={!site?.building}>
              Open building →
            </button>
          </div>
          {/* more heat for the district: the waste heat sources of the Plattform für Abwärme around, one as a second source */}
          <HeatSourcesPanel map={map} bounds={bounds} selected={extraSource} onSelect={setExtraSource} setStatus={setStatus} />
        </Group>

        {/* the district: its heat sinks, with the heat demand of the buildings around they are taken from (Wärmeatlas),
            in one card; kept mounted when folded: the loaded buildings, their map layer and an area being drawn stay */}
        <Group kind="sink" now={current === "sink"} cards={cards} keep>
          {site && (
            <div className="site__sum">
              <b>{fmt(districtMwh / 1000, 1)} GWh/a</b> {`heat demand · ${fmt(site?.sinks.length ?? 0)} heat sink${site?.sinks.length === 1 ? "" : "s"}`}
            </div>
          )}
          <div className="site__shows">
            <label className="net__show" title="The buildings around in the colours of their heat demand (Wärmeatlas Hessen, local)">
              <input type="checkbox" checked={showAtlas} onChange={(e) => setShowAtlas(e.target.checked)} /> Heat demand (Wärmeatlas)
            </label>
            <label className="net__show" title="The buildings selected as heat sinks, with their bubbles">
              <input type="checkbox" checked={showSinks} onChange={(e) => setShowSinks(e.target.checked)} /> Selected buildings
            </label>
          </div>
          {showSinks && !!useFills?.size && (
            <div className="site__legend" aria-label="Heat sink use legend">
              {USE_CLASSES.map((c) => (
                <span key={c.id}>
                  <i style={{ background: c.color, borderRadius: "50%" }} />
                  {c.label}
                </span>
              ))}
            </div>
          )}
          {site && site.sinks.length > 0 && (
            <div className="site__profile">
              <span>Profile</span>
              <select
                className="field field--sm"
                value={site.district?.profile ?? ""}
                onChange={(e) => setProfileOfAll(e.target.value || undefined)}
                aria-label="Profile of all heat sinks"
              >
                <option value="">Automatic</option>
                {PROFILE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn--xs" onClick={() => goModelling()} aria-label="Profiles in Modelling" title="Each heat sink's profile, in the district's Modelling">
                ∿
              </button>
              <button
                type="button"
                className="btn btn--xs"
                aria-expanded={sinksOpen}
                onClick={() => setSinksOpen(!sinksOpen)}
                aria-label={sinksOpen ? "Hide list" : `Show list (${site.sinks.length})`}
                title="The heat sinks, one by one"
              >
                ☰ {site.sinks.length}
              </button>
            </div>
          )}
          {sinksOpen && (
            <div className="site__sinks">
              {site?.sinks.map((p) => (
              <PointEditor
                key={p.id}
                p={p}
                onChange={(q) => update((s) => ({ ...s, sinks: s.sinks.map((x) => (x.id === q.id ? q : x)) }))}
                onDelete={() => update((s) => ({ ...s, sinks: s.sinks.filter((x) => x.id !== p.id) }))}
                onProfile={() => openProfile(p.id)}
                figures={sinkText.get(p.id) ?? ""}
                extra={
                  <select
                    className="field field--xs"
                    value={p.demand?.profile ?? ""}
                    onChange={(e) => setProfileOf(p.id, e.target.value || undefined)}
                    aria-label={`Profile of ${p.name}`}
                  >
                    <option value="">Profile: as all</option>
                    {PROFILE_PRESETS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                }
              />
              ))}
            </div>
          )}
          <div className="site__buttons">
            <button
              type="button"
              className={`btn btn--sm${mode === "sink" ? " btn--on" : ""}`}
              aria-pressed={mode === "sink"}
              disabled={!site}
              onClick={() => {
                setDraft([]);
                setMode(mode === "sink" ? "none" : "sink");
              }}
            >
              {mode === "sink" ? "Click buildings… (done)" : "+ Buildings"}
            </button>
            {mode === "area" ? (
              <>
                <button type="button" className="btn btn--sm btn--primary" onClick={finishArea} disabled={draft.length < 3}>
                  Finish area ({draft.length} corners)
                </button>
                <button type="button" className="btn btn--sm" onClick={() => (setDraft([]), setMode("none"))}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={!site}
                onClick={() => {
                  setMode("area");
                  setStatus("Click the corners of the area on the map (at least 3), then Finish area.");
                }}
              >
                + Area (district)
              </button>
            )}
          </div>
          <AreaBuildings map={map} site={site} update={update} setStatus={setStatus} />
          <WaermeatlasPanel
            map={map}
            bounds={bounds}
            site={site}
            active={mode === "none"}
            update={update}
            setStatus={setStatus}
            onProfile={(id) => openProfileRef.current(id)}
            auto={only === "sink" ? atlasBox : null}
            shown={showAtlas && (only === "sink" || only === null)}
            onLoaded={(b, quiet) => (setAtlas(b), quiet || setShowAtlas(true))}
          />
        </Group>

        {/* the heat network from the data center through a heat-pump station to the buildings, and what it costs;
            kept mounted when folded: its plan stays on the map */}
        <Group kind="network" now={current === "network"} cards={cards} keep>
          <HeatNetwork
            site={site}
            map={map}
            open={cards[0].network}
            onPlanned={setNetPlanned}
            onShown={setNetShown}
            onMap={only !== "source" && only !== "sink"}
            onStation={(at) => update((s) => ({ ...s, network_station: at }))}
            show={showNet}
            onShow={setShowNet}
          />
        </Group>

        {/* the quick analysis in the same window, under the steps' cards: the result */}
        <Group kind="quick" now={current === "quick"} cards={cards} keep>
          <QuickWindow site={site} map={map} onOpenMatching={() => void goMatching()} extra={extraSource} />
        </Group>

        {/* always in view at the bottom of the panel: save often */}
        <div className="site__group site__group--row site__save">
          <button type="button" className="btn btn--primary" onClick={save} disabled={!dirty}>
            {!dirty ? "Saved" : blank ? "Save as project" : "Save site"}
          </button>
          <button
            type="button"
            className="btn btn--ghost site__discard"
            onClick={() => (dirty ? setAsking(true) : setResetting(true))}
            aria-label={dirty ? "Discard the unsaved edits" : "Reset what this browser keeps"}
            title={dirty ? "Discard the unsaved edits kept in this browser" : "Reset what this browser keeps for the app (unsaved edits, Heat Matching's last year, the last picks)"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
            </svg>
          </button>
          {status && (
            <span key={status} className="site__toast" role="status" title={status}>
              {status}
            </span>
          )}
        </div>
        <SideSplitter width={panelWidth} onWidth={setPanelWidth} initial={PANEL_WIDTH} />
      </aside>
      {leaving && (
        <Dialog label="Unsaved edits on the map" onClose={() => setLeaving(null)} className="dialog--narrow">
          <h2>Keep your edits?</h2>
          <p className="muted">
            The map has unsaved edits. Recommended: keep them as a project file. The saved site (an example such as Blank too) stays as it is, and{" "}
            <i>Open project</i> loads them again. Or keep them only in this browser, or discard them.
          </p>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={() => void saveAsProject()}>
              Save a project file
            </button>
            <button type="button" className="btn" onClick={leave}>
              Keep in this browser
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                void discard().then(leave);
              }}
            >
              Discard
            </button>
          </div>
        </Dialog>
      )}
      {resetting && (
        <Dialog label="Reset what this browser keeps" onClose={() => setResetting(false)} className="dialog--narrow">
          <h2>Reset this browser?</h2>
          <p className="muted">
            Forgets what this browser keeps for the app: the unsaved map edits of every data center, Heat Matching&apos;s last year (Operation and the Quick
            analysis show it until Heat Matching runs again), the case and data centers last picked. Saved sites and project files, your own cases and the
            theme stay. The app then starts again on Case 1.
          </p>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                resetBrowser();
                window.location.assign("/?case=1#/twin/map");
              }}
            >
              Reset
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setResetting(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {asking && (
        <Dialog label="Discard the unsaved edits" onClose={() => setAsking(false)} className="dialog--narrow">
          <h2>Save your edits first?</h2>
          <p className="muted">The map&apos;s unsaved edits are kept in this browser. Save them to the site, or discard them and go back to the saved site.</p>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={() => void save().then((ok) => ok && setAsking(false))}>
              Save them
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void discard()}>
              Discard them
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
