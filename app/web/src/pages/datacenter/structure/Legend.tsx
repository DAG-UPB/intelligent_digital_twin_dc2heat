/** Legend at the bottom of the side panel: how each variable is made (its colour, and the links into it), actuators,
 * confidences, pipes (drawn P&ID only) and the ISA tags. */
import { APPROACHES } from "../modelling/approaches";
import { CONFIDENCE } from "./notes";
import { tint, WAYS } from "./roles";

function Bubble({ stroke, square = false }: { stroke: string; square?: boolean }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
      {square && <rect x={1} y={1} width={18} height={18} fill={tint(stroke)} stroke={stroke} strokeWidth={1.5} />}
      <circle cx={10} cy={10} r={8} fill={tint(stroke)} stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

export function Legend({ drawn }: { drawn: boolean }) {
  return (
    <div className="pid-legend">
      <strong className="caps">Legend</strong>
      <div className="pid-legend__row pid-legend__wrap">
        A variable and the links into it, coloured by how Modelling makes it:
        {APPROACHES.map((a) => (
          <span key={a.id} className="pid-legend__ring">
            <svg width={30} height={16} viewBox="0 0 30 16" aria-hidden>
              <path d="M1,8 H13" stroke={WAYS[a.id]} strokeWidth={1.2} />
              <circle cx={21} cy={8} r={6} fill={tint(WAYS[a.id])} stroke={WAYS[a.id]} strokeWidth={1.5} />
            </svg>
            {a.short}
          </span>
        ))}
      </div>
      <div className="pid-legend__row">
        <Bubble stroke="var(--foreground-secondary)" square /> Actuator / setpoint (a lever in Scenarios), in its colour
      </div>
      <div className="pid-legend__row pid-legend__wrap">
        How sure (ring):
        {Object.entries(CONFIDENCE).map(([key, c]) => (
          <span key={key} className="pid-legend__ring">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <circle cx={8} cy={8} r={6} fill="none" stroke={c.color} strokeWidth={2.5} strokeDasharray={key === "unsure" ? "3 2" : undefined} />
            </svg>
            {c.label}
          </span>
        ))}
      </div>
      {drawn && (
        <div className="pid-legend__row">
          <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <path d="M2,14 H18" stroke="var(--hot)" strokeWidth={3} />
          </svg>
          Water pipe (P&ID)
        </div>
      )}
      {drawn && (
        <div className="pid-legend__row">
          <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <path d="M2,14 H18" stroke="var(--hot)" strokeWidth={1.5} strokeDasharray="5 4" />
          </svg>
          Air flow in the data hall
        </div>
      )}
      <div className="pid-legend__tags">
        Tags: TT temperature · MT humidity · ST speed · ZT direction · JT load · EQ energy · QT heat · FT flow · PT pressure · TIC controller · SC speed control · FV valve · KI clock · XT other. ↻n:
        depends on its own past, up to n hours back.
      </div>
    </div>
  );
}
