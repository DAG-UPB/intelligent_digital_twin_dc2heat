/**
 * Top of the Physical structure page: title and what the drawing is, then the controls — diagram switch,
 * graph file, heat-recovery choice, lag discovery, save, save as and P&ID import (adding variables and links is in
 * the Variables menu of the side panel, VariableMenu.tsx). Lag discovery, save as and import only in edit mode (Edit;
 * Save whenever there is something to save).
 */
import type { ReactNode } from "react";
import { DiscoverControls, type DiscoverOptions } from "./DiscoverControls";
import type { Diagram } from "./layout";
import type { Hex } from "./usePidGraph";

const HEX_LABEL: Record<Hex, string> = { condenser: "Condenser HEX", hall: "Hall HEX", liquid: "Liquid cooling HEX" };

interface Props {
  intro: "paper" | "drawn" | "none"; // which drawing is shown
  title?: string; // another structure's (PidPage setup); else "Structure and Modelling"
  text?: string; // what another structure's built-in drawing shows, in place of the intro
  name: string; // the data center's name
  diagram: Diagram | null;
  onDiagram: ((d: Diagram) => void) | null; // null: only one diagram available
  files: string[];
  file: string | null;
  onFile: (f: string) => void;
  hex: Hex | null; // null: no built-in drawing, no heat-recovery choice
  onHex: (h: Hex) => void;
  hexes?: Hex[]; // the extraction points this data center has (dataset.json heat_source), default the air-cooled two
  discovering: boolean;
  onDiscover: ((o: DiscoverOptions) => void) | null; // null: no lag discovery (a structure without data)
  dirty: boolean;
  onSave: () => void;
  savingAs: boolean;
  onToggleSaveAs: () => void;
  importing: boolean;
  onImport: () => void;
  edit: boolean; // edit mode: the tools that change the structure shown
  onEdit: (on: boolean) => void;
  children?: ReactNode; // the import dialog, when open
}

const INTRO = {
  paper: (name: string) => `The P&ID of ${name} from the paper: drag every instrument onto the spot it measures.`,
  drawn: () => "The P&ID of an air-cooled data center.",
  none: () => "No P&ID drawing for this data center yet: arrange the instruments freely.",
};

const on = (yes: boolean) => (yes ? "btn btn--on" : "btn");

export function Toolbar(p: Props) {
  return (
    <div className="pid-toolbar">
      <div className="pid-intro">
        <h1>{p.title ?? "Structure and Modelling"}</h1>
        <p>
          {p.text ?? INTRO[p.intro](p.name)} Slide right for the causal links
          {p.edit ? "; click an instrument to edit its links" : "; Edit to change the structure"}.
        </p>
      </div>
      {p.onDiagram && (
        <span className="pid-group" role="group" aria-label="Diagram">
          Diagram:
          {(["drawn", "paper"] as const).map((d) => (
            <button key={d} type="button" className={on(p.diagram === d)} aria-pressed={p.diagram === d} onClick={() => p.onDiagram!(d)}>
              {d === "drawn" ? "Drawn P&ID" : "Paper P&ID"}
            </button>
          ))}
        </span>
      )}
      <select value={p.file ?? ""} onChange={(e) => p.onFile(e.target.value)} className="btn pid-file" aria-label="Graph file">
        {(p.files.length ? p.files : p.file ? [p.file] : []).map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      {p.hex && (
        <span className="pid-group" role="group" aria-label="Heat recovery">
          Heat recovery:
          {(p.hexes?.length ? p.hexes : (["condenser", "hall"] as Hex[])).map((h) => (
            <button key={h} type="button" className={on(p.hex === h)} aria-pressed={p.hex === h} onClick={() => p.onHex(h)}>
              {HEX_LABEL[h]}
            </button>
          ))}
        </span>
      )}
      {p.edit && p.onDiscover && <DiscoverControls busy={p.discovering} onDiscover={p.onDiscover} />}
      {(p.edit || p.dirty) && (
        <button type="button" className="btn btn--primary" onClick={p.onSave} disabled={!p.dirty || !p.file}>
          {p.dirty ? `Save to ${p.file}` : "Saved"}
        </button>
      )}
      {p.edit && (
        <>
          <button type="button" className={on(p.savingAs)} aria-expanded={p.savingAs} onClick={p.onToggleSaveAs}>
            Save as…
          </button>
          <button type="button" className={on(p.importing)} onClick={p.onImport} title="Read a P&ID from a PDF or SVG drawing, or a DEXPI file">
            Import P&ID…
          </button>
        </>
      )}
      <button type="button" className={p.edit ? "btn btn--primary" : "btn"} aria-pressed={p.edit} onClick={() => p.onEdit(!p.edit)}>
        {p.edit ? "Done editing" : "Edit"}
      </button>
      {p.children}
    </div>
  );
}
