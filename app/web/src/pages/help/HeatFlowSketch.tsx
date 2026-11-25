/**
 * A simple picture of the heat path the app models, in the same three blocks as the Heat Distribution page: data
 * center -> heat distribution (heat exchanger, heat pump, thermal storage) -> district heat, each block under its app
 * section. Colours are theme tokens.
 */

const BOXES = [
  { x: 10, w: 200, tone: "heat", title: "Data center", lines: ["servers turn power", "into waste heat"] },
  { x: 300, w: 240, tone: "accent", title: "Heat distribution", lines: ["heat exchanger or heat pump,", "thermal storage"] },
  { x: 630, w: 200, tone: "cool", title: "District heat", lines: ["houses and", "hot water"] },
];

/** App sections under the boxes: [from x, to x, label]. */
const SECTIONS: [number, number, string][] = [
  [10, 210, "Data Center"],
  [300, 540, "Heat Distribution"],
  [630, 830, "District"],
];

const TOP = 20;
const H = 92;
const MID = TOP + H / 2;

export function HeatFlowSketch() {
  return (
    <svg className="flow" viewBox="0 0 840 196" role="img" aria-labelledby="flow-title">
      <title id="flow-title">
        Heat path in three blocks: data center, then heat distribution (heat exchanger or heat pump, and thermal storage), then district heat.
      </title>
      <defs>
        {["heat", "power"].map((k) => (
          <marker key={k} id={`flow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className={`flow__head--${k}`} />
          </marker>
        ))}
      </defs>
      {BOXES.slice(1).map((b, i) => {
        const from = BOXES[i].x + BOXES[i].w;
        return <line key={b.title} x1={from + 4} y1={MID} x2={b.x - 6} y2={MID} className="flow__pipe" markerEnd="url(#flow-heat)" />;
      })}
      {/* the heat pump's electricity comes in from below */}
      <line x1={420} y1={TOP + H + 40} x2={420} y2={TOP + H + 4} className="flow__power" markerEnd="url(#flow-power)" />
      <text x={430} y={TOP + H + 32} className="flow__note">
        electricity (heat pump)
      </text>
      {BOXES.map((b) => (
        <g key={b.title}>
          <rect x={b.x} y={TOP} width={b.w} height={H} rx={14} className={`flow__box flow__box--${b.tone}`} />
          <text x={b.x + b.w / 2} y={TOP + 32} className="flow__title">
            {b.title}
          </text>
          {b.lines.map((l, i) => (
            <text key={l} x={b.x + b.w / 2} y={TOP + 54 + i * 17} className="flow__line">
              {l}
            </text>
          ))}
        </g>
      ))}
      {SECTIONS.map(([x1, x2, label]) => (
        <g key={label}>
          <path d={`M${x1} 156 v6 H${x2} v-6`} className="flow__bracket" />
          <text x={(x1 + x2) / 2} y={184} className="flow__section">
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}
