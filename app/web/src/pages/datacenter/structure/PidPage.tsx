/**
 * Data Center > Physical structure (#/dc/pid): every causal variable as an ISA instrument on a P&ID — the built-in
 * test drawing (simulation datasets) or the paper P&ID image — with the causal links over it. The slider fades the
 * drawing into the links and then morphs the instruments into a circle. The user edits links, lags and self-lags,
 * discovers lags for the drawn links, assigns variables to extracted P&ID components, and saves the graph file plus
 * the instrument layout (site.json pid_layout, hex_option). The drawing has three levels, each shown or hidden: the
 * picture, the digital construct (shapes read from the drawing and edited here: pid_construct.json, construct.ts)
 * and the variables. On a paper P&ID only the variables placed on the picture are drawn: the others wait in the
 * Variables menu (tick one, or drag it onto the picture). Unsaved work is kept in the browser as a draft (draft.ts)
 * until Save or Discard. Positions the assistant reads and gives are fractions of the P&ID picture. This file wires
 * state and handlers; the parts do the rest.
 */
import { peekBuilding } from "../../../lib/buildingHandoff";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  discoverLinkLags,
  fetchDatasets,
  removePidDrawing,
  fetchSummary,
  saveCausalGraph,
  savePidConstruct,
  updateSite,
  type DataCenterDocument,
} from "../../../api";
import { districtKpis, heatKpis } from "../../../lib/partKpis";
import { InfoMark } from "../../../ui/InfoMark";
import { draftOf, feedsKpi, kpiFormulas, kpiUses as usesOf, type KpiLine } from "../modelling/kpiVariables";
import { configOf, DATASET, datasetConfig, otherPartsPrepared } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { useReportPage, useSnapshotDetail, useUnsaved } from "../../../lib/live";
import { renamed, shownName, withOwnName, type Names } from "../../../lib/names";
import { hiddenColumns } from "../../../lib/sourceMap";
import type { DiscoverOptions } from "./DiscoverControls";
import { centreOf } from "./construct";
import { ConstructBar, type Layers } from "./ConstructBar";
import { ConstructLayer, type Tool } from "./ConstructLayer";
import { clearDraft, loadView, saveDraft, saveView, storeKey, type Draft } from "./draft";
import { circleMorph, clamp, DC_TAPS_HALL_WATER, framedTaps, H, R, snap, stageOf, W } from "./geometry";
import {
  DEFAULTS,
  diagramsToSave,
  FC_DEFAULTS,
  guessTag,
  HALL_WATER,
  layoutFor,
  plantLayoutEntries,
  SURFACE,
  type Diagram,
} from "./layout";
import { Legend } from "./Legend";
import { LinkInspector } from "./LinkInspector";
import {
  allPairs,
  applyDiscoveredLags,
  blindDiscovered,
  discoverySummary,
  isSelf,
  keyOf,
  noEvidenceOf,
  selfLagsOf,
  toSavePayload,
  withDiscoveredStrengths,
  withLink,
  withLinkLags,
  withSelfLags,
  type Link,
} from "./links";
import { BelowStructure } from "./BelowStructure";
import type { StructureLink } from "./structureLink";
import type { StructureSetup } from "./structureSetup";
import "./pid.css";
import { PidCanvas } from "./PidCanvas";
import PidImport from "./PidImport";
import { ChangesBox } from "./ChangesBox";
import {
  groupName,
  inBox,
  loadChanges,
  logged,
  memberOf,
  saveChanges,
  type Change,
} from "./notes";
import { SaveAsBar } from "./SaveAsBar";
import { SelectionBar } from "./SelectionBar";
import { useBoxSelect } from "./useBoxSelect";
import { ShapeInspector } from "./ShapeInspector";
import { StageSlider } from "./StageSlider";
import { Toolbar } from "./Toolbar";
import { useInstrumentDrag } from "./useInstrumentDrag";
import { useConstruct } from "./useConstruct";
import { useView } from "./useView";
import { defaultShown, loadShown, loadSize, saveShown, saveSize, shortNames, spotsInView } from "./shown";
import { VariableMenu } from "./VariableMenu";
import { fmtDateTime } from "../../../lib/format";
import { useApproaches } from "./useApproaches";
import type { Approach } from "../modelling/approaches";
import { ViewControls } from "./ViewControls";
import { starterOf, usePidGraph, type Hex } from "./usePidGraph";
import { renameFor } from "./bindSetup";
import { DropMenu } from "./DropMenu";
import { DC_INTERFACE, dcPoints, portVars, WEATHER, WEATHER_MORE, WEATHER_TAGS, type PointVars } from "../../heat/ports";
import {
  MARGIN,
  MARGIN_NARROW,
  neighbourX,
  PORT_Y,
  portSpots,
  span as marginsOf,
  stripSpots,
  SURFACE_TOP,
  weatherSpots,
  type StripVar,
} from "./connection";
import { LIQUID_DEFAULTS, LIQUID_INTRO, LIQUID_TAPS } from "./liquidLayout";
import { usePidSources } from "./usePidSources";
import { usePidViews } from "./usePidViews";
import { useVariableOps } from "./useVariableOps";
import { useConstructEdits } from "./useConstructEdits";
import { usePidCommands } from "./usePidCommands";
import { VariableInspector, type VariableKind } from "./VariableInspector";
import { ViewsBox } from "./ViewsBox";
import { DocumentsBox } from "./DocumentsBox";
import { shownAs, toView as inViewOf, viewAt, type ViewsAs } from "./views";

/** `model`: the page that models this structure, shown whole under it (BelowStructure); it gets
 * the structure's graph file and graph as drawn (StructureLink), so both work on the same graph: called Modelling. */
