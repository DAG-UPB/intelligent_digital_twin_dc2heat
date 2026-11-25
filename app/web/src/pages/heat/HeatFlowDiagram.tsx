/**
 * The animated SVG flow diagram of Heat distribution in three columns: the data center (with its selectable
 * extraction points) | the heat distribution (direct HEX, thermal storage and heat pump, stacked) | the district
 * heat. Each connection is a pair of lines, supply (hot, towards the district) and return (cool, back), as wide as
 * its mean flow and labelled with its connection point: the heat Q (the mass flow ṁ = Q / (cₚ · ΔT) on hover) and the
 * two temperatures; Q is grey where it follows from ṁ, "≈" marks a return temperature that is an assumption. Over the three parts, the weather they all share. The three columns are alike and as high, flat, in
 * either way: a part running its Model is its Structure and Modelling's drawing (PartViews.tsx), the pipes meeting it
 * at its connection points; one running its Calculation shows the formulas' parts as compact rows: the data center's
 * extraction points, the heat distribution's units, the district's share met.
 */
import { useState, type ReactNode } from "react";
import type { DistrictSettings } from "../../lib/demand";
import { fmt } from "../../lib/format";
import type { MatchOptions } from "../../lib/matching";
import type { Logic, PartsOn, Temps } from "./parts";
import { DistrictDrawing } from "../district/structure/DistrictDrawing";
import { DcPicks, DcPlant, dcPortX, drawnPoints, FOOT, FRAME, PART_H, PartColumn, partWidth, portY, type Col } from "./PartViews";
import { pointLabel } from "./points";
import { HeatDrawing } from "./structure/HeatDrawing";
import type { Flows } from "./window";

type Box = { x: number; y: number; w: number; h: number };

const W = FRAME.w;
const BAND = 50; // the weather band above the parts
const TOP = 16; // the columns' top, under the weather's arrows
const H = BAND + TOP + PART_H; // the parts' cards are set into their columns' feet
// the three columns, as high (flat) and as wide as their Model drawings at one scale: data center | heat distribution | district heat
const DCW = partWidth("dc");
const MIDW = partWidth("heat");
const DISTW = partWidth("district");
const { gap: GAP, margin: M } = FRAME; // the pipes run in the gaps
const column = (left: number, w: number): Box => ({ x: left + w / 2, y: TOP + PART_H / 2, w, h: PART_H });
const DC = column(M, DCW);
const MID = column(M + DCW + GAP, MIDW);
const DIST = column(W - M - DISTW, DISTW);
const BODY = TOP + 50; // under a column's title and numbers
// the heat distribution's units as rows (Calculation), under its title
const ROW = { h: 46, gap: 6 };
const row = (i: number): Box => ({ x: MID.x, y: BODY + i * (ROW.h + ROW.gap) + ROW.h / 2, w: MIDW - 28, h: ROW.h });
const N = { hex: row(0), tank: row(1), hp: row(2) };
// the district's blocks (Calculation), at the heights where the heat distribution's pipes come in
const distRow = (i: number): Box => ({ ...row(i), x: DIST.x, w: DISTW - 28 });
const D = { demand: distRow(0), met: distRow(1), unmet: distRow(2) };
const L = (n: Box) => n.x - n.w / 2;
const R = (n: Box) => n.x + n.w / 2;
const top = (n: Box) => n.y - n.h / 2;
const SUPPLY_HOT = "var(--hot)";
const SUPPLY = "var(--heat-strong)";
const RETURN = "var(--cool)";

const SPACE = TOP + PART_H - FOOT - 6 - BODY; // the data-center column's body, under its title
const PIC_CARD = 168; // an extraction point's width beside the P&ID

/** Extraction points stacked as rows in the data-center column, under its title (two of 62); `beside`: narrow, at the
 * column's right edge, its P&ID left of them. */
function pointBoxes(keys: string[], beside = false): Record<string, Box> {
  const h = Math.min(beside ? 72 : 62, (SPACE - 8 * (keys.length - 1)) / Math.max(1, keys.length));
  const y0 = BODY + (SPACE - keys.length * h - 8 * (keys.length - 1)) / 2;
  const w = beside ? PIC_CARD : DCW - 32;
  const x = beside ? R(DC) - 16 - w / 2 : DC.x;
  return Object.fromEntries(keys.map((k, i) => [k, { x, y: y0 + i * (h + 8) + h / 2, w, h }]));
}

