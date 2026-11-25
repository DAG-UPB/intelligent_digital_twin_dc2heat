/** Sensor taps on the built-in drawing: a line from each instrument to the equipment it measures (none for room air, weather, clock). */
import { R, tapFor, type Pt, type Taps } from "./geometry";
import type { Pos } from "./layout";

/** `radius`: each bubble's drawn radius (its size), so the line starts on its edge at any size. */
export function SensorTaps({
  vars,
  pos,
  opacity,
  hidden,
  taps,
  radius = () => R,
}: {
  vars: string[];
  pos: Pos;
  opacity: number;
  hidden: boolean;
  taps?: Taps;
  radius?: (v: string) => number;
}) {
  return (
    <g opacity={opacity} pointerEvents="none" display={hidden ? "none" : undefined}>
      {vars.map((v) => {
        const p = pos[v];
        const q = p && tapFor(v, p.x, p.y, taps);
        if (!q) return null;
        const [d, r] = [Math.hypot(q[0] - p.x, q[1] - p.y), radius(v)];
        if (d <= r) return null;
        const s: Pt = [p.x + ((q[0] - p.x) / d) * r, p.y + ((q[1] - p.y) / d) * r];
        return (
          <g key={`tap${v}`}>
            <line x1={s[0]} y1={s[1]} x2={q[0]} y2={q[1]} stroke="var(--foreground)" strokeWidth={1.2} />
            <circle cx={q[0]} cy={q[1]} r={3} fill="var(--foreground)" />
          </g>
        );
      })}
    </g>
  );
}