export default function PidPage({ setup, model }: { setup?: StructureSetup; model?: (link: StructureLink) => ReactNode }) {
  const scope = setup?.scope ?? "dc";
  const store = storeKey(DATASET, scope, setup && starterOf(setup));
  const svg = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [linking, setLinking] = useState(false); // link mode: click the source, then the target
  // the top bar's KPI variables: which variables the KPIs use (the summary's kpi_columns, as the Modelling's KPI
  // variables card), marked on the drawing, and the formulas; read again at every press, after a save below
  const [kpis, setKpis] = useState<{ uses: Record<string, string>; lines: KpiLine[] } | null>(null);
  const [kpiPick, setKpiPick] = useState<string | null>(null); // one KPI clicked: only its variables marked
  const toggleKpis = () => {
    setKpiPick(null);
    if (kpis) return setKpis(null);
    if (setup) return setKpis((setup.scope === "heat" ? heatKpis : districtKpis)((v) => bound[v] ?? v)); // the other parts': fixed (lib/partKpis)
    Promise.all([fetchSummary(DATASET), datasetConfig()])
      .then(([s, cfg]) => {
        const m = s.kpi_columns ? draftOf(s.kpi_columns) : {};
        setKpis({ uses: usesOf(m, cfg.derived ?? {}), lines: s.kpi_columns ? kpiFormulas(m) : [] });
      })
      .catch(() => setKpis({ uses: {}, lines: [] }));
  };
  const [pending, setPending] = useState<string | null>(null); // link start, in link mode
  const [selVar, setSelVar] = useState<string | null>(null);
  const [selLink, setSelLink] = useState<string | null>(null); // "from->to"
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read once: the structure's key is fixed while the page is mounted
  const stored = useMemo(() => loadView(store), []); // fade, layers and lock as the user left them
  const [slider, setSlider] = useState(stored?.slider ?? 0);
  const [addingVar, setAddingVar] = useState(false);
  const [saveAs, setSaveAs] = useState<string | null>(null); // initial name of the open "save as" bar
  const [discovering, setDiscovering] = useState(false);
  const [savedAt, setSavedAt] = useState(0); // when Save last wrote the graph file
  const [importing, setImporting] = useState(false);
  // edit mode (the Edit button): the tools that change the structure; else the drawing, the slider and the variables
  const editKey = `${scope}-structure-edit`; // per viewer and part, as the mode last chosen
  const [editMode, setEditMode] = useState(() => {
    try {
      return localStorage.getItem(editKey) === "1";
    } catch {
      return false;
    }
  });
  const [selShape, setSelShape] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>(stored?.layers ?? { picture: true, construct: true, variables: true });
  const [editing, setEditing] = useState(false); // the construct's drawing tools are open
  const [tool, setTool] = useState<Tool>("select");
  // nothing moves: no drag, pan, zoom or drop; clicks select. Locked whenever the page opens, so the wheel scrolls the
  // page and the drawing stays put until the user unlocks it
  const [locked, setLocked] = useState(true);
  const [viewsAs, setViewsAs] = useState<ViewsAs>(stored?.viewsAs ?? "own"); // every view at one level, or each its own
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the structure's key is fixed while the page is mounted
  useEffect(() => void saveView(store, { slider, layers, locked, viewsAs }), [slider, layers, locked, viewsAs]);
  // a digital P&ID hides its picture, unless the user chose the layers before
  const k = useConstruct(scope, setStatus, (digital) => digital && !stored && setLayers((l) => ({ ...l, picture: false })));
  const select = (v: string | null, link: string | null = null) => {
    setSelVar(v);
    setSelLink(link);
    setSelShape(null);
  };
  const toggleVar = (v: string) => select(selVar === v ? null : v);

  const { files, setFiles, file, setFile, columns, cfg, imgH, diagram, setDiagram, plant, qMean } = usePidSources(scope, setStatus);
  // calculated columns (the HEX heat Q) are never instruments: not drawn, not offered, not saved to the graph
  // and another part's prepared variables are not this one's
  const dataColumns = useMemo(() => {
    const others = otherPartsPrepared(cfg, scope);
    return columns.filter((c) => !cfg.derived?.[c] && !others.has(c));
  }, [columns, cfg, scope]);
  // drawn whatever the graph file says: the data center's columns on its own structure; another starts with its own
  // variables, and the columns are offered to add (for TempCaFe, which needs data)
  // and every structure its connection points and the weather, under the data's names where it has them
  // (and the data center its IT electricity, which becomes its heat)
  // names shown in place of the variables' own (dataset.json "names"; the data keeps its own names)
  const [names, setNames] = useState<Names>({});
  useEffect(() => setNames(cfg.names ?? {}), [cfg]);
  // (a column made "the same" as a generic name, "=" on the drawing, is bound to it: names, as just saved)
  const bound = useMemo(() => renameFor(columns, { ...cfg, names }), [columns, cfg, names]);
  const boundName = (v: string) => bound[v] ?? v;
  const measured = useMemo(() => {
    if (setup) return setup.ports;
    const to = (v: string) => bound[v] ?? v;
    // the shared weather the data has no column for, beside the outdoor temperature: not the data center's (nothing in it needs it)
    const unmeasured = new Set(WEATHER.filter((w) => !w.needed).map((w) => to(w.v)).filter((v) => !dataColumns.includes(v)));
    return [
      ...dataColumns,
      ...portVars(dcPoints(cfg, null), to).filter((v) => !cfg.derived?.[v] && !unmeasured.has(v)),
      ...DC_INTERFACE.map((x) => to(x.v)),
    ];
  }, [setup, dataColumns, bound, cfg]);
  const offered = useMemo(() => [...new Set([...(setup?.starter ?? []), ...dataColumns])], [setup, dataColumns]);
  const canDraw = !!setup || (cfg.kind === "simulation" && !cfg.blank); // the built-in drawing: the simulation's cooling loop, or the setup's
  const paper = diagram === "paper" && imgH !== null;
  const showEquipment = !paper && canDraw && !setup;
  const trayTop = imgH ?? 0;
  // a liquid-cooled data center (dataset.json heat_source has a liquid point) has its own built-in drawing
  const liquid = !setup && !!cfg.heat_source?.liquid;
  const freeCooling = !setup && !liquid && cfg.plant?.free_cooling === "plate_hex"; // the air-cooled one with free cooling
  // the hall's heat taken from the warm water (its Q has water's cp), not the hot-aisle air: the HEX sits on that pipe
  const hallOnWater = !setup && !liquid && (cfg.derived?.[cfg.heat_source?.hall?.q ?? ""]?.cp ?? 0) > 2;
  // without a built-in drawing the connection points are drawn on the picture or the empty structure, their variables
  // beside them (the data center's: its first extraction point's, a calculated heat left out)
  const points = useMemo(() => {
    if (setup) return setup.portPoints;
    const vars = dcPoints(cfg, null)[0].vars;
    return { out: Object.fromEntries(Object.entries(vars).filter(([, v]) => v && !cfg.derived?.[v])) as PointVars };
  }, [setup, cfg]);
  // the data center on an empty structure (no picture, no drawing): a box to draw in, its inputs and outputs above it
  // (connection.ts BOUNDARY), the weather among the inputs, the heat to recover at the connection point on its right;
  // beside a picture they wait under the connection point
  const strips = useMemo(
    (): StripVar[] | null =>
      paper || (setup ? !setup.frame || !(cfg.frame || cfg.blank) : canDraw && !cfg.frame) // framed: the built-in drawing inside the box (dataset.json frame)
        ? null
        : [
            // the shared weather; on the data center's own, only what its data has (and the outdoor temperature, needed)
            ...WEATHER.map((w, i): StripVar => ({ v: bound[w.v] ?? w.v, tag: WEATHER_TAGS[i], io: "input" })).filter(
              (x, i) => !!setup || WEATHER[i].needed || dataColumns.includes(x.v),
            ),
            // framed: the rest of its weather too (the wind, the hour), in the same row: the data's, or the part's own
            ...WEATHER_MORE.map(([v, tag]): StripVar => ({ v: bound[v] ?? v, tag, io: "input" })).filter((x) =>
              setup ? setup.starter.includes(x.v) : cfg.frame && dataColumns.includes(x.v),
            ),
            // the clock's other input beside the hour, where the data has it: the weekend (the IT load is lower then)
            ...(!setup && cfg.frame && dataColumns.includes("Is_Weekend") ? [{ v: "Is_Weekend", tag: "KI", io: "input" } as StripVar] : []),
            ...(setup?.frame
              ? setup.frame.outputs.map((o): StripVar => ({ ...o, io: "output" }))
              : DC_INTERFACE.map((x): StripVar => ({ v: bound[x.v] ?? x.v, tag: x.tag, io: x.io }))),
          ],
    [setup, paper, canDraw, cfg.frame, cfg.blank, bound, dataColumns],
  );
  const ports = portSpots(points, paper ? trayTop : H, setup || strips ? [] : DC_INTERFACE.map((x): [string, string] => [boundName(x.v), x.tag]), !!strips);
  // the weather in its box on every structure, under the data's names: WEATHER's three always (each made somehow); on a
  // built-in drawing also the wind, its direction and the hour where it has them (the margin beside a picture fits three)
  const weather = useMemo(() => {
    const drawn = !paper && canDraw;
    const has = new Set(drawn ? (setup ? setup.starter : dataColumns) : []); // another structure: its own, not the data center's wind
    const more = WEATHER_MORE.map(([v, tag]): [string, string] => [bound[v] ?? v, tag]).filter(([v]) => has.has(v));
    if (strips && setup) return { ...stripSpots(strips), ...portSpots(points, H, [], true) }; // its connection points on the margins
    if (strips) {
      // framed: the district's heat demand under the heat distribution's box, where its drawing had it
      const demand = cfg.frame ? cfg.kpi?.heat_demand : undefined;
      const [bx, bw] = neighbourX("out", MARGIN_NARROW);
      return { ...stripSpots(strips), ...(demand && dataColumns.includes(demand) ? { [demand]: { x: bx + bw / 2, y: PORT_Y[1] + 110, tag: "QT" } } : {}) };
    }
    return weatherSpots(scope, drawn, [...WEATHER.map((w, i): [string, string] => [bound[w.v] ?? w.v, WEATHER_TAGS[i]]), ...more]);
  }, [scope, paper, canDraw, dataColumns, setup, bound, strips, cfg, points]);
  const frame = {
    canDraw,
    trayTop,
    defaults:
      setup?.defaults ??
      (liquid ? LIQUID_DEFAULTS : hallOnWater ? { ...(freeCooling ? FC_DEFAULTS : DEFAULTS), ...HALL_WATER } : freeCooling ? FC_DEFAULTS : undefined),
    ports,
    weather,
    inside: strips ? SURFACE_TOP : 0,
  };
  const g = usePidGraph(scope, file, diagram, frame, measured, () => select(null), setStatus, setup);
  const { pos, assign } = g;
  // the other heat-recovery option's variables (and any calculated one an old graph still has) are hidden, not
  // deleted: Save writes g.vars and g.links. The selected HEX shows T_in, T_out and m; its Q is a read-out.
  const hidden = useMemo(() => hiddenColumns(showEquipment ? cfg : { derived: cfg.derived }, g.hex), [showEquipment, cfg, g.hex]);
  const q = cfg.heat_source?.[g.hex]?.q;
  const readout = showEquipment && q && cfg.derived?.[q] ? { name: q, cp: cfg.derived[q].cp, mean: qMean[q] ?? null } : null;
  const vars = useMemo(() => g.vars.filter((v) => !hidden.has(v)), [g.vars, hidden]);
  const links = useMemo(() => g.links.filter((l) => !hidden.has(l.from) && !hidden.has(l.to)), [g.links, hidden]);
  // the Variables menu: which of them are drawn (remembered per data center), their labels, their size
  const [picked, setPicked] = useState<Set<string> | null>(null); // null until the graph is loaded
  const [size, setSize] = useState(() => loadSize(store, setup?.size));
  useEffect(() => {
    if (!g.vars.length) return;
    setPicked((cur) => cur ?? new Set(loadShown(store)?.filter((v) => g.vars.includes(v)) ?? defaultShown(g.vars, g.pos, paper, trayTop)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the drawing's variables are known
  }, [g.vars]);
  // drawn: ticked, and on a paper P&ID also placed on the picture (one not placed yet waits in the menu)
  const pickedSet = useMemo(() => new Set([...(picked ?? [])].filter((v) => !paper || (g.pos[v] && g.pos[v].y < trayTop))), [picked, paper, g.pos, trayTop]);
  /** Show these variables (remembered); on a paper P&ID the ones not placed yet are put on the picture, in free
   * spots of the part in view (unsaved until Save, like a drag). */
  const showVars = (next: Set<string>, place = true) => {
    const appearing = [...next].filter((v) => paper && (!g.pos[v] || g.pos[v].y >= trayTop));
    setPicked(next);
    saveShown(store, [...next]);
    if (!place || !appearing.length) return;
    const gap = 2.6 * R * size;
    const win = view.window; // may reach past the drawing's sides when it is zoomed out: kept on the picture
    const inView = { x0: Math.max(0, win.x), y0: Math.max(0, win.y), x1: Math.min(W, win.x + win.w), y1: Math.min(win.y + win.h, trayTop) };
    const area = inView.y1 - inView.y0 >= gap ? inView : { x0: 0, y0: 0, x1: W, y1: trayTop }; // too little in view: the whole picture
    g.setPos((ps) => ({ ...ps, ...spotsInView(appearing, ps, area, gap) }));
    change();
  };
  const showVar = (v: string) => !pickedSet.has(v) && showVars(new Set([...pickedSet, v]));
  /** A variable dragged from the Variables menu and dropped on the drawing: shown, and placed where it was dropped. */
  const dropVar = (v: string, at: { x: number; y: number }) => {
    if (!vars.includes(v)) return;
    if (locked) return setStatus("The drawing is locked: unlock it to place variables.");
    if (!pickedSet.has(v)) showVars(new Set([...pickedSet, v]), false);
    g.setPos((ps) => ({
      ...ps,
      [v]: { ...(ps[v] ?? { tag: guessTag(v) }), x: snap(clamp(at.x, span.x0 + R, span.x1 - R)), y: snap(clamp(at.y, R, frameH - R)) },
    }));
    select(v);
    change();
  };
  const loadNames = () =>
    fetchDatasets()
      .then((r) => setNames(configOf(r.datasets.find((d) => d.id === DATASET)).names ?? {}))
      .catch(() => {});
  const fullNames = useMemo(() => Object.fromEntries(g.vars.map((v) => [v, withOwnName(v, names)])), [g.vars, names]);
  const labels = useMemo(() => {
    const shown = g.vars.map((v) => shownName(v, names));
    const short = shortNames(shown);
    return Object.fromEntries(g.vars.map((v, i) => [v, short[shown[i]]]));
  }, [g.vars, names]);
  const visible = useMemo(() => vars.filter((v) => pickedSet.has(v)), [vars, pickedSet]);
  const drawnLinks = useMemo(() => links.filter((l) => pickedSet.has(l.from) && pickedSet.has(l.to)), [links, pickedSet]);
  // an empty structure's data-center surface: its height, dragged at the box's bottom edge, saved with the layout
  const [surface, setSurface] = useState<number | null>(null);
  const surfaceH = surface ?? g.siteLayout[SURFACE]?.y ?? H;
  const frameH = paper ? trayTop : strips ? surfaceH : H; // the picture's height, the surface's, or the built-in drawing's
  const viewH = frameH;
  // a picture or an empty structure: the connection points in margins beside it (no built-in drawing has them drawn in)
  const span = useMemo(
    () => (paper || !canDraw || strips ? marginsOf(scope, strips ? MARGIN_NARROW : MARGIN) : { x0: 0, x1: W }), // an empty structure's narrower
    [paper, canDraw, scope, strips],
  );
  // a margin on the right (beside a picture or an empty structure): the legend in its free part, under the connection point
  const legendBeside = span.x1 > W && !setup; // another part's margins hold its connection points down to the bottom
  const { t, pull } = stageOf(slider);
  const shown = useMemo(() => circleMorph(pos, visible, pull, viewH), [pos, visible, pull, viewH]);
  // how each variable is made, as Modelling shows it: Modelling's own once it is open below, else read as it reads it
  const [reported, setReported] = useState<Record<string, Approach | null>>({});
  // kept when unchanged: Modelling reports again on every render of this page (its graph is this page's, rebuilt)
  const report = useCallback((a: Record<string, Approach | null>) => setReported((r) => (JSON.stringify(r) === JSON.stringify(a) ? r : a)), []);
  const approach = useApproaches(scope, files, file, savedAt, vars, reported);
  const roles = useMemo(() => {
    const prepared = new Set((cfg.prepared ?? []).map((s) => s.name));
    return {
      approach,
      actuators: new Set([...(cfg.actuators ?? []), ...(setup?.actuators ?? [])]),
      noData: (v: string) => columns.length > 0 && !columns.includes(v),
      prepared: (v: string) => prepared.has(v),
    };
  }, [cfg, columns, setup, approach]);
  // on another structure a data column is there by choice: it can be taken off again (the data stays)
  const kindOf = (v: string): VariableKind => {
    if (setup) return columns.includes(v) ? "column" : "none";
    return roles.prepared(v) ? "prepared" : roles.noData(v) ? "none" : "delivered";
  };
  const crossLinks = links.filter((l) => !isSelf(l));
  const selfLags = useMemo(() => selfLagsOf(links), [links]);
  const link = selLink ? links.find((l) => keyOf(l) === selLink) : undefined;
  const plantOn = paper && plant.components.length > 0;
  // the construct is drawn over the P&ID image, or over the built-in drawing when there is no image
  const constructOn = diagram !== null && (paper || imgH === null);
  const shape = selShape ? k.shapes.find((s) => s.id === selShape) : undefined;

  const change = () => {
    g.setDirty(true);
    setStatus(null);
  };
  // the extraction points and the pick of one: by the toolbar's buttons or a click on its heat exchanger
  const hexes = Object.keys(cfg.heat_source ?? {}).filter((h): h is Hex => h === "condenser" || h === "hall" || h === "liquid");
  const pickHex = (h: Hex) => {
    if (h === g.hex) return;
    g.setHex(h);
    select(null); // the selection may belong to the option now hidden
    change();
  };
  const edit = (f: (ls: Link[]) => Link[]) => {
    g.setLinks(f);
    change();
  };
  // one variable dropped on another: the menu at the drop says what they are to each other (DropMenu)
  const [dropOn, setDropOn] = useState<{ v: string; onto: string; at: { left: number; top: number } } | null>(null);
  const dragFrom = useRef<{ v: string; x: number; y: number } | null>(null); // where the dragged one was: Cancel, "="
  const dropped = (v: string) => {
    const p = pos[v];
    const onto = p && [...pickedSet].find((o) => o !== v && pos[o] && Math.hypot(pos[o].x - p.x, pos[o].y - p.y) < R);
    const m = svg.current?.getScreenCTM();
    if (!onto || !m) return;
    setDropOn({ v, onto, at: { left: m.a * p.x + m.c * p.y + m.e + 16, top: m.b * p.x + m.d * p.y + m.f + 16 } });
  };
  const dragBack = (v: string) => {
    const from = dragFrom.current;
    if (from?.v === v) g.setPos((ps) => ({ ...ps, [v]: { ...ps[v], x: from.x, y: from.y } }));
  };
  const drag = useInstrumentDrag(svg, viewH, g.setPos, change, toggleVar, span, dropped);
  const view = useView(svg, viewH, locked, span);

  // several variables selected at once (a box dragged with Shift or in Select mode, Shift-clicks, the assistant)
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const box = useBoxSelect(svg, (a, b, add) => (marking ? markArea(a, b) : setMulti((cur) => new Set([...(add ? cur : []), ...inBox(visible, shown, a, b)]))));
  const toggleMulti = (v: string) =>
    setMulti((cur) => {
      const next = new Set(cur);
      if (!next.delete(v)) next.add(v);
      return next;
    });
  // the log of what was changed here, and by whom (the side panel's Changes box; the assistant reads it too)
  const [changes, setChanges] = useState<Change[]>(() => loadChanges(store));
  const logChange = (text: string, by: Change["by"]) =>
    setChanges((log) => {
      const next = logged(log, { at: Date.now(), by, text });
      saveChanges(store, next);
      return next;
    });
  const [documents, setDocuments] = useState<DataCenterDocument[]>([]); // the user's documents about the data center
  // views: areas of the P&ID with a picture of their own (usePidViews.ts); written at once, like the P&ID picture
  const pidViews = usePidViews({ scope, setStatus, logChange, loadNames, locked, view, frameH, pos });
  const { views, pictures, viewShapes, marking, setMarking, newArea, setNewArea, viewOf, storeViews, markArea, addView, setViewPicture, removeView, openView, viewHolding } = pidViews;
  // what is done to the variables: renamed, made the same, added, deleted, grouped, marked (useVariableOps.ts)
  const ops = useVariableOps({
    g,
    pos,
    columns,
    vars,
    paper,
    frame,
    frameH,
    view,
    pickedSet,
    showVars,
    multi,
    setMulti,
    select,
    change,
    logChange,
    setStatus,
    setNames,
    setAddingVar,
    kindOf,
    file,
    dragFrom,
  });
  const { rename, sameRefusal, makeSame, addVariable, deleteVariable, groupVars, ungroup, annotate, hideSelected, deleteSelected } = ops;

  // Working live with the assistant (lib/live.ts): what the picture does not say, and the gestures on the drawing.
  // Positions are fractions of the drawing (x of its width, y of its height), as ui_snapshot's grid shows them.
  const frac = (n: number, of: number) => Math.round((n / of) * 1000) / 1000;
  // the colour is how Modelling makes it (roles.ts); an actuator is also drawn in a square
  const colourOf = (v: string) => `${approach[v] === null ? "calculated" : (approach[v] ?? "unknown")}${roles.actuators.has(v) ? ", actuator" : ""}`;
  // the draft: every edit kept in this browser a moment after it is made, until Save or Discard
  const keepDraft = (): boolean => {
    if (!g.dirty || !file || g.loaded !== file || !diagram) return false; // a file still loading: not its state yet
    const d: Draft = {
      at: Date.now(),
      trayTop,
      diagram,
      positions: { ...g.stash.current, [diagram]: pos },
      vars: g.vars,
      links: g.links,
      strengths: g.strengths,
      assign,
      hex: g.hex,
      notes: g.notes,
      base: g.base,
    };
    if (!saveDraft(store, file, d)) return false;
    g.setDraftAt(d.at);
    return true;
  };
  useEffect(() => {
    const timer = setTimeout(keepDraft, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- what the draft holds
  }, [g.dirty, g.vars, g.links, g.strengths, pos, assign, g.hex, g.notes, diagram, file, g.loaded]);
  const forgetDraft = (...names: string[]) => {
    for (const n of names) clearDraft(store, n);
    g.setDraftAt(null);
    g.setRestored(false);
  };
  /** Drop the unsaved changes: the draft goes and the graph file and layout are read again. */
  const discard = () => {
    if (file) forgetDraft(file);
    g.setDirty(false); // before the reload lands: nothing writes the draft again
    select(null);
    g.reload();
    setStatus(`Discarded the unsaved changes: ${file ?? "the drawing"} as last saved.`);
    logChange("discarded the unsaved changes", "you");
  };
  const draftInfo = {
    exists: g.draftAt !== null,
    dataset: DATASET,
    graph_file: file,
    written: g.draftAt ? new Date(g.draftAt).toISOString() : null,
    restored: g.restored,
  };
  useReportPage({
    graph_file: file,
    diagram,
    selected_variable: selVar,
    selected_link: selLink,
    variables: vars,
    draft: draftInfo,
    views: views.map((v) => v.id),
  });
  useUnsaved(g.dirty);
  useSnapshotDetail(() => ({
    graph_file: file,
    graph_files: files,
    diagram: paper ? "P&ID drawing" : "drawn by the app",
    // which built-in drawing the app draws (no P&ID file): its equipment, and where the hall's heat is taken
    built_in_drawing: showEquipment
      ? liquid
        ? "liquid-cooled (rack water loop)"
        : `air-cooled${freeCooling ? " with free cooling (plate HEX)" : ""}, hall HEX ${hallOnWater ? "on the chilled-water return (the hall's heat from the water)" : "in the warm air"}`
      : null,
    fade_slider: slider,
    link_mode: linking,
    causal_discovery_running: discovering, // its menu: click "Causal discovery", fill Method / alpha / lags, click Run
    link_start: pending,
    heat_recovery: g.hex,
    unsaved: g.dirty,
    draft: draftInfo,
    positions: "x, y: fractions of the P&ID picture",
    selected_variable: selVar,
    selected_link: selLink,
    variables_not_shown: vars.length - visible.length, // in the Variables menu, not drawn
    instruments: visible.map((v) => ({
      variable: v,
      tag: pos[v]?.tag,
      x: frac(shown[v]?.x ?? 0, W),
      y: frac(shown[v]?.y ?? 0, frameH),
      colour: colourOf(v),
      data: kindOf(v),
      self_lags: selfLags[v] ?? [],
      ...(names[v] ? { name: names[v] } : {}), // the name shown in place of its own
      ...g.notes[v], // kind, confidence, note, as marked
      ...(() => {
        const in_ = viewHolding(v);
        if (!in_ || !pos[v]) return {};
        const q = inViewOf(in_, pos[v].x / W, pos[v].y / frameH);
        return { view: in_.id, view_x: frac(q.x * W, W), view_y: frac(q.y * W, W) }; // fractions of the view's picture
      })(),
    })),
    // areas: fractions of the P&ID; inside: the view around it (one inside another's area is nested in it)
    // the user's documents about this data center: read them (document_text) before building constructs and links
    documents: documents.map((d) => ({ name: d.name, path: d.path, note: d.note, view: d.view })), // read from path with your own tools
    views_as: viewsAs, // the layer bar: every view at one level, or each its own ("own")
    views: views.map((v) => ({
      ...v,
      show: v.show ?? "auto",
      shown_as: shownAs(v, viewsAs, pictures[v.id] !== undefined, Math.max((v.w * W) / view.window.w, (v.h * frameH) / view.window.h)),
      picture: pictures[v.id] !== undefined,
      // read from its picture: place a variable on one with place_instruments {variable, view, component: label}
      components: (viewShapes[v.id] ?? [])
        .filter((s) => (s.role === "component" || s.role === "instrument") && s.label)
        .slice(0, 200)
        .map((s) => ({ label: s.label, role: s.role, shape: s.id, x: frac(centreOf(s).x * W, W), y: frac(centreOf(s).y * W, W) })),
      drawing_texts: (viewShapes[v.id] ?? []).filter((s) => s.role === "drawing" && s.kind === "text").length,
      construct_shapes: (viewShapes[v.id] ?? []).length,
      ...(pictures[v.id] !== undefined && !viewShapes[v.id]
        ? {
            note: "no construct: its picture was a PNG or a scan (or given before constructs were read). Give it the drawing as a PDF, SVG or DEXPI file (use_as_view_picture), then copy_view to identical views",
          }
        : {}),
      inside:
        viewAt(
          views.filter((o) => o.id !== v.id && o.w * o.h > v.w * v.h),
          v.x + v.w / 2,
          v.y + v.h / 2,
        )?.id ?? null,
    })),
    names, // variable -> the name shown (the data and the graph keep the own names; set_variable_names changes them)
    selection: [...multi],
    notes: g.notes, // every marked variable, drawn or not
    changes: changes.slice(0, 20), // newest first, by "AI" or "you"
    links: crossLinks.map((l) => ({ from: l.from, to: l.to, lags: l.lags })),
    hidden_variables: [...hidden],
    layers,
    view: { zoom: Math.round(view.view.zoom * 100) / 100, locked },
    construct: constructOn
      ? {
          editing,
          tool,
          selected_shape: selShape,
          unsaved: k.dirty,
          read_from_drawing_not_saved: k.firstGuess,
          // the sheet's own lines and texts are thousands: counted here, listed whole by get_construct
          drawing_shapes: k.shapes.filter((x) => x.role === "drawing").length,
          drawing_texts: k.shapes
            .filter((x) => x.role === "drawing" && x.kind === "text")
            .map(shapeView)
            .slice(0, 300),
          shapes: k.shapes.filter((x) => x.role !== "drawing").map(shapeView),
        }
      : "only on the P&ID drawing",
  }));

  const switchDiagram = (d: Diagram) => {
    if (!diagram || d === diagram) return;
    g.stash.current[diagram] = pos;
    g.setPos(g.stash.current[d] ?? layoutFor(d, g.vars, g.siteLayout, frame));
    setDiagram(d);
    select(null);
  };

  /** Link mode: the first click picks the source, the second the target (the same variable: its own past). */
  const linkStep = (v: string) => {
    if (!pending) return setPending(v);
    edit((ls) => withLink(ls, pending, v));
    if (pending === v) select(v);
    else select(null, keyOf({ from: pending, to: v }));
    setPending(null);
    setLinking(false);
  };

  const onInstrumentDown = (v: string, e: PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey && !linking) return toggleMulti(v); // Shift-click: in or out of the multi-selection
    // locked, nothing moves; on the circle, instruments do not move but a drag from one pans the view. A press
    // without moving is a click: it selects
    if (linking) return linkStep(v);
    if (pull > 0 || locked) return view.startPan(e, () => toggleVar(v));
    dragFrom.current = pos[v] ? { v, x: pos[v].x, y: pos[v].y } : null;
    drag.start(v, e);
  };

  const save = async (target = file!) => {
    try {
      await saveCausalGraph(DATASET, { file_name: target, ...toSavePayload(g.vars, g.links, g.strengths) }, scope);
      if (k.dirty) {
        await savePidConstruct(DATASET, k.shapes, scope);
        k.setDirty(false);
        k.setFirstGuess(false);
      }
      const layout = diagramsToSave(diagram ?? "drawn", pos, g.stash.current, trayTop);
      if (strips) layout[SURFACE] = { x: 0, y: surfaceH, tag: "" };
      if (plant.components.length) Object.assign(layout, plantLayoutEntries(g.vars, plant.components, assign));
      const saved = await updateSite(DATASET, (s) => ({ ...s, pid_layout: { ...s.pid_layout, ...layout }, hex_option: g.hex, pid_notes: g.notes }), scope);
      g.setSiteLayout(saved.pid_layout ?? {});
      g.setDirty(false);
      setSavedAt(Date.now()); // the page below reads the saved graph again
      forgetDraft(file!, target);
      g.rebase(target);
      setSaveAs(null);
      if (target !== file) {
        setFiles((fs) => [...new Set([...fs, target])].sort());
        setFile(target); // reloads the drawing from the new file
      }
      setStatus(setup ? `Saved to ${target}.` : `Saved to ${target}. Pick it on the Train tab (Causal graph) and train.`);
      logChange(`saved to ${target}`, "you");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };



  // the construct's edits (useConstructEdits.ts): every edit is unsaved until Save, like the graph
  const constructEdits = useConstructEdits({
    k,
    g,
    selShape,
    setSelShape,
    select,
    change,
    addVariable,
    showVar,
    frameH,
    constructOn,
    frac,
  });
  const { shapeChanged, putShape, createShape, editShape, deleteShape, matchVariable, shapeView } = constructEdits;

  const discover = async ({ method, minLag, maxLag, alpha, prior }: DiscoverOptions) => {
    // blind: no drawn link as prior, every pair of the drawn variables with data is tested
    const tested = prior === "none" ? vars.filter((v) => pickedSet.has(v) && dataColumns.includes(v)) : [];
    if (prior === "none" && tested.length < 2) return setStatus("Show at least two variables with data first.");
    if (prior === "graph" && !crossLinks.length) return setStatus("Draw some links first.");
    const pairs = prior === "none" ? allPairs(tested) : crossLinks.map((l) => ({ source: l.from, target: l.to }));
    setDiscovering(true);
    const what = prior === "none" ? `links among ${tested.length} variables` : `lags for ${crossLinks.length} links`;
    setStatus(`Discovering ${what} (${method.toUpperCase()}, alpha ${alpha}, lags ${minLag} to ${maxLag})…`);
    try {
      const res = await discoverLinkLags(DATASET, { links: pairs, min_lag: minLag, max_lag: maxLag, alpha, method });
      g.setStrengths((ss) => withDiscoveredStrengths(ss, res));
      if (prior === "none") {
        edit((ls) => blindDiscovered(ls, tested, res));
        g.setNoEvidence(new Set());
        setStatus(`Found ${res.links.filter((r) => r.lags.length).length} links among ${tested.length} variables (no drawn link as prior). Save to keep.`);
        return;
      }
      const none = noEvidenceOf(crossLinks, res);
      edit((ls) => applyDiscoveredLags(ls, res)); // the latest links: edits made while waiting are kept
      g.setNoEvidence(none);
      setStatus(discoverySummary(res, none.size));
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setDiscovering(false);
    }
  };

  /** Remove the P&ID picture (the backend backs it up first); the page reloads without it. */
  const removePicture = async () => {
    if (
      !window.confirm(
        "Remove the P&ID picture, its construct and plant graph? They are backed up in the data center's .backup folder, and the instruments placed on it are taken off it (they wait in the Variables menu).",
      )
    )
      return;
    try {
      const r = await removePidDrawing(DATASET, scope);
      setStatus(`Removed. Backup: ${r.backup}`);
      window.location.reload();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };


  // what the assistant can do on the drawing (usePidCommands.ts): positions in fractions of the P&ID picture
  usePidCommands({
    views: pidViews,
    ops,
    construct: constructEdits,
    g,
    k,
    vars,
    links,
    crossLinks,
    pos,
    pull,
    layers,
    setLayers,
    viewsAs,
    setViewsAs,
    locked,
    view,
    frameH,
    viewH,
    linking,
    pending,
    selVar,
    select,
    toggleVar,
    linkStep,
    change,
    logChange,
    edit,
    showVar,
    showVars,
    pickedSet,
    setMulti,
    setSelShape,
    keepDraft,
    discard,
    file,
    columns,
    frac,
  });
  return (
    <div className="pid-page">
      {/* every control of the page in one card: the toolbar, the edit bars, the notes, the variables bar */}
      <div className="card pid-controls">
        <Toolbar
          intro={paper ? "paper" : showEquipment ? "drawn" : "none"}
          title={setup?.title}
          text={!paper ? (setup?.intro ?? (liquid && showEquipment ? LIQUID_INTRO : undefined)) : undefined}
          name={cfg.name ?? DATASET}
          diagram={diagram}
          onDiagram={canDraw && imgH !== null ? switchDiagram : null}
          files={files}
          file={file}
          onFile={setFile}
          hex={showEquipment ? g.hex : null}
          hexes={hexes}
          onHex={pickHex}
          discovering={discovering}
          onDiscover={discover}
          dirty={g.dirty}
          onSave={() => save()}
          savingAs={saveAs !== null}
          onToggleSaveAs={() => setSaveAs(saveAs === null ? (file ?? "causal_graph.json").replace(/\.json$/, "_lags.json") : null)}
          importing={importing}
          onImport={() => setImporting(true)}
          edit={editMode}
          onEdit={(on) => {
            setEditMode(on);
            try {
              localStorage.setItem(editKey, on ? "1" : "0");
            } catch {
              /* the mode is only not remembered */
            }
            if (!on) {
              // done: every open tool closes
              setEditing(false);
              setTool("select");
              setLinking(false);
              setPending(null);
              setAddingVar(false);
              setSaveAs(null);
            }
          }}
        >
          {importing && <PidImport scope={scope} onClose={() => setImporting(false)} onUsed={() => window.location.reload()} />}
        </Toolbar>
        {constructOn && editMode && (
          <ConstructBar
            layers={layers}
            onLayers={setLayers}
            viewsAs={views.length ? viewsAs : null}
            onViewsAs={setViewsAs}
            editing={editing}
            onEditing={(on) => {
              setEditing(on);
              if (on) setLocked(false);
              setTool("select");
              if (on && !layers.construct) setLayers({ ...layers, construct: true });
            }}
            tool={tool}
            onTool={setTool}
            count={k.shapes.length}
            drawing={k.shapes.filter((x) => x.role === "drawing").length}
            firstGuess={k.firstGuess}
            onRemovePicture={paper ? removePicture : null}
          />
        )}
        {saveAs !== null && <SaveAsBar initial={saveAs} onSave={save} />}
        {g.restored && (
          <div className="pid-status pid-draft" role="status">
            Restored unsaved draft{g.draftAt ? ` of ${fmtDateTime(g.draftAt)}` : ""}: Save to keep it in {file}, or
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => window.confirm("Discard the unsaved changes? The drawing goes back to the last save.") && discard()}
            >
              Discard
            </button>
          </div>
        )}
        {(status || linking) && (
          <div className="pid-status" role="status">
            {linking ? (pending ? `From ${pending}: now click the instrument it influences.` : "Click the instrument the link starts from.") : status}
          </div>
        )}

        {/* the variables and links: a bar above the drawing (the drawing has the whole width) */}
        <div className="pid-topbar">
          <VariableMenu
            vars={vars}
            shown={pickedSet}
            labels={labels}
            selected={selVar}
            onShown={showVars}
            onSelect={(v) => {
              showVar(v);
              select(v);
            }}
            addingVar={addingVar}
            onToggleVar={() => setAddingVar(!addingVar)}
            newColumns={offered.filter((c) => !g.vars.includes(c))}
            onAddVar={addVariable}
            approach={approach}
            linking={linking}
            onToggleLink={() => {
              setLinking(!linking);
              setPending(null);
              select(null);
            }}
            size={size}
            onSize={(z) => {
              setSize(z);
              saveSize(store, z);
            }}
            notes={g.notes}
            edit={editMode}
          />
          <button type="button" className={`btn btn--sm${kpis ? " btn--primary" : ""}`} aria-pressed={!!kpis} onClick={toggleKpis}>
            KPI variables
          </button>
          {/* in the same bar: the P&ID -> causal graph slider, the views, documents and changes (folded), the links' count */}
          <div
            className="pid-topbar__stage"
            title={`Click an instrument or a causal link to ${editMode ? "edit" : "see"} it. ${crossLinks.length} links between variables.`}
          >
            <StageSlider value={slider} onChange={setSlider} />
          </div>
          <details className="pid-more pid-more--inline">
            <summary>{legendBeside ? "Views, documents and changes" : "Views, documents, changes and legend"}</summary>
            <div className="pid-more__body">
              <ViewsBox
                views={views}
                pictures={pictures}
                construct={Object.fromEntries(
                  Object.entries(viewShapes).map(([id, ss]) => [
                    id,
                    { shapes: ss.length, components: ss.filter((s) => s.role === "component" || s.role === "instrument").length },
                  ]),
                )}
                marking={marking}
                onMarking={(on) => {
                  setMarking(on);
                  setNewArea(null);
                }}
                marked={newArea !== null}
                onCreate={(name) =>
                  newArea &&
                  addView(name, newArea, "you")
                    .then((v) => {
                      setNewArea(null);
                      setStatus(`Made the view ${v.name}. Give it a picture (Picture…), then open it to place its variables.`);
                    })
                    .catch((e) => setStatus(errorMessage(e)))
                }
                onCancel={() => setNewArea(null)}
                onOpen={(id) => {
                  try {
                    openView(id);
                  } catch (e) {
                    setStatus(errorMessage(e));
                  }
                }}
                onWhole={view.fit}
                onPicture={(id, f) => setViewPicture(id, f, "you").catch((e) => setStatus(errorMessage(e)))}
                onRemove={(id) => removeView(id, "you").catch((e) => setStatus(errorMessage(e)))}
                onShowAs={(id, show) =>
                  storeViews(views.map((x) => (x.id === id ? { ...x, show } : x)))
                    .then(() => logChange(`showed the view ${viewOf(id).name} as ${show}`, "you"))
                    .catch((e) => setStatus(errorMessage(e)))
                }
              />
              <DocumentsBox views={views} onStatus={setStatus} onChange={setDocuments} />
              <ChangesBox
                log={changes}
                onClear={() => {
                  setChanges([]);
                  saveChanges(store, []);
                }}
              />
              {!legendBeside && <Legend drawn={showEquipment || (!paper && !!setup)} />}
            </div>
          </details>
          {kpis && (
            <ul className="pid-kpis" aria-label="KPIs and their variables">
              {!kpis.lines.length && <li>No KPI variables yet: choose them under KPI variables in the Modelling below.</li>}
              {kpis.lines.map((l) => (
                <li key={l.label}>
                  <button
                    type="button"
                    className="pid-kpis__name"
                    aria-pressed={kpiPick === l.label}
                    title={`Mark only the variables of ${l.label}`}
                    onClick={() => setKpiPick(kpiPick === l.label ? null : l.label)}
                  >
                    {l.label}
                  </button>{" "}
                  <InfoMark term={l.label} text={l.about} />{" "}
                  {l.formula ? <span className="mono">{l.formula}</span> : <span className="pid-kpis__missing">needs {l.missing.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="pid-main">
        <div className="card pid-canvas">
          <ViewControls
            zoom={view.view.zoom}
            onZoomIn={view.zoomIn}
            onZoomOut={view.zoomOut}
            onFit={view.fit}
            fitted={view.fitted}
            locked={locked}
            onLock={(on) => {
              setLocked(on);
              if (on) setEditing(false);
            }}
            selecting={selecting}
            onSelecting={setSelecting}
          />
          {dropOn && (
            <DropMenu
              {...dropOn}
              same={sameRefusal(dropOn.v, dropOn.onto)}
              onSame={() => {
                makeSame(dropOn.v, dropOn.onto);
                setDropOn(null);
              }}
              onGroup={(method) => {
                try {
                  dragBack(dropOn.v);
                  groupVars([dropOn.v, dropOn.onto], groupName([dropOn.v, dropOn.onto], method, g.vars), method, true, "you");
                } catch (e) {
                  setStatus(errorMessage(e));
                }
                setDropOn(null);
              }}
              onCancel={() => {
                dragBack(dropOn.v);
                setDropOn(null);
              }}
            />
          )}
          {multi.size > 0 && (
            <SelectionBar
              key={[...multi].join("|")}
              selected={[...multi]}
              suggest={(method) => groupName([...multi], method, g.vars)}
              preview={(find, replace, regex) => {
                try {
                  const n = Object.keys(renamed([...multi], names, find, replace, regex)).length;
                  return `${n} of ${multi.size} names change`;
                } catch {
                  return "not a valid pattern";
                }
              }}
              onRename={async (find, replace, regex) => {
                try {
                  const next = renamed([...multi], names, find, replace, regex);
                  if (!Object.keys(next).length) return (setStatus("No name contains that"), false);
                  await rename(next, "you");
                  return true;
                } catch (e) {
                  setStatus(errorMessage(e));
                  return false;
                }
              }}
              onGroup={(name, method, hide) => {
                try {
                  groupVars([...multi], name, method, hide, "you");
                  return true;
                } catch (e) {
                  setStatus(errorMessage(e));
                  return false;
                }
              }}
              onKind={(kind) =>
                annotate(
                  [...multi].map((variable) => ({ variable, kind })),
                  "you",
                )
              }
              onConfidence={(confidence) =>
                annotate(
                  [...multi].map((variable) => ({ variable, confidence })),
                  "you",
                )
              }
              onHide={hideSelected}
              onDelete={() => void deleteSelected()}
              onClear={() => setMulti(new Set())}
            />
          )}
          <PidCanvas
            scope={scope}
            svg={svg}
            viewH={viewH}
            viewBox={view.viewBox}
            paperH={paper ? trayTop : null}
            span={span}
            equipment={showEquipment ? g.hex : null}
            weatherSlots={Object.keys(weather).length}
            boxName={setup?.frame?.name}
            strips={strips}
            liquid={liquid}
            freeCooling={freeCooling}
            drawing={!paper && setup ? setup.drawing : null}
            hallOnWater={hallOnWater}
            condenser={!cfg.heat_source || !!cfg.heat_source.condenser}
            hexes={hexes}
            taps={setup ? (strips ? framedTaps(setup.taps) : setup.taps) : liquid ? LIQUID_TAPS : hallOnWater ? DC_TAPS_HALL_WATER : undefined}
            readout={readout}
            graph={{
              vars: visible,
              labels,
              fullNames,
              size,
              notes: g.notes,
              kpiUses: kpis && (kpiPick ? Object.fromEntries(Object.entries(kpis.uses).filter(([, t]) => feedsKpi(t, kpiPick))) : kpis.uses),
              pos,
              shown,
              links: drawnLinks,
              strengths: g.strengths,
              selfLags,
              roles,
              noEvidence: g.noEvidence,
            }}
            selection={{ multi, box: box.box, selVar, selLink, pending, linking }}
            layers={{
              plant: plantOn && !k.shapes.length ? plant : null,
              construct:
                constructOn && layers.construct ? (
                  <ConstructLayer
                    svg={svg}
                    shapes={k.shapes}
                    frameH={frameH}
                    opacity={1 - 0.85 * t}
                    editing={editing}
                    tool={tool}
                    selected={selShape}
                    onSelect={(id) => {
                      select(null);
                      setSelShape(id);
                    }}
                    onShape={putShape}
                    onDone={shapeChanged}
                    onCreate={createShape}
                  />
                ) : null,
              showPicture: layers.picture,
              showVariables: layers.variables,
              t,
              views,
              pictures,
              viewsAs,
              viewShapes,
              showConstruct: layers.construct,
              window: view.window,
            }}
            handlers={{
              onSurface: (h: number, done: boolean) => {
                setSurface(h);
                if (done) change();
              },
              onHex: pickHex,
              onDropVariable: dropVar,
              onOpenView: (id) => {
                try {
                  openView(id);
                } catch (e) {
                  setStatus(errorMessage(e));
                }
              },
              onInstrumentDown,
              onSelectLink: (key) => select(null, key),
              onBackground: (e) =>
                e.shiftKey || selecting || marking
                  ? box.start(e) // a box: the instruments in it are selected, or the area of a new view
                  : view.startPan(e, () => {
                      select(null);
                      setPending(null);
                      setMulti(new Set());
                    }),
              onMove: drag.onMove,
              onUp: drag.onUp,
            }}
          />
          {legendBeside && (
            <div className="pid-legend-side" style={{ width: `calc(${((span.x1 - W) / (span.x1 - span.x0)) * 100}% - 12px)` }}>
              <Legend drawn={false} />
            </div>
          )}
          {(shape || (selVar && pos[selVar]) || (link && selLink)) && (
            <aside className="card pid-side pid-inspect" aria-label="Selection">
              <button
                type="button"
                className="btn btn--sm btn--ghost pid-inspect__close"
                aria-label="Close"
                onClick={() => {
                  select(null);
                  setSelShape(null);
                }}
              >
                ×
              </button>
              {shape ? (
                <ShapeInspector
                  shape={shape}
                  onDrawing={vars}
                  columns={offered.filter((c) => !g.vars.includes(c))}
                  onEdit={(e) => editShape(shape, e)}
                  onMatch={(v) => matchVariable(v, shape)}
                  onDelete={() => deleteShape(shape.id)}
                />
              ) : selVar && pos[selVar] ? (
                <VariableInspector
                  v={selVar}
                  tag={pos[selVar].tag}
                  kind={kindOf(selVar)}
                  selfLags={selfLags[selVar] ?? []}
                  crossLinks={crossLinks}
                  noEvidence={g.noEvidence}
                  onTag={(tag) => {
                    g.setPos((ps) => ({ ...ps, [selVar]: { ...ps[selVar], tag } }));
                    change();
                  }}
                  onSelfLags={(lags) => edit((ls) => withSelfLags(ls, selVar, lags))}
                  onSelectLink={(key) => select(null, key)}
                  onDelete={() => deleteVariable(selVar).catch((e) => setStatus(errorMessage(e)))}
                  shownName={shownName(selVar, names)}
                  onRename={(name) => rename({ [selVar]: name }, "you").catch((e) => setStatus(errorMessage(e)))}
                  group={g.notes[selVar]?.group}
                  inGroups={memberOf(g.notes)[selVar]}
                  onUngroup={() => ungroup(selVar, "you")}
                />
              ) : link && selLink ? (
                <LinkInspector
                  link={link}
                  strengths={g.strengths}
                  onLags={(lags) => edit((ls) => withLinkLags(ls, selLink, lags))}
                  onDelete={() => {
                    edit((ls) => withLinkLags(ls, selLink, []));
                    setSelLink(null);
                  }}
                />
              ) : null}
            </aside>
          )}
        </div>
      </div>
      {model && (
        <BelowStructure label="Modelling" open={scope === "district" && !!peekBuilding()}>
          {model({
            scope,
            files,
            file,
            onFile: setFile,
            targets: toSavePayload(g.vars, g.links, g.strengths).targets,
            saved: savedAt,
            dirty: g.dirty,
            onAddVariable: (v) => addVariable(v),
            library: setup?.library,
            onApproach: report,
            onSelect: (v) => {
              showVar(v);
              select(v);
            },
            selected: selVar,
          })}
        </BelowStructure>
      )}
    </div>
  );
}
