/**
 * The built-in P&ID of a liquid-cooled data center (direct-to-chip, W1 as sim_1_water): the rack rows' cold plates on
 * a secondary loop (rack water, blue supply above each row, red return below it) to the CDU, the facility water from
 * the CDU through the liquid cooling HEX to the facility HEX on the tower water and back; the rest of the heat, in the
 * hall air, taken by rear-door heat exchangers on chilled water. Outside the same plant as the air-cooled one: cooling
 * tower, chiller with its condenser HEX, free-cooling plate HEX. No CRAH. Box coordinates match LIQUID_UNITS.
 */
import { HexUnit, Readout, STYLE, type QReadout } from "./DrawnEquipment";
import type { Hex } from "./usePidGraph";

const { hot, cold, eq, label, small } = STYLE;
const thin = { strokeWidth: 1.5, fill: "none" };
const READOUT: Partial<Record<Hex, [number, number, "start" | "middle"]>> = { liquid: [470, 160, "start"], condenser: [1045, 600, "middle"] };

// two rows of seven racks; each row's rack water: supply manifold above, return manifold below, a branch per rack
const ROWS = [230, 370];
const RACKS = [0, 1, 2, 3, 4, 5, 6].map((i) => 140 + (i + 0.5) * (300 / 7));
const SUPPLY = (y: number) => y - 14;
const RETURN = (y: number) => y + 44;

