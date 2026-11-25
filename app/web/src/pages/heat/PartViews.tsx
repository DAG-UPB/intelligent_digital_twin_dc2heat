/**
 * A part in the flow diagram while it runs its Model: its column is its Structure and Modelling's drawing, cropped to
 * the part. The weather is the diagram's band, and the neighbours' boxes in the drawing fall at the crop's edges.
 * Every structure's drawing has its connection point at the same heights (PORT_Y), and the three are drawn at one
 * scale and one vertical crop, so the diagram's pipes run straight from one drawing's pipes to the next one's.
 */
import type { CSSProperties, ReactNode } from "react";
import { DrawnEquipment } from "../datacenter/structure/DrawnEquipment";
import { DrawnLiquid } from "../datacenter/structure/DrawnLiquid";
import { DC_TAPS, DC_TAPS_HALL_WATER } from "../datacenter/structure/geometry";
import { PORT_Y } from "../datacenter/structure/connection";
import { LIQUID_TAPS } from "../datacenter/structure/liquidLayout";
import type { Hex } from "../datacenter/structure/usePidGraph";
import { pointLabel } from "./points";

export type BuiltIn = "air" | "free-cooling" | "liquid";
type Part = "dc" | "heat" | "district";

/** Each drawing's part, in its frame (left x, width): the data center (drawn without the heat distribution's box), the
 * heat distribution between the data center's and the district's boxes, the district right of the heat distribution's. */
const CROP_X: Record<Part, [number, number]> = { dc: [40, 1010], heat: [180, 760], district: [200, 800] }; // the data center's with its cooling tower
const CROP_Y = 108; // just above the waste heat's pipe to the heat distribution (DrawnEquipment HexUnit, y 118)
const CROP_H = 482;
/** The diagram's frame: its width, the margin left and right of the columns, the gaps between them (the pipes). */
export const FRAME = { w: 1200, margin: 12, gap: 80 };
const PARTS: Part[] = ["dc", "heat", "district"];
// the one scale: the three columns and the two gaps fill the diagram's width
const K = (FRAME.w - 2 * FRAME.margin - 2 * FRAME.gap) / PARTS.reduce((a, p) => a + CROP_X[p][1], 0);
const HEAD = 46; // the column's title and line above the drawing
export const FOOT = 16; // under the drawing: a margin to the box's edge (its card is a row under the box, heat.css .heat-cards--under)
/** A Model column's width, and its height with the drawing alone in it (the three are as high). */
export const partWidth = (part: Part) => CROP_X[part][1] * K;
export const PART_H = HEAD + CROP_H * K + FOOT;
/** The cards under the diagram in its columns' widths and gaps (heat.css .heat-cards--aligned), the diagram as wide as they. */
export const alignedCards = () =>
  ({
    "--hc-cols": PARTS.map((p) => `minmax(0, ${partWidth(p)}fr)`).join(" "), // minmax: a long select never widens its column
    "--hc-gap": `${(FRAME.gap / (FRAME.w - 2 * FRAME.margin)) * 100}%`,
    "--hc-pad": `${(FRAME.margin / FRAME.w) * 100}%`,
    "--hc-up": `${FOOT / FRAME.w}`, // the foot's height as a share of the diagram's width: the cards move up into it
    "--hc-foot": `${(FRAME.w - 2 * FRAME.margin) / FOOT}`, // and the row as high as the foot: the columns' width over it
  }) as CSSProperties;

/** The data center's heat exchangers each built-in drawing has. */
const DC_POINTS: Record<"air" | "liquid", string[]> = { air: ["hall", "condenser"], liquid: ["liquid", "condenser"] };

/** A column of the diagram: its left x, width and top; `drop` moves its drawing down (centred in the column). */
export interface Col {
  x: number;
  w: number;
  top: number;
  drop?: number;
}

const yOf = (c: Col, y: number) => c.top + (c.drop ?? 0) + HEAD + (y - CROP_Y) * K;
const xOf = (part: Part, c: Col, x: number) => c.x + (x - CROP_X[part][0]) * K;

/** Whether the data center's built-in drawing has every one of these points. */
export const drawnPoints = (d: BuiltIn, keys: string[]) => keys.length > 0 && keys.every((k) => DC_POINTS[d === "liquid" ? "liquid" : "air"].includes(k));
/** The diagram's y of a Model column's connection point, the supply's and the return's: the same in all three. */
export const portY = (c: Col): [number, number] => [yOf(c, PORT_Y[0]), yOf(c, PORT_Y[1])];
/** Where the data center's water reaches the heat distribution's place in its drawing: the pipes start there. */
export const dcPortX = (c: Col) => xOf("dc", c, 1000);

