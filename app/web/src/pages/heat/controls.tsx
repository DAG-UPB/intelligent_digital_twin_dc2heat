/**
 * Small pieces of the Heat Matching cards: a formula box, a note, the value shown on a slider, how a part runs (its
 * Model or the Calculation), where its Model comes from, and its settings, folded. (The on/off switch is ui/Switch.)
 */
import type { ReactNode } from "react";
import { fmt } from "../../lib/format";
import { Segmented } from "../../ui/Segmented";
import { WAYS, wayOf, type Way, type WhyNot } from "./parts";

/** A formula in a monospace box. */
export const Formula = ({ children }: { children: ReactNode }) => <div className="mono heat-formula">{children}</div>;

/** A short explanation under a control. */
export const Note = ({ children }: { children: ReactNode }) => <p className="heat-note">{children}</p>;

/** A slider value with `digits` decimals and a dimmed unit, for ui/Slider's `show`. */
export const shown = (v: number, digits = 0, unit?: string) => (
  <>
    {fmt(v, digits)}
    {unit && <span className="heat-unit"> {unit}</span>}
  </>
);

/** How part `name` runs: its Model or the Calculation; a way that cannot run is disabled, with its reason below. */
export function WayPicker({ name, way, why, onChange, pick }: { name: string; way: Way; why: WhyNot; onChange: (w: Way) => void; pick?: ReactNode }) {
  const runs = wayOf(way, why);
  return (
    <div className="heat-logic">
      <Segmented<Way> label={`${name} source`} value={runs} onChange={onChange} options={WAYS.map((w) => ({ ...w, disabled: why[w.id] }))} />
      {pick}
      {WAYS.map((w) => why[w.id] && <Note key={w.id}>{`${w.label}: ${why[w.id]}.`}</Note>)}
    </div>
  );
}

/** The numbers of a part, closed until wanted. */
export const Settings = ({ children, label = "Settings" }: { children: ReactNode; label?: string }) => (
  <details className="heat-settings">
    <summary>{label}</summary>
    <div className="heat-settings__body">{children}</div>
  </details>
);

/** Where a part's Model comes from: a line and a link to the page that makes it. */
export const From = ({ href, page, children }: { href: string; page: string; children: ReactNode }) => (
  <p className="heat-note heat-from">
    {children}{" "}
    <a href={href} className="heat-link">
      {page} →
    </a>
  </p>
);

/**
 * A part's model and its system, from a small folder at the top right of its column (next to "Model ›"): one native
 * list, its models first (the one running is chosen), then the systems (datasets) it can be taken from. Values are
 * "model:<id>" and "system:<id>"; `onModel` / `onSystem` get the id.
 */
export function SystemLoad(p: {
  label: string;
  model: string;
  models: { id: string; label: string }[];
  system: string;
  systems: { id: string; label: string }[];
  onModel: (id: string) => void;
  onSystem: (id: string) => void;
}) {
  const now = p.models.find((o) => o.id === p.model)?.label ?? "–";
  const sys = p.systems.find((o) => o.id === p.system)?.label ?? p.system;
  return (
    <label className="heat-load" title={`${p.label}: ${now} · ${sys}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
        <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7z" />
        <path d="M3 10.5h18" />
      </svg>
      <select
        aria-label={p.label}
        value={`model:${p.model}`}
        onChange={(e) => {
          const [kind, ...rest] = e.target.value.split(":");
          const id = rest.join(":");
          if (kind === "model") p.onModel(id);
          else p.onSystem(id);
        }}
      >
        <optgroup label="Model">
          {p.models.map((o) => (
            <option key={o.id} value={`model:${o.id}`}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="System">
          {p.systems.map((o) => (
            <option key={o.id} value={`system:${o.id}`}>
              {o.id === p.system ? `${o.label} (open)` : o.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
