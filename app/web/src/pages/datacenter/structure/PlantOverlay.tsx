/** The plant read from the imported drawing (pipes and named components), drawn over the paper P&ID, under the instruments. */
import type { Plant } from "../../../lib/plantLinks";
import { W } from "./geometry";

export function PlantOverlay({ plant, height, opacity }: { plant: Plant; height: number; opacity: number }) {
  return (
    <g pointerEvents="none" opacity={opacity}>
      {plant.pipes.map((pl, i) => (
        <polyline key={`pp${i}`} points={pl.map(([x, y]) => `${x * W},${y * height}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.45} />
      ))}
      {plant.components.map((c) => (
        <g key={`pc${c.id}`}>
          <circle cx={c.x * W} cy={c.y * height} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1} />
          <text x={c.x * W + 6} y={c.y * height - 6} className="pid-halo" style={{ font: "600 10px sans-serif", fill: "var(--accent)" }}>
            {c.label}
          </text>
        </g>
      ))}
    </g>
  );
}
