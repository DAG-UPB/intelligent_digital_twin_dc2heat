/**
 * The plant Operation runs on when it is defined there, small (top left; on Heat Matching's plant, its own diagram is
 * drawn instead): the data center's heat at its extraction point, the heat pump and the storage with their sizes, the
 * district (and the backup for what they leave). A part switched off is drawn faint. SVG, theme tokens (planning.css).
 */
import { fmt } from "../../lib/format";

interface Props {
  at: string;
  parts: { hex: boolean; hp: boolean; tank: boolean };
  hpKw: number;
  tankKwh: number;
}

function Box({ x, y, w, title, sub, off, tone }: { x: number; y: number; w: number; title: string; sub?: string; off?: boolean; tone: string }) {
  return (
    <g className={off ? "plant-sketch__off" : undefined}>
      <rect x={x} y={y} width={w} height={34} rx={6} className={`plant-sketch__box plant-sketch__box--${tone}`} />
      <text x={x + w / 2} y={y + 14} className="plant-sketch__title">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 27} className="plant-sketch__sub">
          {sub}
        </text>
      )}
    </g>
  );
}

export function PlantSketch({ at, parts, hpKw, tankKwh }: Props) {
  const kw = (x: number) => (x >= 1000 ? `${fmt(x / 1000, x % 1000 ? 1 : 0)} MW` : `${fmt(x)} kW`);
  return (
    <svg
      viewBox="0 30 280 82"
      className="plant-sketch"
      role="img"
      aria-label={`Plant: data center at the ${at}, heat pump ${kw(hpKw)}, storage ${fmt(tankKwh)} kWh`}
    >
      <defs>
        <marker id="plant-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" className="plant-sketch__head" />
        </marker>
      </defs>
      <path d="M76,57 H102" className="plant-sketch__line" markerEnd="url(#plant-arrow)" />
      <path d="M178,57 H202" className="plant-sketch__line" markerEnd="url(#plant-arrow)" />
      <path d="M140,74 V80" className={parts.tank ? "plant-sketch__line" : "plant-sketch__line plant-sketch__off"} />
      <Box x={4} y={40} w={72} title="Data center" sub={at || "–"} tone="heat" />
      <Box x={102} y={40} w={76} title="Heat pump" sub={parts.hp ? kw(hpKw) : "off"} off={!parts.hp} tone="accent" />
      <Box x={102} y={78} w={76} title="Storage" sub={parts.tank ? `${fmt(tankKwh)} kWh` : "off"} off={!parts.tank} tone="ok" />
      <Box x={204} y={40} w={72} title="District" sub="+ backup" tone="cool" />
    </svg>
  );
}
