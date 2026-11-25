/**
 * The drawing of the Physical structure page in three levels, bottom to top: the picture (paper P&ID image,
 * or the built-in equipment; the extracted plant when there is no construct yet), the digital construct (shapes,
 * ConstructLayer), and the variables (sensor taps, causal arcs, instruments). Each level can be hidden. The views
 * (areas of the P&ID with a picture of their own, views.ts) are drawn over the picture and the construct at their
 * level of detail: a box, the sheet underneath (a frame only) or their own picture, opaque, so inside it only that
 * shows; nested ones over the views around them; the variables stay on top, and
 * one placed in a view is drawn at the view's scale. The SVG ids (grid, flow-*, way-*) are
 * document-global: render one PidCanvas per page.
 */
import { useCallback, useMemo, type DragEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { pidImageUrl, pidViewImageUrl, type CausalLinkStrength, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import type { Plant } from "../../../lib/plantLinks";
import { CausalArcs } from "./CausalArcs";
import type { Shape } from "./construct";
import { ConnectionPoints, DcBoundary, WeatherBox } from "./ConnectionPoints";
import type { StripVar } from "./connection";
import { ConstructLayer } from "./ConstructLayer";
import { DrawnEquipment, type QReadout } from "./DrawnEquipment";
import { DrawnLiquid } from "./DrawnLiquid";
import { DC_TAPS, GRID, H, layoutArcs, nameAbove, R, W, type Taps } from "./geometry";
import { Instrument } from "./Instrument";
import type { Pos } from "./layout";
import { isSelf, linkWidths, type Link } from "./links";
import { PlantOverlay } from "./PlantOverlay";
import { WAYS, type Roles } from "./roles";
import { SensorTaps } from "./SensorTaps";
import type { Notes } from "./notes";
import { VARIABLE_DRAG } from "./VariableMenu";
import type { Hex } from "./usePidGraph";
import { outerFirst, shownAs, viewAt, type PidView, type ViewsAs } from "./views";

const NOTHING = () => {}; // a view's construct is shown, not edited here

/** Arrowheads: id, colour, size (drawing units). */
const MARKERS: [string, string, number][] = [
  ["flow-hot", "var(--hot)", 8],
  ["flow-cold", "var(--cool-strong)", 8],
  ["flow-heat", "var(--heat-strong)", 8],
  ["flow-io", "var(--foreground-secondary)", 8],
  ...Object.entries(WAYS).map(([way, c]): [string, string, number] => [`way-${way}`, c, 5.5]), // a causal link's, fine like its line, coloured like the variable it points to
];

/** The variables and links drawn, and how each looks. */
export interface CanvasGraph {
  vars: string[]; // the variables shown
  labels: Record<string, string>; // variable -> its label on the drawing (short for a long name)
  fullNames: Record<string, string>; // variable -> its whole name on hover (the name shown and its own)
  size: number; // instrument scale
  notes: Notes; // what each variable is and how sure
  kpiUses: Record<string, string> | null; // the KPI variables marked (the top bar's KPI variables), or null
  pos: Pos; // P&ID positions
  shown: Pos; // positions on screen (moving into the circle)
  links: Link[];
  strengths: CausalLinkStrength[];
  selfLags: Record<string, number[]>;
  roles: Roles;
  noEvidence: Set<string>;
}

/** What is selected or being picked. */
export interface CanvasSelection {
  multi: Set<string>; // the variables in the multi-selection
  box: { a: { x: number; y: number }; b: { x: number; y: number } } | null; // the selection box being dragged
  selVar: string | null;
  selLink: string | null;
  pending: string | null;
  linking: boolean;
}

/** The levels shown (picture, construct, variables), the fade, and the views over them. */
export interface CanvasLayers {
  plant: Plant | null; // extracted plant to overlay, or null
  construct: ReactNode; // level 2: the digital construct (ConstructLayer), or null
  showPicture: boolean;
  showVariables: boolean;
  t: number;
  views: PidView[]; // areas of the P&ID with a picture of their own
  pictures: Record<string, number>; // view id -> its picture's version (no entry: no picture)
  viewsAs: ViewsAs; // the layer bar's level for every view, or each its own
  viewShapes: Record<string, Shape[]>; // view id -> the construct read from its picture
  showConstruct: boolean; // the construct layer is on (the views' constructs follow it)
  window: { w: number; h: number }; // the part of the drawing on screen (drawing units): "auto" views follow the zoom
}

/** What the drawing tells the page. */
export interface CanvasHandlers {
  onSurface: (h: number, done: boolean) => void; // the box's bottom edge dragged: the surface's new height
  onHex?: (h: Hex) => void;
  onDropVariable: (v: string, at: { x: number; y: number }) => void; // dragged from the Variables menu
  onOpenView: (id: string) => void; // its name clicked: zoom onto it
  onInstrumentDown: (v: string, e: PointerEvent) => void;
  onSelectLink: (key: string) => void;
  onBackground: (e: PointerEvent) => void; // a press on the empty drawing
  onMove: (e: PointerEvent) => void;
  onUp: () => void;
}

interface Props {
  scope: StructureScope; // whose picture (PidPage)
  svg: RefObject<SVGSVGElement | null>;
  viewH: number;
  viewBox: string; // the part of the W x viewH drawing shown (zoom and pan, view.ts)
  /** paper image height (the whole canvas: nothing is drawn below it), or null when the built-in drawing (or none) is shown */
  paperH: number | null;
  span: { x0: number; x1: number }; // the drawing's ends: the connection points' margins beside a picture or an empty structure
  equipment: Hex | null; // the built-in drawing with this heat exchanger, or null
  condenser?: boolean; // the data has the condenser HEX (dataset.json heat_source): drawn, else left out
  weatherSlots: number; // the weather's variables in its box (connection.ts weatherSpots)
  strips: StripVar[] | null; // an empty structure's inputs and outputs, above the data center's box: no weather box then
  boxName?: string; // that box's name: another part's in the new form (StructureSetup frame), else the data center
  liquid?: boolean; // a liquid-cooled data center: its built-in drawing is DrawnLiquid
  freeCooling?: boolean; // the air-cooled drawing with its free-cooling plate HEX
  hallOnWater?: boolean; // its hall HEX on the chilled-water return, not in the warm air
  drawing?: ((opacity: number, framed?: boolean) => ReactNode) | null; // another structure's built-in drawing (PidPage setup)
  taps?: Taps; // what that drawing's sensors tap onto (else the data center's cooling loop)
  hexes?: string[]; // the extraction points (dataset.json heat_source): a click on one's heat exchanger picks it
  readout: QReadout | null; // the selected HEX's calculated heat, shown next to it
  graph: CanvasGraph;
  selection: CanvasSelection;
  layers: CanvasLayers;
  handlers: CanvasHandlers;
}

export function PidCanvas({ graph, selection, layers, handlers, ...frame }: Props) {
  const p = { ...frame, ...graph, ...selection, ...layers, ...handlers };
  const width = useMemo(() => linkWidths(p.strengths), [p.strengths]);
  const frameH = p.paperH ?? p.viewH;
  // a variable in a view is drawn at the view's scale (its width on the P&ID), so it fits the view's picture
  const scale = useMemo(
    () => Object.fromEntries(p.vars.map((v) => [v, p.pos[v] ? (viewAt(p.views, p.pos[v].x / W, p.pos[v].y / frameH)?.w ?? 1) : 1])),
    [p.vars, p.pos, p.views, frameH],
  );
  // each bubble's drawn radius: the lines touch it at any size
  const radius = useCallback((v: string) => R * p.size * (scale[v] ?? 1), [p.size, scale]);
  const arcLayout = useMemo(
    () =>
      layoutArcs(
        p.links.filter((l) => !isSelf(l)),
        p.shown,
        radius,
      ),
    [p.links, p.shown, radius],
  );
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(VARIABLE_DRAG);
  const drop = (e: DragEvent<SVGSVGElement>) => {
    const v = e.dataTransfer.getData(VARIABLE_DRAG);
    const ctm = e.currentTarget.getScreenCTM();
    if (!v || !ctm) return;
    e.preventDefault();
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    p.onDropVariable(v, { x: at.x, y: at.y });
  };
  return (
    <svg
      ref={p.svg}
      data-live-grid
      data-live-whole={`0 0 ${W} ${p.viewH}`}
      data-live-grid-h={p.paperH ?? p.viewH}
      viewBox={p.viewBox}
      onDragOver={(e) => accepts(e) && e.preventDefault()}
      onDrop={drop}
      onPointerMove={p.onMove}
      onPointerUp={p.onUp}
      onPointerDown={p.onBackground}
      onDoubleClick={(e) => {
        // a double click on a view opens it (the innermost one there)
        const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(e.currentTarget.getScreenCTM()!.inverse());
        const v = viewAt(p.views, at.x / W, at.y / frameH);
        if (v) p.onOpenView(v.id);
      }}
      style={{ aspectRatio: `${p.span.x1 - p.span.x0} / ${p.viewH}` }} // the drawing with its margins: no band above or below it
      role="img"
      aria-label="P&ID with causal links"
    >
      <defs>
        <pattern id="grid" width={GRID * 2} height={GRID * 2} patternUnits="userSpaceOnUse">
          <path d={`M${GRID * 2},0 H0 V${GRID * 2}`} fill="none" stroke="var(--chart-grid)" />
        </pattern>
        {MARKERS.map(([id, c, size]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth={size}
            markerHeight={size}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>
      <rect x={p.span.x0} width={p.span.x1 - p.span.x0} height={p.viewH} fill="url(#grid)" />
      {p.paperH !== null && p.showPicture && (
        <g pointerEvents="none">
          {/* the paper's drawing on a light panel; in dark mode it is inverted (.pid-paper in pid.css) */}
          <image
            className="pid-paper"
            href={pidImageUrl(DATASET, p.scope)}
            width={W}
            height={p.paperH}
            opacity={1 - 0.85 * p.t}
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      )}
      {p.plant && p.paperH !== null && p.showPicture && <PlantOverlay plant={p.plant} height={p.paperH} opacity={1 - 0.85 * p.t} />}
      {p.equipment &&
        p.showPicture &&
        (p.liquid ? (
          <DrawnLiquid opacity={1 - p.t} hex={p.equipment} readout={p.readout} alone={!!p.strips} edge={p.strips ? W : undefined} />
        ) : (
          <DrawnEquipment
            opacity={1 - p.t}
            hex={p.equipment}
            condenser={p.condenser}
            readout={p.readout}
            freeCooling={p.freeCooling}
            hallOnWater={p.hallOnWater}
            alone={!!p.strips}
            edge={p.strips ? W : undefined}
          />
        ))}
      {p.equipment && p.showPicture && p.t < 0.5 && p.onHex && (p.hexes?.length ?? 0) > 1 && (
        <HexPicks hexes={p.hexes!} at={p.equipment} units={(p.taps ?? DC_TAPS).units} onHex={p.onHex} />
      )}
      {p.drawing && p.showPicture && p.drawing(1 - p.t, !!p.strips)}
      {/* no built-in drawing, or one inside the data center's box: the connection points beside it */}
      {((!p.equipment && !p.drawing) || p.strips) && (
        <ConnectionPoints scope={p.scope} h={p.paperH ?? H} margin={Math.max(p.span.x1 - W, -p.span.x0)} opacity={1 - 0.85 * p.t} />
      )}
      {/* the weather beside the connection point, on every structure */}
      {p.strips ? (
        <DcBoundary vars={p.strips} pos={p.pos} h={p.viewH} onResize={p.onSurface} opacity={1 - 0.85 * p.t} name={p.boxName} />
      ) : p.equipment || p.drawing ? (
        p.showPicture && <WeatherBox scope={p.scope} drawn n={p.weatherSlots} opacity={1 - p.t} />
      ) : (
        <WeatherBox scope={p.scope} drawn={false} n={p.weatherSlots} opacity={1 - 0.85 * p.t} />
      )}
      {p.construct}
      {outerFirst(p.views).map((v) => {
        const [x, y, w, h] = [v.x * W, v.y * frameH, v.w * W, v.h * frameH];
        const as = shownAs(v, p.viewsAs, p.pictures[v.id] !== undefined, Math.max(w / p.window.w, h / p.window.h));
        return (
          <g key={v.id} className="pid-view" aria-label={`View ${v.name}`} data-shown-as={as}>
            {as === "picture" && (
              // a window onto its own picture and construct: opaque, over the sheet and the sheet's construct
              <g pointerEvents="none">
                <rect x={x} y={y} width={w} height={h} className="pid-view__panel" />
                {p.showPicture && (
                  <image
                    className="pid-paper"
                    href={pidViewImageUrl(DATASET, v.id, p.pictures[v.id], p.scope)}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    opacity={1 - 0.85 * p.t}
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}
                {p.showConstruct && p.viewShapes[v.id] && (
                  // its shapes are fractions of its picture: drawn on a W-wide frame of the picture's shape, scaled into the area
                  <g transform={`translate(${x} ${y}) scale(${v.w})`}>
                    <ConstructLayer
                      svg={p.svg}
                      shapes={p.viewShapes[v.id]}
                      frameH={h / v.w}
                      opacity={1 - 0.85 * p.t}
                      editing={false}
                      tool="select"
                      selected={null}
                      onSelect={NOTHING}
                      onShape={NOTHING}
                      onDone={NOTHING}
                      onCreate={NOTHING}
                    />
                  </g>
                )}
              </g>
            )}
            {as === "box" ? (
              // the most abstract: a plain box with its name, over whatever is underneath
              <>
                <rect x={x} y={y} width={w} height={h} className="pid-view__panel" pointerEvents="none" />
                <rect x={x} y={y} width={w} height={h} className="pid-view__box" pointerEvents="none" />
                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  className="pid-view__name pid-view__name--box"
                  style={{ fontSize: Math.min(h * 0.4, (w * 1.6) / Math.max(6, v.name.length + 2)) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => p.onOpenView(v.id)}
                >
                  <title>Open the view {v.name}</title>
                  {v.name}
                </text>
              </>
            ) : (
              <>
                <rect x={x} y={y} width={w} height={h} className="pid-view__frame" pointerEvents="none" />
                <text
                  x={x + 4 * v.w}
                  y={y - 5 * Math.max(v.w, 0.15)}
                  className="pid-view__name"
                  style={{ fontSize: 14 * Math.max(v.w, 0.15) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => p.onOpenView(v.id)}
                >
                  <title>Open the view {v.name}</title>▣ {v.name}
                </text>
              </>
            )}
          </g>
        );
      })}
      {p.showVariables && <SensorTaps vars={p.vars} pos={p.pos} opacity={1 - p.t} hidden={!p.equipment && !p.drawing} taps={p.taps} radius={radius} />}
      {p.showVariables && (
        <CausalArcs
          {...arcLayout}
          at={p.shown}
          radius={radius}
          t={p.t}
          selVar={p.selVar}
          selLink={p.selLink}
          noEvidence={p.noEvidence}
          roles={p.roles}
          width={width}
          onSelectLink={p.onSelectLink}
        />
      )}
      {p.vars.map((v) =>
        p.shown[v] && p.showVariables ? (
          <Instrument
            key={v}
            v={v}
            p={p.shown[v]}
            selected={v === p.selVar || v === p.pending}
            selfLags={p.selfLags[v]}
            roles={p.roles}
            linking={p.linking}
            nameAbove={(!!p.equipment || !!p.drawing) && p.t < 0.5 && !!p.pos[v] && nameAbove(v, p.pos[v].x, p.pos[v].y, p.taps)}
            label={p.labels[v]}
            size={p.size * scale[v]}
            note={p.notes[v]}
            multi={p.multi.has(v)}
            fullName={p.fullNames[v]}
            kpi={p.kpiUses?.[v]}
            onPointerDown={p.onInstrumentDown}
          />
        ) : null,
      )}
      {p.box && (
        <rect
          className="pid-selbox"
          x={Math.min(p.box.a.x, p.box.b.x)}
          y={Math.min(p.box.a.y, p.box.b.y)}
          width={Math.abs(p.box.b.x - p.box.a.x)}
          height={Math.abs(p.box.b.y - p.box.a.y)}
        />
      )}
    </svg>
  );
}

const HEX_UNIT: Record<string, string> = { hall: "hexHall", condenser: "hexCond", liquid: "hexLiq" };

/** Over each extraction point's heat exchanger on the built-in drawing, a target to pick it (as the toolbar's buttons
 * and Heat Matching's picture do): its variables then show, the other's hide. */
function HexPicks({ hexes, at, units, onHex }: { hexes: string[]; at: Hex; units: Taps["units"]; onHex: (h: Hex) => void }) {
  return (
    <g role="radiogroup" aria-label="Heat recovery at">
      {hexes.map((h) => {
        const u = units[HEX_UNIT[h]];
        if (!u) return null;
        const name = h === "hall" ? "Hall HEX" : h === "condenser" ? "Condenser HEX" : "Liquid cooling HEX";
        return (
          <rect
            key={h}
            role="radio"
            aria-checked={h === at}
            aria-label={`Heat recovery at the ${name}`}
            tabIndex={0}
            x={u[0] - 6}
            y={u[1] - 6}
            width={u[2] + 12}
            height={u[3] + 12}
            rx={4}
            className="pid-hex-pick"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onHex(h as Hex)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onHex(h as Hex))}
          >
            <title>{h === at ? `${name}: recovering here` : `${name}: click to recover the heat here`}</title>
          </rect>
        );
      })}
    </g>
  );
}
