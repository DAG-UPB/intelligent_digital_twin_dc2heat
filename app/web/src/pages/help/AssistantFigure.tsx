/**
 * How the AI assistant works with the app, in three boxes for a slide: the user in the browser, the AI agent between
 * the user and the app, the app on this computer (with its MCP server). Arrows say what goes between them; the arc over
 * the agent is the user's own clicks on the app. Colours are theme tokens (help.css), the text English (the German page
 * translates it).
 */
import { RobotMark } from "../../app/ConnectAi";

const W = 270;
const Y = 96;
const H = 236;
const BOXES = [
  { x: 20, tone: "you", title: "User", lines: ["clicks, looks, decides", "sees every change live", "decides what is saved"] },
  { x: 415, tone: "ai", title: "AI agent", lines: ["sees the open page", "works it like the user", "reads, trains, simulates, saves"] },
  { x: 810, tone: "app", title: "The app", lines: ["data, models, the twin", "MCP server: its tools", "live link to the open page"] },
];
const MID = Y + H / 2;

/** A two-way arrow between two boxes, a label above (left to right) and one below (right to left). */
function Link({ x1, x2, top, bottom }: { x1: number; x2: number; top: string; bottom: string }) {
  const cx = (x1 + x2) / 2;
  return (
    <g>
      <line x1={x1 + 6} y1={MID - 8} x2={x2 - 8} y2={MID - 8} className="asys__arrow" markerEnd="url(#asys-head)" />
      <line x1={x2 - 6} y1={MID + 8} x2={x1 + 8} y2={MID + 8} className="asys__arrow" markerEnd="url(#asys-head)" />
      <text x={cx} y={MID - 20} className="asys__say">
        {top}
      </text>
      <text x={cx} y={MID + 32} className="asys__say">
        {bottom}
      </text>
    </g>
  );
}

export function AssistantFigure() {
  return (
    <div className="sys-scroll">
      <svg className="sys asys" viewBox="0 0 1100 400" role="img" aria-label="How the AI assistant works with the app: the user, the AI agent, the app">
        <defs>
          <marker id="asys-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="asys__head" />
          </marker>
        </defs>
        {/* the user works the app directly too: the arc over the model */}
        <path
          d={`M${20 + W / 2} ${Y - 2} C ${20 + W / 2} 44, ${810 + W / 2} 44, ${810 + W / 2} ${Y - 2}`}
          className="asys__arc"
          markerStart="url(#asys-head)"
          markerEnd="url(#asys-head)"
        />
        <text x={550} y={34} className="asys__say asys__say--key">
          clicks · live updates
        </text>
        {BOXES.map((b) => (
          <g key={b.tone}>
            <rect x={b.x} y={Y} width={W} height={H} rx={18} className={`asys__box asys__box--${b.tone}`} />
            {b.tone === "ai" && (
              <g transform={`translate(${b.x + W / 2 - 112} ${Y + 14}) scale(1.4)`} className="asys__robot">
                <RobotMark />
              </g>
            )}
            <text x={b.x + W / 2} y={Y + 42} className="asys__title">
              {b.title}
            </text>
            {b.lines.map((l, i) => (
              <g key={l}>
                <circle cx={b.x + 26} cy={Y + 100 + i * 38 - 4} r={4} className={`asys__dot asys__dot--${b.tone}`} />
                <text x={b.x + 40} y={Y + 100 + i * 38} className="sys__start asys__line">
                  {l}
                </text>
              </g>
            ))}
          </g>
        ))}
        <Link x1={20 + W} x2={415} top="task, code" bottom="answer" />
        <Link x1={415 + W} x2={810} top="tools (MCP)" bottom="the open page" />
        <text x={550} y={378} className="sys__sub">
          Everything a tool returns goes to the model's provider: real data only when that is allowed.
        </text>
      </svg>
    </div>
  );
}
