/**
 * The district's built-in drawing, in the structure page's W × H frame (units in districtLayout.ts): the heat distribution as a grey box on the left, its supply (red) and return (blue) past the
 * buildings, open at the right: the network goes on to more buildings. Their heat demand (Q_houses) sits on the supply
 * where it leaves the heat distribution: what the district asks of it.
 */

const label = { font: "600 13px sans-serif", fill: "var(--foreground)" };
const small = { font: "11px sans-serif", fill: "var(--foreground-secondary)" };
const eq = { stroke: "var(--foreground-secondary)", strokeWidth: 2, fill: "var(--surface)" };
/** Blocks of flats and offices: left edge and height, standing on one ground line, 80 wide. */
const BUILDINGS: [number, number][] = [
  [520, 95],
  [630, 130],
  [740, 75],
  [850, 115],
];
const GROUND = 440;
const SUPPLY = 200; // the connection point's heights, as on every structure (PORT_Y, datacenter/structure/connection.ts)
const RETURN = 240;
const LAST = 950; // just past the last building: from here the pipes go on (dashed) to more buildings
const WIDE = 80;

/** `framed`: inside the district's own box (the new form), the heat distribution on its left margin (ConnectionPoints):
 * its box left out, the water from the box's edge (x 0) at the connection point. */
export function DistrictDrawing({ opacity = 1, framed = false }: { opacity?: number; framed?: boolean }) {
  const from = framed ? 0 : 200;
  return (
    <g pointerEvents="none" opacity={opacity}>
      {/* the heat distribution: the neighbour this district connects to */}
      {!framed && (
        <>
          <rect x={40} y={150} width={160} height={380} rx={8} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
          <text x={120} y={335} textAnchor="middle" style={label}>
            Heat distribution
          </text>
          <text x={120} y={351} textAnchor="middle" style={small}>
            its own structure
          </text>
        </>
      )}

      {/* the district heating water, open at the right: it goes on to more buildings */}
      <path d={`M${from} ${SUPPLY} H${LAST}`} stroke="var(--hot)" strokeWidth={3} fill="none" />
      <path d={`M${LAST} ${SUPPLY} h60`} stroke="var(--hot)" strokeWidth={3} strokeDasharray="6 6" fill="none" />
      <path d={`M${from} ${RETURN} H${LAST}`} stroke="var(--cool-strong)" strokeWidth={3} fill="none" />
      <path d={`M${LAST} ${RETURN} h60`} stroke="var(--cool-strong)" strokeWidth={3} strokeDasharray="6 6" fill="none" />
      <text x={LAST + 66} y={SUPPLY + 4} style={small}>
        supply
      </text>
      <text x={LAST + 66} y={RETURN + 4} style={small}>
        return
      </text>

      {/* the buildings, each on the supply and the return: flat roofs, a grid of windows, a door */}
      {BUILDINGS.map(([x, h]) => (
        <g key={x}>
          <rect x={x} y={GROUND - h} width={WIDE} height={h} {...eq} />
          {Array.from({ length: Math.floor((h - 30) / 20) }, (_, row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={x + 12 + col * 22}
                y={GROUND - h + 10 + row * 20}
                width={12}
                height={10}
                fill="var(--surface-2)"
                stroke="var(--foreground-tertiary)"
              />
            )),
          )}
          <rect x={x + 32} y={GROUND - 18} width={16} height={18} fill="var(--surface-2)" stroke="var(--foreground-secondary)" />
          <path d={`M${x + 18} ${GROUND - h} V${SUPPLY} M${x + 62} ${GROUND - h} V${RETURN}`} stroke="var(--foreground-tertiary)" strokeWidth={1.5} />
        </g>
      ))}
      <text x={730} y={GROUND + 22} textAnchor="middle" style={label}>
        Buildings
      </text>
    </g>
  );
}
