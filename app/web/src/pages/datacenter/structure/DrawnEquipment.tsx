/**
 * The built-in P&ID of an air-cooled data center (simulation datasets; a liquid-cooled one: DrawnLiquid): rows of racks with hot and cold aisles and
 * the CRAH in the data hall (air only, no pipes inside the hall), the water pipes from the CRAH to the chiller
 * outside, the condenser water to the cooling tower, the weather, and the two candidate heat-recovery exchangers.
 * Box coordinates match UNITS in geometry.ts (sensor taps).
 */
import { fmt } from "../../../lib/format";
import type { Hex } from "./usePidGraph";

/** The selected HEX's heat: a calculated column (dataset.json "derived"), not an instrument. */
export interface QReadout {
  name: string;
  cp: number; // kJ/(kg·K)
  mean: number | null; // kW over the data, null while loading
}

/** Where the read-out sits (x, first baseline, anchor), clear of instruments and taps: hall, above the waste-heat line
 * where it leaves the HEX; condenser, under the HEX label, between the taps of the flow and outlet instruments. */
const READOUT: Partial<Record<Hex, [number, number, "start" | "middle"]>> = { hall: [596, 80, "start"], condenser: [900, 398, "middle"] };
const READOUT_HALL_WATER: [number, number, "start"] = [680, 80, "start"];

const pipe = { strokeWidth: 3, fill: "none", strokeLinejoin: "miter" as const };
const hot = { ...pipe, stroke: "var(--hot)" };
const cold = { ...pipe, stroke: "var(--cool-strong)" };
// air moves through the room, not through a pipe: thin and dashed
const air = { strokeWidth: 1.5, fill: "none", strokeDasharray: "5 4" };
const hotAir = { ...air, stroke: "var(--hot)" };
const coldAir = { ...air, stroke: "var(--cool-strong)" };
const eq = { stroke: "var(--foreground-secondary)", strokeWidth: 2, fill: "var(--surface)" };
const label = { font: "600 12px sans-serif", fill: "var(--foreground)" } as const;
const small = { font: "11px sans-serif", fill: "var(--foreground-secondary)" } as const;
/** The looks shared with the liquid-cooled drawing (DrawnLiquid). */
export const STYLE = { hot, cold, eq, label, small };

// Rack rows run toward the CRAH (aisles perpendicular to it): cold aisles outside, a shared hot aisle between them.
const ROWS = [270, 350]; // y of each rack row (x 140..440, 30 high, seven racks each)
const AISLES: [number, "cold" | "hot"][] = [
  [245, "cold"],
  [325, "hot"],
  [405, "cold"],
];

