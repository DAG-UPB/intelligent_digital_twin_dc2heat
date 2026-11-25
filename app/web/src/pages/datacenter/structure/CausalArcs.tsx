/**
 * Causal links drawn over the P&ID: arcs in the colour of the variable they point to (its approach, roles.ts), as wide as the link is strong (partial correlation) with a small arrowhead (never P&ID-like right angles),
 * lag labels at their middle, wide invisible copies to click, and a ring around each receiving instrument.
 * `t` (0..1) fades them in; with a selection, everything not linked to it fades back.
 */
import { arcMid, arcPath, type DrawnArc, type XY } from "./geometry";
import { roleColor, wayOf, type Roles } from "./roles";

interface Props {
  arcs: DrawnArc[];
  receivers: string[];
  at: Record<string, XY>;
  radius: (v: string) => number; // a bubble's drawn radius (its size): the ring sits just outside it
  t: number;
  selVar: string | null;
  selLink: string | null;
  noEvidence: Set<string>;
  roles: Roles;
  width: (key: string) => number; // from the link strength (links.ts linkWidths)
  onSelectLink: (key: string) => void;
}

export function CausalArcs({ arcs, receivers, at, radius, t, selVar, selLink, noEvidence, roles, width, onSelectLink }: Props) {
  const colorOf = (v: string) => roleColor(roles, v);
  const hot = (a: DrawnArc) => a.key === selLink || (!!selVar && (a.link.from === selVar || a.link.to === selVar));
  const anyFocus = !!(selVar || selLink);
  const fade = (on: boolean) => (on ? 1 : (anyFocus ? 0.12 : 0.95) * t);
  const selTarget = arcs.find((a) => a.key === selLink)?.link.to;

  return (
    <>
      {arcs.map((a) => {
        const on = hot(a);
        const sel = a.key === selLink;
        return (
          <path
            key={`l${a.key}`}
            d={arcPath(a.pts)}
            stroke={colorOf(a.link.to)}
            strokeWidth={width(a.key) + (sel ? 0.8 : 0)}
            strokeOpacity={on ? 1 : 0.8}
            strokeDasharray={noEvidence.has(a.key) ? "5 4" : undefined}
            strokeLinecap="round"
            fill="none"
            markerEnd={`url(#way-${wayOf(roles, a.link.to)})`}
            opacity={fade(on)}
            pointerEvents="none"
          />
        );
      })}
      {/* lags at each arc's middle: on every arc once the graph shows, or only on the selected ones */}
      {arcs
        .filter((a) => hot(a) || (!anyFocus && t > 0.4))
        .map((a) => {
          const [mx, my] = arcMid(a.pts);
          const sel = a.key === selLink;
          return (
            <text
              key={`lbl${a.key}`}
              x={mx}
              y={my + 3}
              textAnchor="middle"
              pointerEvents="none"
              className="pid-halo"
              opacity={anyFocus ? 1 : Math.min(1, (t - 0.4) / 0.3)}
              style={{ font: `${sel ? 700 : 600} ${sel ? 11 : anyFocus ? 10 : 9}px sans-serif`, fill: colorOf(a.link.to) }}
            >
              {a.link.lags.join(",")}
            </text>
          );
        })}
      {/* invisible wide copies: click a line to edit that link */}
      {arcs.map((a) => (
        <path
          key={`c${a.key}`}
          d={arcPath(a.pts)}
          stroke="transparent"
          strokeWidth={8}
          fill="none"
          style={{ cursor: "pointer" }}
          pointerEvents={t > 0.1 ? "stroke" : "none"}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelectLink(a.key);
          }}
        />
      ))}
      {/* ring: the colour of the arrows coming into this instrument (its own) */}
      {receivers.map((v) => (
        <circle
          key={`ring${v}`}
          cx={at[v].x}
          cy={at[v].y}
          r={radius(v) + 3.5}
          fill="none"
          stroke={colorOf(v)}
          strokeWidth={1.5}
          strokeOpacity={selVar === v ? 1 : 0.45}
          opacity={Math.max(t, selVar === v || selTarget === v ? 1 : 0)}
          pointerEvents="none"
        />
      ))}
    </>
  );
}
