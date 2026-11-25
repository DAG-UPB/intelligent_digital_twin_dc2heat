/**
 * The heat distribution's built-in drawing, in the structure page's W × H frame (units in heatLayout.ts): the data
 * center's water reaches the heat exchanger and the heat pump in parallel (two equal boxes in one column), through a
 * supply and a return header; their district-side water meets in two more headers, fills the storage tank from
 * the top, the tank feeds the district, and the district's return comes back through the tank's bottom. Hand valves
 * (no actuator) on each branch and the tank's outlet. Hot pipes red, cold ones blue.
 */
import { W } from "../../datacenter/structure/geometry";

const pipe = { strokeWidth: 3, fill: "none", strokeLinejoin: "miter" as const };
const hot = { ...pipe, stroke: "var(--hot)" };
const cold = { ...pipe, stroke: "var(--cool-strong)" };
const eq = { stroke: "var(--foreground-secondary)", strokeWidth: 2, fill: "var(--surface)" };
const label = { font: "600 13px sans-serif", fill: "var(--foreground)" };
const small = { font: "11px sans-serif", fill: "var(--foreground-secondary)" };

/** Where the valves sit on the pipes: each parallel branch on both sides, and the tank's outlet to the district. */
const VALVES: [number, number][] = [
  [370, 150],
  [370, 360],
  [620, 150],
  [575, 360],
  [920, 190],
];

/** A hand valve on a horizontal pipe at (x, y): two triangles and a hand wheel, no actuator. */
const Valve = ({ x, y }: { x: number; y: number }) => (
  <g>
    <path d={`M${x - 11} ${y - 8} L${x + 11} ${y + 8} V${y - 8} L${x - 11} ${y + 8} Z`} {...eq} strokeWidth={1.5} />
    <path d={`M${x} ${y} V${y - 15} M${x - 7} ${y - 15} H${x + 7}`} stroke="var(--foreground-secondary)" strokeWidth={1.5} />
  </g>
);

/** `framed`: inside the heat distribution's own box (the new form), the data center and the district on its margins
 * (ConnectionPoints): their boxes left out, the water piped to the box's edges (x 0 and W) at the connection points. */
export function HeatDrawing({ opacity = 1, framed = false }: { opacity?: number; framed?: boolean }) {
  return (
    <g pointerEvents="none" opacity={opacity}>
      <g transform="translate(0 50)">
        {/* the data center: the heat source */}
        {framed ? (
          <>
            <path d="M0 150 H180" {...hot} />
            <path d="M180 190 H0" {...cold} />
          </>
        ) : (
          <>
            <rect x={40} y={110} width={140} height={360} rx={8} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
            <text x={110} y={305} textAnchor="middle" style={label}>
              Data center
            </text>
            <text x={110} y={321} textAnchor="middle" style={small}>
              heat source
            </text>
          </>
        )}

        {/* its water, to both units in parallel: supply header (red), return header (blue) */}
        <path d="M180 150 H290 M290 150 V360 M290 150 H400 M290 360 H400" {...hot} />
        <path d="M400 210 H260 M400 440 H260 M260 190 V440 M260 190 H180" {...cold} />

        {/* the heat exchanger */}
        <rect x={400} y={130} width={140} height={100} rx={6} {...eq} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${420 + i * 20} 140 V220`} stroke="var(--border-strong)" strokeWidth={2} />
        ))}
        <text x={470} y={246} textAnchor="middle" style={label}>
          Heat exchanger
        </text>

        {/* the heat pump, the same size beside it: evaporator (data-center side), compressor, condenser (district side) */}
        <rect x={400} y={340} width={140} height={120} rx={6} {...eq} />
        <rect x={410} y={355} width={30} height={90} rx={3} {...eq} />
        <rect x={500} y={355} width={30} height={90} rx={3} {...eq} />
        <path d="M440 375 H458 M482 375 H500 M500 430 H479 M461 430 H440" stroke="var(--foreground-secondary)" strokeWidth={1.5} fill="none" />
        <circle cx={470} cy={375} r={12} {...eq} />
        <path d="M461 424 L479 436 V424 L461 436 Z" {...eq} strokeWidth={1.5} />
        <text x={470} y={476} textAnchor="middle" style={label}>
          Heat pump
        </text>
        <text x={470} y={492} textAnchor="middle" style={small}>
          evaporator · compressor · condenser
        </text>

        {/* the district's water: supply header into the tank's top, return header from its bottom */}
        <path d="M540 150 H650 M540 360 H650 M650 150 V360 M650 190 H770" {...hot} />
        <path d="M770 380 H680 M680 210 V440 M680 210 H540 M680 440 H540" {...cold} />

        {/* the storage tank: hot at the top, cold at the bottom */}
        <defs>
          <linearGradient id="heat-tank" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--hot)" stopOpacity={0.3} />
            <stop offset="1" stopColor="var(--cool-strong)" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <rect x={770} y={150} width={80} height={260} rx={30} stroke="var(--foreground-secondary)" strokeWidth={2} fill="url(#heat-tank)" />
        <text x={810} y={430} textAnchor="middle" style={label}>
          Storage tank
        </text>

        {/* the district: supply from the tank's top, return into its bottom */}
        <path d="M850 165 H880 V150 H940" {...hot} />
        <path d="M940 190 H900 V380 H850" {...cold} />
        {framed ? (
          <>
            <path d={`M940 150 H${W}`} {...hot} />
            <path d={`M${W} 190 H940`} {...cold} />
          </>
        ) : (
          <>
            <rect x={940} y={110} width={140} height={360} rx={8} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
            <text x={1010} y={305} textAnchor="middle" style={label}>
              District heat
            </text>
            <text x={1010} y={321} textAnchor="middle" style={small}>
              demand
            </text>
          </>
        )}

        {/* hand valves, no actuator: each branch on both sides, the tank's outlet */}
        {VALVES.map(([x, y]) => (
          <Valve key={`${x},${y}`} x={x} y={y} />
        ))}
      </g>
    </g>
  );
}