export function DrawnEquipment({
  opacity = 1,
  hex = "condenser",
  readout = null,
  freeCooling = false,
  hallOnWater = false,
  alone = false,
  edge = 1000,
  condenser = true,
}: {
  opacity?: number;
  hex?: Hex;
  readout?: QReadout | null;
  freeCooling?: boolean; // the plate HEX that lets the tower cool the chilled water, the chiller bypassed (A1)
  hallOnWater?: boolean; // the hall HEX on the chilled-water return (water side, ahead of the free cooling and the chiller), not in the warm air
  alone?: boolean; // without the heat distribution's box: where it is drawn itself (Heat Matching)
  edge?: number; // where the waste heat's pipes end: the heat distribution's box, or the data center's own (its frame)
  condenser?: boolean; // the condenser HEX, the other extraction point: not drawn where the data has none
}) {
  return (
    <g pointerEvents="none" opacity={opacity}>
      {/* Areas */}
      <rect x={40} y={130} width={650} height={420} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
      <text x={52} y={150} style={small}>DATA HALL · air-cooled</text>

      {/* Rack rows between cold and hot aisles */}
      {ROWS.map((y) => (
        <g key={y}>
          <rect x={140} y={y} width={300} height={30} {...eq} />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <line key={i} x1={140 + (i * 300) / 7} x2={140 + (i * 300) / 7} y1={y} y2={y + 30} stroke="var(--foreground-tertiary)" />
          ))}
        </g>
      ))}
      <text x={140} y={264} style={label}>Rack rows</text>
      {AISLES.map(([y, kind]) => (
        <text key={y} x={380} y={y + 4} textAnchor="middle" style={{ ...small, fill: kind === "hot" ? "var(--hot)" : "var(--cool-strong)" }}>
          {kind} aisle
        </text>
      ))}

      {/* CRAH at the end of the rows */}
      <rect x={520} y={200} width={110} height={280} {...eq} />
      <text x={575} y={222} textAnchor="middle" style={label}>CRAH</text>
      <text x={575} y={237} textAnchor="middle" style={small}>cooling unit</text>
      <path d="M545,320 l18,18 l-18,18 M570,320 l18,18 l-18,18 M595,320 l18,18 l-18,18" stroke="var(--foreground-secondary)" fill="none" />

      {/* Air only where it meets the CRAH: warm room air in at the top (through the hall HEX), cold air out at the
          bottom into the floor. No ducts in the hall. */}
      <path d="M575,174 V200" {...hotAir} markerEnd="url(#flow-hot)" />
      <path d="M575,480 V515" {...coldAir} markerEnd="url(#flow-cold)" />
      <text x={585} y={512} style={{ ...small, fill: "var(--cool-strong)" }}>cold air out (floor)</text>

      {/* Water: the only pipes, from the CRAH to the chiller outside the hall (the hall HEX, on the water side or in
          the air, only feeds the heat distribution: no pipe of its own to the chiller) */}
      <path d="M630,300 H760" {...hot} markerEnd="url(#flow-hot)" />
      <path d="M760,350 H630" {...cold} markerEnd="url(#flow-cold)" />
      <text x={694} y={292} style={{ ...small, fill: "var(--hot)" }}>warm water</text>
      <text x={694} y={368} style={{ ...small, fill: "var(--cool-strong)" }}>chilled water</text>

      {/* Chiller: the refrigeration cycle. Evaporator (chilled water side, left), compressor (top), condenser
          (condenser water side, right), expansion valve (bottom). */}
      <rect x={760} y={280} width={90} height={90} {...eq} />
      <rect x={768} y={290} width={12} height={70} fill="none" stroke="var(--cool-strong)" strokeWidth={1.5} />
      <rect x={830} y={290} width={12} height={70} fill="none" stroke="var(--hot)" strokeWidth={1.5} />
      <circle cx={805} cy={300} r={9} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M800,305 L805,294 L810,305 Z" fill="var(--foreground-secondary)" />
      <path d="M797,345 V355 L813,345 V355 Z" fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M780,300 H796 M814,300 H830 M780,350 H797 M813,350 H830" stroke="var(--foreground-secondary)" strokeWidth={1.2} fill="none" />
      <text x={805} y={386} textAnchor="middle" style={label}>Chiller</text>

      {/* Condenser water: hot from the chiller through the condenser HEX to the tower, cooled back to the chiller */}
      <path d="M850,320 H971" {...hot} markerEnd="url(#flow-hot)" />
      <path d="M966,352 H850" {...cold} markerEnd="url(#flow-cold)" />

      {/* Cooling tower: tapered body, fan on top, water spray inside, air inlets at the bottom */}
      <path d="M962,362 L975,296 H1025 L1038,362 Z" fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={2} />
      <path d="M988,296 V286 H1012 V296" fill="none" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <ellipse cx={1000} cy={286} rx={16} ry={4} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M985,312 v12 M1000,312 v12 M1015,312 v12" stroke="var(--cool-strong)" strokeWidth={1.2} strokeDasharray="2 3" />
      <path d="M970,340 l8,8 M1030,340 l-8,8 M967,350 l8,8 M1033,350 l-8,8" stroke="var(--foreground-tertiary)" strokeWidth={1.2} />
      <text x={1000} y={380} textAnchor="middle" style={label}>Cooling tower</text>

      {/* Heat recovery: two candidate heat exchangers, one selected */}
      {/* labels clear of pipes, air arrows and taps: the hall's above-left of it (the warm-air arrow runs below it, the
          flow tap onto its top), the condenser's under the cold pipe (taps from below reach the HEX without crossing it) */}
      {hallOnWater ? (
        <HexUnit edge={edge} x={555} y={150} on={hex === "hall"} label="Hall HEX" labelAt={[550, 146, "end"]} out="M575,150 V118 H985 V200 H1000" back="M1000,240 H970 V132 H585 V150" outLabel={[790, 110]} />
      ) : (
        <HexUnit edge={edge} x={555} y={150} on={hex === "hall"} label="Hall HEX" labelAt={[550, 146, "end"]} out="M575,150 V118 H985 V200 H1000" back="M1000,240 H970 V132 H585 V150" outLabel={[720, 110]} />
      )}
      {condenser && <HexUnit edge={edge} x={880} y={308} on={hex === "condenser"} label="Condenser HEX" labelAt={[900, 378, "middle"]} out="M915,308 V200 H1000" back="M1000,240 H905 V308" outLabel={[930, 192]} />}
      {readout && READOUT[hex] && <Readout at={hallOnWater && hex === "hall" ? READOUT_HALL_WATER : READOUT[hex]} r={readout} />}

      {freeCooling && <FreeCooling />}

      {/* the heat distribution, where the waste heat leaves: the neighbour, its own structure */}
      {/* the heat distribution's box, the weather's above it (ConnectionPoints.tsx WeatherBox), as on every structure */}
      {!alone && (
        <>
          <rect x={1000} y={116} width={96} height={184} rx={8} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" opacity={0.9} />
          <text x={1048} y={136} textAnchor="middle" style={label}>Heat</text>
          <text x={1048} y={151} textAnchor="middle" style={label}>distribution</text>
        </>
      )}
    </g>
  );
}