const LINK: Record<Part, [string, string]> = {
  dc: ["#/dc/pid", "The data center's Structure and Modelling"],
  heat: ["#/heat/structure", "The heat distribution's Structure and Modelling"],
  district: ["#/district/structure", "The district's Structure and Modelling"],
};

/** The column: its title and its numbers, the link to its Structure and Modelling, the cropped drawing, `children`
 * over it, and under it room for the part's card. */
export function PartColumn(p: {
  part: Part;
  col: Col;
  h: number;
  tone: string;
  title: string;
  sub: string;
  drawing?: ReactNode; // none: the Calculation, its `children` instead
  model?: boolean; // runs its Model without a built-in drawing (its own P&ID among the children): "Model ›" too
  children?: ReactNode;
  load?: ReactNode; // its models and systems, a folder at the top right (controls.tsx SystemLoad)
}) {
  const { col, part } = p;
  const [cx, cw] = CROP_X[part];
  const [href, label] = LINK[part];
  return (
    <g>
      <rect
        x={col.x}
        y={col.top}
        width={col.w}
        height={p.h}
        rx={18}
        className="hf-part-frame" // a scenario on: tinted yellow (heat.css)
        style={{ "--tone": p.tone } as CSSProperties}
        fill={`color-mix(in srgb, ${p.tone} 7%, var(--surface))`}
        stroke={p.tone} // the twin's colours, as on the home page's figure (its mark in the top bar)
        strokeWidth={2}
      />
      <text x={col.x + 18} y={col.top + 26} className="hf-dc-title">
        {p.title}
      </text>
      <text x={col.x + 18} y={col.top + 42} className="hf-dc-sub">
        {p.sub}
      </text>
      {(p.drawing || p.model) && (
        <a href={href} className="hf-thumb-link" aria-label={label}>
          <title>{label}</title>
          <text x={col.x + col.w - 16} y={col.top + 26} textAnchor="end">
            Model ›
          </text>
        </a>
      )}
      {p.drawing && (
        <>
          <svg x={col.x} y={yOf(col, CROP_Y)} width={cw * K} height={CROP_H * K} viewBox={`${cx} ${CROP_Y} ${cw} ${CROP_H}`} aria-hidden="true">
            {p.drawing}
          </svg>
        </>
      )}
      {p.load && (
        <foreignObject x={col.x + col.w - (p.drawing || p.model ? 88 : 44)} y={col.top + 10} width={28} height={26}>
          {p.load}
        </foreignObject>
      )}
      {p.children}
    </g>
  );
}

/** The data center's built-in drawing, the picked point's heat exchanger highlighted; `hallOnWater`: the hall's HEX on
 * the warm water, not in the air (its Q has water's cp, as on Structure and Modelling). */
export function DcPlant({ drawing, at, hallOnWater = false }: { drawing: BuiltIn; at: string; hallOnWater?: boolean }) {
  return drawing === "liquid" ? (
    <DrawnLiquid hex={at as Hex} alone />
  ) : (
    <DrawnEquipment hex={at as Hex} freeCooling={drawing === "free-cooling"} hallOnWater={hallOnWater} alone />
  );
}

const HEX_UNIT: Record<string, string> = { hall: "hexHall", condenser: "hexCond", liquid: "hexLiq" };

/** Over each extraction point's heat exchanger on the data center's drawing, a target to pick it. */
export function DcPicks({
  drawing,
  keys,
  at,
  onPick,
  col,
  hallOnWater = false,
}: {
  drawing: BuiltIn;
  keys: string[];
  at: string;
  onPick: (x: string) => void;
  col: Col;
  hallOnWater?: boolean;
}) {
  const units = (drawing === "liquid" ? LIQUID_TAPS : hallOnWater ? DC_TAPS_HALL_WATER : DC_TAPS).units;
  return (
    <g role="radiogroup" aria-label="Extraction point">
      {keys.map((x) => {
        const [ux, uy, uw, uh] = units[HEX_UNIT[x]];
        const { title, sub } = pointLabel(x);
        return (
          <rect
            key={x}
            role="radio"
            aria-checked={x === at}
            aria-label={`Extract at ${title} · ${sub}`}
            tabIndex={0}
            x={xOf("dc", col, ux) - 6}
            y={yOf(col, uy) - 6}
            width={uw * K + 12}
            height={uh * K + 12}
            rx={4}
            className="hf-pick"
            onClick={() => onPick(x)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(x))}
          >
            <title>{`${title} · ${sub}${x === at ? " (extracting here)" : ": click to extract here"}`}</title>
          </rect>
        );
      })}
    </g>
  );
}
