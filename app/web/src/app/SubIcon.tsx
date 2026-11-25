/**
 * The twin's three steps as small marks before their sub-tabs: ideation (a bulb with a gear), planning (a clipboard
 * with a play drawn on it) and operation (two gears turning). Line drawings in the text's colour, 20 px.
 */
import type { ReactNode } from "react";

const Mark = ({ children }: { children: ReactNode }) => (
  <svg
    className="subtabs__icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

/** A gear: a ring with eight teeth round its hub. */
const Gear = ({ x, y }: { x: number; y: number }) => (
  <>
    <circle cx={x} cy={y} r={2.9} />
    <circle cx={x} cy={y} r={1} />
    <path
      d={Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        const p = (r: number) => `${(x + r * Math.cos(a)).toFixed(2)} ${(y + r * Math.sin(a)).toFixed(2)}`;
        return `M${p(2.9)}L${p(4.4)}`;
      }).join("")}
      strokeWidth={1.8}
    />
  </>
);

export const SUB_ICONS: Record<string, ReactNode> = {
  // Site Map: the idea, a bulb with a gear in it
  "twin/map": (
    <Mark>
      <path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.4 1 2.4h6c0-1 .3-1.8 1-2.4a6.5 6.5 0 0 0-4-11.6z" />
      <path d="M9.5 19h5M10.5 21.5h3" />
      <circle cx={12} cy={9} r={2.3} strokeWidth={1.4} strokeDasharray="1.2 0.9" />
    </Mark>
  ),
  // Heat Matching: the plan, a play on a clipboard
  "twin/matching": (
    <Mark>
      <rect x={4.5} y={4} width={15} height={17.5} rx={1.8} />
      <path d="M9 4V2.8h6V4" />
      <path d="M7.5 8.5l2 2M9.5 8.5l-2 2M14.5 15.5l2 2M16.5 15.5l-2 2" />
      <circle cx={15.5} cy={9.5} r={1.1} />
      <circle cx={8.5} cy={17} r={1.1} />
      <path d="M10 15.5c1.5-.5 2.5-1.8 2.5-3.7M11.2 12.9l1.3-1.3 1.3 1.3" />
    </Mark>
  ),
  // Operation: running it, two gears turning
  "twin/planning": (
    <Mark>
      <Gear x={15.5} y={7.5} />
      <Gear x={8.5} y={16.5} />
      <path d="M4.5 9.5V4.5M3 6l1.5-1.5L6 6M19.5 14.5v5M18 18l1.5 1.5L21 18" />
    </Mark>
  ),
};