/** A unit as a row: its name and its value in its tone, a line below; dimmed when off. */
function Row({ n, tone, title, value, sub, on = true, children }: { n: Box; tone: string; title: string; value: string; sub: string; on?: boolean; children?: ReactNode }) {
  return (
    <g opacity={on ? 1 : 0.38} className="hf-fade">
      <rect x={L(n)} y={top(n)} width={n.w} height={n.h} rx={10} fill={`color-mix(in srgb, ${tone} 9%, var(--surface))`} stroke={tone} strokeWidth={1.4} />
      <text x={L(n) + 10} y={top(n) + 18} className="hf-row-title">
        {title}
      </text>
      <text x={R(n) - 10} y={top(n) + 18} textAnchor="end" className="hf-row-value" fill={tone}>
        {value}
      </text>
      <text x={L(n) + 10} y={top(n) + 35} className="hf-sub">
        {sub}
      </text>
      {children}
    </g>
  );
}

/** The data center's drawing: the built-in one of a simulation (air, air with free cooling, liquid), else its own P&ID. */
export type DcDrawing = "air" | "free-cooling" | "liquid" | "picture";

/** A pipe pair's end: one y, or the supply's and the return's. */
type Y = number | [number, number];
const ends = (y: Y, o: number): [number, number] => (typeof y === "number" ? [y - o, y + o] : y);
const mid = (y: Y) => (typeof y === "number" ? y : (y[0] + y[1]) / 2);

const deg = (t: number, approx = false, d = 1) => `${approx ? "≈" : ""}${fmt(t, d)} °C`;

/** The shared weather's window means (undefined: no data for it). */
export interface WeatherMeans {
  t?: number;
  hum?: number;
  sun?: number;
}

/** cₚ in kJ/(kg·K): of the data center's point (its data's, air at the hall) and of the water elsewhere. */
export interface HeatCapacity {
  dc: number;
  water: number;
}

/** What the diagram draws, without its one callback (Operation keeps a copy of Heat Matching's: matchingSetup.ts). */
export type DiagramProps = Omit<Parameters<typeof HeatFlowDiagram>[0], "onPick" | "loads">;