export function DrawnLiquid({
  opacity = 1,
  hex = "liquid",
  readout = null,
  alone = false,
  edge = 1000,
}: {
  opacity?: number;
  hex?: Hex;
  readout?: QReadout | null;
  alone?: boolean; // without the heat distribution's box: where it is drawn itself (Heat Matching)
  edge?: number; // where the waste heat's pipes end (DrawnEquipment)
}) {
  const at = READOUT[hex];
  return (
    <g pointerEvents="none" opacity={opacity}>
      <rect x={40} y={130} width={650} height={420} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
      <text x={52} y={150} style={small}>
        DATA HALL · liquid-cooled (direct-to-chip)
      </text>

      {/* Rack rows with their cold plates: a branch from the supply manifold and one to the return manifold per rack */}
      {ROWS.map((y) => (
        <g key={y}>
          <rect x={140} y={y} width={300} height={30} {...eq} />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <line key={i} x1={140 + (i * 300) / 7} x2={140 + (i * 300) / 7} y1={y} y2={y + 30} stroke="var(--foreground-tertiary)" />
          ))}
          <path d={`M500,${SUPPLY(y)} H150`} {...cold} markerEnd="url(#flow-cold)" />
          <path d={`M150,${RETURN(y)} H500`} {...hot} markerEnd="url(#flow-hot)" />
          {RACKS.map((x) => (
            <g key={x}>
              <path d={`M${x - 4},${SUPPLY(y)} V${y + 8}`} stroke="var(--cool-strong)" {...thin} />
              <path d={`M${x + 4},${y + 22} V${RETURN(y)}`} stroke="var(--hot)" {...thin} />
            </g>
          ))}
        </g>
      ))}
      <text x={140} y={ROWS[0] - 22} style={label}>
        Rack rows · cold plates
      </text>
      <text x={290} y={RETURN(ROWS[1]) + 16} textAnchor="middle" style={small}>
        rack water (secondary loop)
      </text>

      {/* Rear doors on the hot-aisle side: they take the heat left in the air, on chilled water */}
      <rect x={140} y={260} width={300} height={6} fill="color-mix(in srgb, var(--cool-strong) 25%, var(--surface))" stroke="var(--cool-strong)" />
      <rect x={140} y={364} width={300} height={6} fill="color-mix(in srgb, var(--cool-strong) 25%, var(--surface))" stroke="var(--cool-strong)" />
      <text x={44} y={310} style={{ ...small, fill: "var(--cool-strong)" }}>
        rear-door
      </text>
      <text x={44} y={323} style={{ ...small, fill: "var(--cool-strong)" }}>
        HX
      </text>
      <path d="M760,510 H96 V262 H140 M96,368 H140" {...cold} />
      <path d="M140,367 H110 M140,264 H110 V530 H760" {...hot} markerEnd="url(#flow-hot)" />
      <text x={600} y={505} style={{ ...small, fill: "var(--cool-strong)" }}>
        chilled water
      </text>
      <text x={600} y={545} style={{ ...small, fill: "var(--hot)" }}>
        warm water
      </text>

      {/* CDU: the plate HEX between the rack water and the facility water, with its pump */}
      <rect x={500} y={205} width={90} height={235} {...eq} />
      <text x={545} y={300} textAnchor="middle" style={label}>
        CDU
      </text>
      <text x={545} y={314} textAnchor="middle" style={small}>
        coolant
      </text>
      <text x={545} y={327} textAnchor="middle" style={small}>
        distribution
      </text>
      <path d="M520,360 l8,-14 l8,14 l8,-14 l8,14 l8,-14 l8,14" fill="none" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <circle cx={545} cy={415} r={11} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M539,420 L545,408 L551,420 Z" fill="var(--foreground-secondary)" />

      {/* Facility water: about 50 °C from the CDU through the liquid cooling HEX to the facility HEX on the tower water,
          40 °C back (free cooling all year: it is warmer than the tower water) */}
      <path d="M590,280 H880" {...hot} markerEnd="url(#flow-hot)" />
      <path d="M890,298 V390 H590" {...cold} markerEnd="url(#flow-cold)" />
      <text x={600} y={407} style={{ ...small, fill: "var(--cool-strong)" }}>
        facility water · 40–45 °C
      </text>
      <rect x={880} y={262} width={40} height={36} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={2} />
      <path d="M887,267 v26 M894,267 v26 M901,267 v26 M908,267 v26 M915,267 v26" stroke="var(--foreground-secondary)" strokeWidth={1.2} />
      <text x={900} y={254} textAnchor="middle" style={label}>
        Facility HEX
      </text>

      {/* Tower water, shared: it cools the facility water, the chilled water (free cooling) and the chiller's condenser */}
      <path d="M920,272 H950 V495" {...hot} />
      <path d="M940,535 V290 H920" {...cold} markerEnd="url(#flow-cold)" />
      <path d="M705,470 V448 H950" {...hot} />
      <path d="M940,460 H735 V470" {...cold} markerEnd="url(#flow-cold)" />

      {/* Free cooling: the rear doors' chilled water through a plate HEX on the tower water, the chiller only trims */}
      <path d="M705,530 V494" {...hot} />
      <path d="M735,494 V510" {...cold} markerEnd="url(#flow-cold)" />
      <rect x={700} y={470} width={40} height={24} fill="var(--surface)" stroke="var(--cool-strong)" strokeWidth={2} />
      <path d="M708,474 v16 M714,474 v16 M720,474 v16 M726,474 v16 M732,474 v16" stroke="var(--cool-strong)" strokeWidth={1.2} />
      <text x={695} y={486} textAnchor="end" style={{ ...label, fill: "var(--cool-strong)" }}>
        Free cooling HEX
      </text>

      {/* Chiller of the rear doors' chilled water, its condenser water past the condenser HEX to the tower */}
      <rect x={760} y={470} width={90} height={90} {...eq} />
      <rect x={768} y={480} width={12} height={70} fill="none" stroke="var(--cool-strong)" strokeWidth={1.5} />
      <rect x={830} y={480} width={12} height={70} fill="none" stroke="var(--hot)" strokeWidth={1.5} />
      <circle cx={805} cy={490} r={9} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M800,495 L805,484 L810,495 Z" fill="var(--foreground-secondary)" />
      <text x={805} y={576} textAnchor="middle" style={label}>
        Chiller
      </text>
      <path d="M850,495 H961" {...hot} markerEnd="url(#flow-hot)" />
      <path d="M966,535 H850" {...cold} markerEnd="url(#flow-cold)" />

      {/* Cooling tower: the one outdoor unit, as on the air-cooled data center */}
      <path d="M962,550 L975,484 H1025 L1038,550 Z" fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={2} />
      <path d="M988,484 V474 H1012 V484" fill="none" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <ellipse cx={1000} cy={474} rx={16} ry={4} fill="var(--surface)" stroke="var(--foreground-secondary)" strokeWidth={1.5} />
      <path d="M985,500 v12 M1000,500 v12 M1015,500 v12" stroke="var(--cool-strong)" strokeWidth={1.2} strokeDasharray="2 3" />
      <text x={1000} y={568} textAnchor="middle" style={label}>
        Cooling tower
      </text>

      {/* Heat recovery: the liquid cooling HEX on the facility water (direct water, hot) or the condenser HEX */}
      <HexUnit
        edge={edge}
        x={700}
        y={268}
        on={hex === "liquid"}
        label="Liquid cooling HEX"
        labelAt={[835, 306, "end"]}
        out="M720,268 V200 H1000"
        back="M1000,240 H730 V268"
        outLabel={[860, 192]}
      />
      <HexUnit
        edge={edge}
        x={880}
        y={483}
        on={hex === "condenser"}
        label="Condenser HEX"
        labelAt={[900, 523, "middle"]}
        out="M900,483 V470 H975 V200 H1000"
        back="M1000,240 H988 V478 H910 V483"
        outLabel={[985, 330]}
      />
      {readout && at && <Readout at={at} r={readout} />}

      {/* the heat distribution, where the waste heat leaves */}
      {/* the heat distribution's box, the weather's above it (ConnectionPoints.tsx WeatherBox), as on every structure */}
      {!alone && (
        <>
          <rect
            x={1000}
            y={116}
            width={96}
            height={184}
            rx={8}
            fill="var(--surface-2)"
            stroke="var(--foreground-tertiary)"
            strokeDasharray="6 4"
            opacity={0.9}
          />
          <text x={1048} y={136} textAnchor="middle" style={label}>
            Heat
          </text>
          <text x={1048} y={151} textAnchor="middle" style={label}>
            distribution
          </text>
        </>
      )}
    </g>
  );
}