/** Free cooling (waterside economiser): a plate HEX outside the hall between the chilled water (a bypass of the chiller:
 * the warm return in, the cooled water back) and the tower water (from the tower's cold side, back to its inlet). When
 * the wet bulb is low enough it takes the load and the chiller only trims, or stops. Ports match UNITS phe. */
function FreeCooling() {
  return (
    <g>
      <path d="M705,300 V470" {...hot} />
      <path d="M735,470 V350" {...cold} markerEnd="url(#flow-cold)" />
      <path d="M940,352 V510 H735 V494" {...cold} />
      <path d="M705,494 V525 H950 V320" {...hot} markerEnd="url(#flow-hot)" />
      <rect x={700} y={470} width={40} height={24} fill="var(--surface)" stroke="var(--cool-strong)" strokeWidth={2} />
      <path d="M708,474 v16 M714,474 v16 M720,474 v16 M726,474 v16 M732,474 v16" stroke="var(--cool-strong)" strokeWidth={1.2} />
      <text x={750} y={486} style={{ ...label, fill: "var(--cool-strong)" }}>
        Free cooling HEX
      </text>
      <text x={750} y={500} style={small}>
        plate HEX: tower water cools the chilled water
      </text>
    </g>
  );
}

/** "Q = ṁ·cₚ·ΔT", its mean and cₚ: the heat the selected HEX recovers, calculated from its three instruments. */
export function Readout({ at: [x, y, anchor], r }: { at: [number, number, "start" | "middle"]; r: QReadout }) {
  const mean = r.mean !== null && Number.isFinite(r.mean) ? `mean ${fmt(r.mean, 1)} kW` : "mean …";
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{ font: "10px sans-serif", fill: "var(--foreground-secondary)" }}
      aria-label={`${r.name} = m · cp · (T_in − T_out), calculated, ${mean}, cp ${r.cp} kJ/(kg·K)`}
    >
      <tspan style={{ font: "600 11px sans-serif", fill: "var(--heat-strong)" }}>Q = ṁ·cₚ·ΔT</tspan>
      <tspan x={x} dy={13}>
        {mean}
      </tspan>
      <tspan x={x} dy={13} style={{ fontStyle: "italic" }}>
        calculated · cₚ {r.cp}
      </tspan>
    </text>
  );
}

/** A heat exchanger; the selected one is highlighted and sends its waste heat on to Heat Distribution: the supply
 * (`out`, hot) and the return (`back`, cool) to the heat distribution's box, its connection point, at the height every
 * structure has it (PORT_Y, connection.ts). */
export function HexUnit({
  edge = 1000,
  x,
  y,
  on,
  label,
  labelAt,
  out,
  back,
  outLabel,
}: {
  edge?: number; // the pipes' end (drawn to x 1000, the heat distribution's box)
  x: number;
  y: number;
  on: boolean;
  label: string;
  labelAt: [number, number, "middle" | "end"]; // x, baseline, anchor
  out: string;
  back: string;
  outLabel: [number, number];
}) {
  const tone = on ? "var(--heat-strong)" : "var(--foreground-tertiary)";
  return (
    <g opacity={on ? 1 : 0.55}>
      <rect x={x} y={y} width={40} height={24} fill={on ? "color-mix(in srgb, var(--heat-strong) 12%, var(--surface))" : "var(--surface)"} stroke={tone} strokeWidth={2} strokeDasharray={on ? undefined : "4 3"} />
      <path d={`M${x + 6},${y + 18} l7,-12 l7,12 l7,-12 l7,12`} fill="none" stroke={tone} strokeWidth={1.5} />
      <text
        x={labelAt[0]}
        y={labelAt[1]}
        textAnchor={labelAt[2]}
        style={{ font: "600 10px sans-serif", fill: on ? "var(--heat-strong)" : "var(--foreground-secondary)" }}
      >
        {label}
      </text>
      {on && (
        <>
          <path d={out.replace(/H1000$/, `H${edge}`)} stroke="var(--hot)" strokeWidth={3} fill="none" markerEnd="url(#flow-hot)" />
          <path d={back.replace(/^M1000,/, `M${edge},`)} stroke="var(--cool-strong)" strokeWidth={3} fill="none" markerEnd="url(#flow-cold)" />
          <text x={outLabel[0]} y={outLabel[1]} style={{ font: "11px sans-serif", fill: "var(--heat-strong)" }}>
            waste heat →
          </text>
        </>
      )}
    </g>
  );
}
