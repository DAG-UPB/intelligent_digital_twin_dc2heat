/**
 * One variable drawn as a plain circle (an abstraction, not a P&ID instrument bubble): its tag in the middle, "↻n"
 * (own past, n hours) under the tag, the name under the circle; the circle coloured by how Modelling makes it (roles.ts). Actuators sit in a square; variables without data get a dashed square / "no data";
 * prepared variables (made on the Dashboard, kept in silver) are marked "new · prepared". A long name is drawn as its
 * short label (shown.ts; the full name above it while the pointer rests on it, and in the Variables menu), at the
 * size the menu sets. What it is (a kind: sensor, setpoint, ...) is in its hover text only, how sure that is a
 * coloured ring (notes.ts); one in a multi-selection gets a dashed ring. A group (a variable marked as standing for
 * several) is drawn as a stack of circles, "mean of n" under its name.
 */
import type { PointerEvent } from "react";
import type { PidNote } from "../../../api";
import { R } from "./geometry";
import type { Spot } from "./layout";
import { CONFIDENCE, KINDS } from "./notes";
import { roleColor, SELECTED_FILL, tint, type Roles } from "./roles";

interface Props {
  v: string;
  p: Spot;
  selected: boolean;
  selfLags: number[] | undefined;
  roles: Roles;
  linking: boolean;
  nameAbove?: boolean; // the sensor tap runs down through the name's usual spot
  label?: string; // drawn instead of a long name
  size?: number; // scale of the bubble around its centre (1: R)
  note?: PidNote; // what it is and how sure (notes.ts)
  multi?: boolean; // in the multi-selection (a dragged box, shift-click)
  fullName?: string; // shown while the pointer rests on it (the name shown and its own)
  kpi?: string; // its part in the KPIs, while the KPI variables are shown (modelling/kpiVariables.ts kpiUses)
  onPointerDown: (v: string, e: PointerEvent) => void;
}

/** A small line under the name stays readable over a line it crosses (the arrows into an empty structure's box). */
const CLEAR = { paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3, strokeLinejoin: "round" } as const;

export function Instrument({ v, p, selected, selfLags, roles, linking, nameAbove, label, size = 1, note, multi, fullName, kpi, onPointerDown }: Props) {
  const act = roles.actuators.has(v);
  const noData = roles.noData(v);
  const color = roleColor(roles, v);
  const kind = note?.kind ? KINDS[note.kind] : null;
  const sure = note?.confidence ? CONFIDENCE[note.confidence] : null;
  const group = note?.group;
  const about = [fullName ?? v, group && `group: ${group.method} of ${group.members.join(", ")}`, kind?.label, sure && `${sure.label}`, kpi, note?.note]
    .filter(Boolean)
    .join(" · ");
  return (
    <g className="pid-inst" style={{ cursor: linking ? "crosshair" : "grab" }} onPointerDown={(e) => onPointerDown(v, e)}>
      <title>{about}</title>
      <g transform={size === 1 ? undefined : `translate(${p.x} ${p.y}) scale(${size}) translate(${-p.x} ${-p.y})`}>
        {/* a KPI variable: a halo behind it, not a ring through its name */}
        {kpi && <circle cx={p.x} cy={p.y} r={R + 9} fill="var(--accent)" opacity={0.22} />}
        {act && (
          <rect
            x={p.x - R}
            y={p.y - R}
            width={2 * R}
            height={2 * R}
            fill={selected ? SELECTED_FILL : tint(color)}
            stroke={color}
            strokeWidth={selected ? 2.5 : 2}
            strokeDasharray={noData ? "4 3" : undefined}
          />
        )}
        {group && (
          <g>
            {[8, 4].map((d) => (
              <circle key={d} cx={p.x + d} cy={p.y - d} r={R} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
            ))}
          </g>
        )}
        <circle cx={p.x} cy={p.y} r={R} fill={selected ? SELECTED_FILL : tint(color)} stroke={color} strokeWidth={selected ? 2.5 : act ? 2 : 1.5} />
        <text x={p.x} y={p.y + (selfLags ? 0 : 4)} textAnchor="middle" style={{ font: "700 10px sans-serif", fill: "var(--foreground)" }}>
          {p.tag}
        </text>
        <text x={p.x} y={p.y + 13} textAnchor="middle" style={{ font: "9px sans-serif", fill: "var(--foreground-secondary)" }}>
          {selfLags ? `↻${Math.max(...selfLags)}` : ""}
        </text>
        <text
          x={p.x}
          y={nameAbove ? p.y - R - 6 : p.y + R + 13}
          textAnchor="middle"
          style={{ font: `${act ? 700 : 600} 10px sans-serif`, fill: "var(--foreground)" }}
        >
          {label ?? v}
        </text>
        {(group || noData || roles.prepared(v)) && (
          <text
            x={p.x}
            y={p.y + R + 24}
            textAnchor="middle"
            style={{ font: "italic 9px sans-serif", fill: noData && !group ? "var(--foreground-tertiary)" : "var(--accent)", ...CLEAR }}
          >
            {group ? `${group.method} of ${group.members.length}` : noData ? "no data" : "new · prepared"}
          </text>
        )}
        {kpi && (
          <g className="pid-inst__kpi">
            {/* the role under the name (the KPIs it feeds in the hover text): the band above has no room */}
            <text
              x={p.x}
              y={p.y + R + (nameAbove ? 13 : group || noData || roles.prepared(v) ? 35 : 25)}
              textAnchor="middle"
              style={{ font: "700 9px sans-serif", fill: "var(--accent)", ...CLEAR }}
            >
              {kpi.split(" · ")[0].replace(/ \(.*\)$/, "")}
            </text>
          </g>
        )}
        <g>
          {sure && (
            <circle
              cx={p.x}
              cy={p.y}
              r={R + 4}
              fill="none"
              stroke={sure.color}
              strokeWidth={3}
              strokeDasharray={note?.confidence === "unsure" ? "4 3" : undefined}
            />
          )}
          {multi && <circle cx={p.x} cy={p.y} r={R + 9} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 3" />}
        </g>
      </g>
      {/* the whole name, readable while the pointer rests on it (pid.css) */}
      <text
        className="pid-inst__full pid-halo"
        x={p.x}
        y={p.y - R * size - 10}
        textAnchor="middle"
        style={{ font: "600 12px sans-serif", fill: "var(--foreground)" }}
      >
        {fullName ?? v}
      </text>
    </g>
  );
}