export function HeatFlowDiagram({
  f,
  opts,
  on,
  settings,
  at,
  shown = at,
  onPick,
  onWeather,
  weatherSource,
  when,
  points,
  keys,
  itKw,
  mode,
  loop,
  cp,
  dcDerived,
  weather,
  dcDrawing,
  picture,
  models,
  loads,
}: {
  f: Flows;
  opts: MatchOptions;
  on: PartsOn; // the switched-on parts
  settings: DistrictSettings;
  at: string;
  shown?: string; // the point drawn and picked: a what-if's, before its run (the numbers stay at `at`'s)
  onPick: (x: string) => void;
  onWeather?: () => void; // the weather band opens the weather window
  weatherSource?: string; // where the weather comes from, on the band (default "shared")
  when?: string; // the time shown, shared like the weather: its calendar week and weekdays (window.ts whenOf)
  points: Partial<Record<string, { q: number; t: number }>>; // window means per extraction point
  keys: string[]; // the extraction points
  itKw?: number;
  mode: Logic; // where the data center's heat comes from
  loop: { hex: Temps; hp: Temps } | null; // the data center's heat loop at the HEX and at the heat pump (window means)
  cp: HeatCapacity;
  dcDerived: "q" | "m"; // which of the data center's Q and ṁ follows from the other (its data's Q is calculated from ṁ)
  weather: WeatherMeans;
  dcDrawing: DcDrawing;
  picture?: string; // the data center's own P&ID (its URL), drawn in its column when it has no built-in drawing
  models: Record<"dc" | "heat" | "district", boolean>; // which parts run their Model (the others their Calculation)
  loads?: Partial<Record<"dc" | "heat" | "district", ReactNode>>; // each part's models and systems, a folder at its top right
}) {
  const [noPicture, setNoPicture] = useState<string | null>(null); // the picture's URL that failed (none saved)
  const pic = picture && picture !== noPicture ? picture : undefined;
  const P = pointBoxes(keys, !!pic);
  const maxFlow = Math.max(1, f.srcQ, f.demand, f.hexOut + f.hexTank, f.hpOut + f.hpTank);
  const hexOn = on.hex && f.toHex > 0.05;
  const hpOn = on.hp && f.toHp + f.elec > 0.05;
  const tankOn = on.tank && opts.tankKwh > 0;
  const lift = settings.supplyTemp - f.srcT;
  const covered = Math.min(100, Math.max(0, f.coverage));
  const tankFill = tankOn ? Math.min(1, f.level / opts.tankKwh) : 0;
  const net: Temps = { supply: settings.supplyTemp, ret: settings.returnTemp, approx: false };

  const width = (flow: number) => 2 + (7 * flow) / maxFlow;

  /** An unused connection: one faint dashed line. */
  const idle = (key: string, d: string) => (
    <path key={key} d={d} fill="none" stroke="var(--border-strong)" strokeWidth={1.2} strokeDasharray="4 5" opacity={0.6} />
  );
  const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
  const flowLabel = (flow: number) => `${fmt(flow, flow < 10 ? 1 : 0)} kW`;

  /** A pair of lines (supply drawn x1→x2, return x2→x1) with its kW and ṁ and, at `tempsAt`, its two temperatures;
   * an end is one y (the two lines either side of it) or the supply's and the return's y (a drawing's pipes). */
  const pair = (
    key: string,
    x1: number,
    y1: Y,
    x2: number,
    y2: Y,
    flow: number,
    t: Temps,
    hot: string,
    tempsAt: "start" | "end",
    c = cp.water,
    derived: "q" | "m" = "m",
  ) => {
    if (flow <= 0.05) return idle(key, curve(x1, mid(y1), x2, mid(y2)));
    const w = width(flow);
    const o = w / 2 + 2;
    const [s1, r1] = ends(y1, o);
    const [s2, r2] = ends(y2, o);
    const sup = curve(x1, s1, x2, s2);
    const ret = curve(x2, r2, x1, r1);
    const [tx, ts, tr, anchor] = tempsAt === "start" ? ([x1 + 10, s1, r1, "start"] as const) : ([x2 - 10, s2, r2, "end"] as const);
    const dt = t.supply - t.ret;
    const m = dt > 0.1 ? flow / (c * dt) : null;
    return (
      <g key={key} className="hf-fade">
        <path d={sup} fill="none" stroke={hot} strokeWidth={w} strokeLinecap="round" opacity={0.5} />
        <path className="hf-flow" d={sup} fill="none" stroke={hot} strokeWidth={Math.max(1.4, w / 3)} strokeLinecap="round" strokeDasharray="2 10" />
        <path d={ret} fill="none" stroke={RETURN} strokeWidth={w * 0.7} strokeLinecap="round" opacity={0.45} />
        <path className="hf-flow" d={ret} fill="none" stroke={RETURN} strokeWidth={Math.max(1.2, w / 4)} strokeLinecap="round" strokeDasharray="2 10" />
        <text x={(x1 + x2) / 2} y={Math.min((s1 + s2) / 2 - 8, ts - 22)} textAnchor="middle" className="hf-flow-label" fill={hot}>
          <tspan className={derived === "q" ? "hf-derived" : undefined}>{flowLabel(flow)}</tspan>
          {/* only the heat on the pipe; its mass flow on hover */}
          <title>{`${m !== null ? `ṁ ${fmt(m, m < 10 ? 2 : 1)} kg/s · ` : ""}${derived === "m" ? "ṁ = Q / (cₚ · ΔT)" : "Q = ṁ · cₚ · ΔT"}, cₚ ${fmt(c, 3)} kJ/(kg·K), ΔT ${fmt(dt, 1)} K`}</title>
        </text>
        <text x={tx} y={ts - 6} textAnchor={anchor} className="hf-temp" fill={hot}>
          {deg(t.supply, false, tempsAt === "end" ? 1 : 0)}
        </text>
        <text x={tx} y={tr + 13} textAnchor={anchor} className="hf-temp" fill="var(--cool-strong)">
          {deg(t.ret, t.approx, tempsAt === "end" ? 1 : 0)}
        </text>
      </g>
    );
  };

  const point = (x: string) => {
    const n = P[x];
    const sel = x === shown;
    const v = points[x];
    const { title, sub } = pointLabel(x);
    return (
      <g
        key={x}
        role="radio"
        aria-checked={sel}
        aria-label={`Extract at ${title} · ${sub}`}
        tabIndex={0}
        onClick={() => onPick(x)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(x))}
        className="hf-point"
        opacity={sel ? 1 : 0.6}
      >
        <rect
          x={L(n)}
          y={top(n)}
          width={n.w}
          height={n.h}
          rx={10}
          fill={sel ? "color-mix(in srgb, var(--hot) 12%, var(--surface))" : "var(--surface)"}
          stroke={sel ? "var(--hot)" : "var(--border-strong)"}
          strokeWidth={sel ? 2 : 1.2}
          strokeDasharray={sel ? undefined : "4 3"}
        />
        <circle cx={L(n) + 16} cy={top(n) + 18} r={6} fill="none" stroke={sel ? "var(--hot)" : "var(--border-strong)"} strokeWidth={1.6} />
        {sel && <circle cx={L(n) + 16} cy={top(n) + 18} r={3} fill="var(--hot)" />}
        <title>{sel ? `extracting here · ${mode === "physics" ? "physics" : "data"}` : "click to extract here"}</title>
        <text x={L(n) + 30} y={top(n) + 22} className="hf-title">
          {title}
          {pic ? (
            <tspan x={L(n) + 16} dy={17} className="hf-point-sub">
              {sub}
            </tspan>
          ) : (
            <tspan dx={6} className="hf-point-sub">
              · {sub}
            </tspan>
          )}
        </text>
        <text x={L(n) + 16} y={top(n) + (pic ? 62 : 46)} className="hf-point-q" fill={sel ? "var(--hot)" : "var(--foreground-secondary)"}>
          {v ? `${fmt(v.q, 1)} kW` : "…"}
          <tspan dx={10} className="hf-point-t" fill={sel ? "var(--heat-strong)" : "var(--foreground-secondary)"}>
            {v ? `${fmt(v.t, 1)} °C` : ""}
          </tspan>
        </text>
      </g>
    );
  };

  // a part running its Model is its drawing (the data center's only when it is a built-in one with these points);
  // the pipes meet each drawing where its own pipes cross its edge
  const col = (b: Box): Col => ({ x: L(b), w: b.w, top: top(b) });
  const dcModel = models.dc && dcDrawing !== "picture" && drawnPoints(dcDrawing, keys);
  const dcCol = col(DC);
  const midCol = col(MID);
  const distCol = col(DIST);
  // the connection point: at the same height in all three Model drawings, so the pipes between them run straight
  const port = portY(dcCol);
  const dcFrom = (x: string, dy: number): [number, Y] => (dcModel ? [dcPortX(dcCol), port] : [R(P[x]), P[x].y + dy]);
  // into the district: its drawing's connection point (Model), else straight on from the unit's row
  // into its drawing at its connection point (Model), else into the block of what the heat distribution delivers
  const intoDistrict: [number, Y] = models.district ? [L(DIST), port] : [L(DIST) + 14, D.met.y];
  const delivered = f.hexOut + f.hpOut + f.tankOut;
  // its parts joined by " · ", each a text of its own for the German (one pattern over all of it put the IT power into the count)
  const pointsSaid = keys.length === 1 ? "1 extraction point" : `${keys.length} extraction points`;
  const dcSub = itKw !== undefined ? `IT ${fmt(itKw, 1)} kW · ${pointsSaid}` : pointsSaid;
  const off = "switched off";
  const wx = (v: number | undefined, d: number, unit: string) => (v === undefined ? "–" : `${fmt(v, d)} ${unit}`);
  const weatherText = `Outdoor ${wx(weather.t, 1, "°C")} · Humidity ${wx(weather.hum, 0, "%")} · Solar ${wx(weather.sun, 0, "W/m²")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="heat-diagram" role="group" aria-label="Heat flow from the data center through the heat distribution to the district heat network">
      {/* the weather all three parts share, above them */}
      {/* a click opens the weather window (onWeather): where it comes from, shifted, generated or from a file */}
      <g
        role={onWeather ? "button" : "img"}
        aria-label={`Weather, shared by all three parts: ${weatherText}`}
        tabIndex={onWeather ? 0 : undefined}
        className={`hf-weather-row${onWeather ? " hf-weather-band" : ""}`}
        onClick={onWeather}
        onKeyDown={(e) => onWeather && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onWeather())}
      >
        {onWeather && <title>Click to define the weather</title>}
        <rect x={M} y={6} width={W - 2 * M} height={30} rx={15} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={M + 20} y={25} className="hf-head">
          WEATHER · {weatherSource ?? "shared"}
        </text>
        <text x={W / 2} y={25} textAnchor="middle" className="hf-weather">
          {weatherText}
        </text>
        {when && (
          <text x={W - M - 20} y={25} textAnchor="end" className="hf-weather">
            {when}
          </text>
        )}
        {[DC.x, MID.x, DIST.x].map((x) => (
          <g key={x}>
            <path d={`M${x},36 V50`} stroke="var(--border-strong)" strokeWidth={1.2} strokeDasharray="3 3" />
            <path d={`M${x - 4},49 L${x + 4},49 L${x},55 Z`} fill="var(--border-strong)" />
          </g>
        ))}
      </g>
      <g transform={`translate(0, ${BAND})`}>
        {/* the columns: a Model's drawing, or the Calculation's parts */}
        {dcModel ? (
          <PartColumn
            part="dc"
            load={loads?.dc}
            col={dcCol}
            h={DC.h}
            tone="var(--hot)"
            title="Data center"
            sub={dcSub}
            drawing={<DcPlant drawing={dcDrawing} at={shown} hallOnWater={cp.dc > 2} />}
          >
            <DcPicks drawing={dcDrawing} keys={keys} at={shown} onPick={onPick} col={dcCol} hallOnWater={cp.dc > 2} />
          </PartColumn>
        ) : (
          <PartColumn part="dc" load={loads?.dc} col={dcCol} h={DC.h} tone="var(--hot)" title="Data center" sub={dcSub} model={models.dc && !!pic}>
            {pic && keys.length > 0 && (
              // its own P&ID (Structure and Modelling's picture), the whole body high, left of the extraction points
              <image
                href={pic}
                x={L(DC) + 10}
                y={BODY - 6}
                width={L(P[keys[0]]) - 10 - (L(DC) + 10)}
                height={SPACE + 10}
                preserveAspectRatio="xMidYMid meet"
                onError={() => setNoPicture(pic)}
              >
                <title>The data center&apos;s P&amp;ID</title>
              </image>
            )}
            <g role="radiogroup" aria-label="Extraction point">
              {keys.map(point)}
            </g>
          </PartColumn>
        )}
        {models.heat ? (
          <PartColumn
            part="heat"
            load={loads?.heat}
            col={midCol}
            h={MID.h}
            tone="var(--heat)"
            title="Heat distribution"
            sub={`${fmt(delivered, 1)} kW delivered · COP ${fmt(f.cop, 1)}`}
            drawing={<HeatDrawing />}
          />
        ) : (
          <PartColumn
            part="heat"
            load={loads?.heat}
            col={midCol}
            h={MID.h}
            tone="var(--heat)"
            title="Heat distribution"
            sub={`${fmt(delivered, 1)} kW delivered · COP ${fmt(f.cop, 1)}`}
          />
        )}
        {models.district ? (
          <PartColumn
            part="district"
            load={loads?.district}
            col={distCol}
            h={DIST.h}
            tone="var(--cool-strong)"
            title="District"
            sub={`${fmt(f.demand, 1)} kW demand · ${fmt(f.coverage)} % met in the window`}
            drawing={<DistrictDrawing />}
          />
        ) : (
          <PartColumn
            part="district"
            load={loads?.district}
            col={distCol}
            h={DIST.h}
            tone="var(--cool-strong)"
            title="District"
            sub={`${fmt(f.demand, 1)} kW demand · ${fmt(f.coverage)} % met in the window`}
          >
            <Row n={D.demand} tone="var(--cool)" title="Heat demand" value={flowLabel(f.demand)} sub="the Site map's heat sinks, on the outdoor temperature" />
            <Row n={D.met} tone="var(--ok)" title="From the heat distribution" value={flowLabel(delivered)} sub={`${fmt(f.coverage)} % met`}>
              <rect x={R(D.met) - 70} y={top(D.met) + 30} width={60} height={5} rx={2.5} fill="var(--surface-2)" />
              <rect x={R(D.met) - 70} y={top(D.met) + 30} width={(60 * covered) / 100} height={5} rx={2.5} fill="var(--ok)" />
            </Row>
            <Row
              n={D.unmet}
              tone="var(--danger)"
              title="Unmet"
              value={flowLabel(Math.max(0, f.demand - delivered))}
              sub="from other heat, e.g. a gas boiler"
              on={f.demand - delivered > 0.05}
            />
          </PartColumn>
        )}

        {/* data center -> heat distribution: to its drawing's edge (Model), else to the heat exchanger and the heat pump */}
        {keys.flatMap((x) => {
          if (x !== at || !loop) {
            if (dcModel) return []; // only the picked point's pipes leave the drawing
            return models.heat
              ? [idle(`${x}-in`, curve(R(P[x]), P[x].y, L(MID), mid(port)))]
              : [idle(`${x}-hex`, curve(R(P[x]), P[x].y - 14, L(N.hex), N.hex.y)), idle(`${x}-hp`, curve(R(P[x]), P[x].y + 14, L(N.hp), N.hp.y))];
          }
          if (models.heat)
            return [pair(`${x}-in`, ...dcFrom(x, 0), L(MID), port, (on.hex ? f.toHex : 0) + (on.hp ? f.toHp : 0), loop.hex, SUPPLY_HOT, "end", cp.dc, dcDerived)];
          return [
            pair(`${x}-hex`, ...dcFrom(x, -14), L(N.hex), N.hex.y, on.hex ? f.toHex : 0, loop.hex, SUPPLY_HOT, "end", cp.dc, dcDerived),
            pair(`${x}-hp`, ...dcFrom(x, 14), L(N.hp), N.hp.y, on.hp ? f.toHp : 0, loop.hp, SUPPLY_HOT, "end", cp.dc, dcDerived),
          ];
        })}

        {/* where the pipes between the parts run, unseen: what "?" › Explain this page shows as the connections (tours.ts) */}
        <g className="hf-links" pointerEvents="none">
          <rect x={R(DC) - 24} y={mid(port) - 70} width={L(MID) - R(DC) + 48} height={140} fill="none" />
          <rect x={R(MID) - 24} y={mid(port) - 70} width={L(DIST) - R(MID) + 48} height={140} fill="none" />
        </g>

        {/* heat distribution -> district: from its drawing's edge (Model), else from each unit */}
        {models.heat ? (
          pair("out-d", R(MID), port, ...intoDistrict, delivered, net, SUPPLY, "end") // its temperatures clear of the label
        ) : (
          <>
            {pair("hex-d", R(N.hex), N.hex.y, ...intoDistrict, f.hexOut, net, SUPPLY, "end")}
            {pair("hp-d", R(N.hp), N.hp.y, ...intoDistrict, f.hpOut, net, SUPPLY, "end")}
            {tankOn && pair("t-d", R(N.tank), N.tank.y, ...intoDistrict, f.tankOut, net, SUPPLY, "end")}

            <Row
              n={N.hex}
              tone="var(--heat-strong)"
              title="Direct heat exchanger"
              value={on.hex ? `${fmt(f.hexOut + f.hexTank, 1)} kW` : "off"}
              sub={!on.hex ? off : opts.physics ? `needs ≥ ${fmt(settings.supplyTemp + opts.approach)} °C source` : `share η ${fmt(opts.eta * 100)} % of the source`}
              on={hexOn}
            />
            <Row
              n={N.hp}
              tone="var(--heat)"
              title="Heat pump"
              value={on.hp ? `${fmt(f.hpOut + f.hpTank, 1)} kW · COP ${fmt(f.cop, 1)}` : "off"}
              sub={!on.hp ? off : opts.physics ? `lift ${fmt(Math.max(0, lift))} K · max ${fmt(opts.hpCapacity)} kW` : `fixed COP · max ${fmt(opts.hpCapacity)} kW`}
              on={hpOn}
            />
            {tankOn ? (
              <Row n={N.tank} tone="var(--cool-strong)" title="Thermal storage" value={`${fmt(f.level)} kWh`} sub={`of ${fmt(opts.tankKwh)} kWh`} on={f.hexTank + f.hpTank + f.tankOut > 0.05}>
                <rect x={R(N.tank) - 70} y={top(N.tank) + 30} width={60} height={5} rx={2.5} fill="var(--surface-2)" />
                <rect x={R(N.tank) - 70} y={top(N.tank) + 30} width={60 * tankFill} height={5} rx={2.5} fill="var(--cool-strong)" />
              </Row>
            ) : (
              <Row n={N.tank} tone="var(--border-strong)" title="Thermal storage" value="off" sub={on.tank ? "0 kWh: set a capacity below" : off} on={false} />
            )}
          </>
        )}
      </g>
    </svg>
  );
}
