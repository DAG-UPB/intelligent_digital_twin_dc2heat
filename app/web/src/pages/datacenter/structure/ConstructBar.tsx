/**
 * The three levels of the Physical structure drawing, each shown or hidden: the picture (the P&ID image or the
 * built-in drawing), the digital construct (shapes) and the variables; and how the P&ID's views are shown (each at its
 * own level, or all as boxes, the sheet underneath or their pictures). "Edit construct" opens its drawing tools.
 */
import { KIND_LABEL } from "./construct";
import type { Tool } from "./ConstructLayer";
import type { ViewsAs } from "./views";

export interface Layers {
  picture: boolean;
  construct: boolean;
  variables: boolean;
}
const LAYERS: { key: keyof Layers; label: string }[] = [
  { key: "picture", label: "Picture" },
  { key: "construct", label: "Construct" },
  { key: "variables", label: "Variables" },
];
const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" },
  ...(["rect", "circle", "line", "text"] as const).map((k) => ({ id: k, label: KIND_LABEL[k] })),
];

interface Props {
  layers: Layers;
  onLayers: (l: Layers) => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  count: number;
  drawing: number; // of them, the sheet's own lines and texts
  firstGuess: boolean; // read from the drawing, not saved yet
  onRemovePicture: (() => void) | null; // the P&ID image can be removed (null: none, or the built-in drawing)
  viewsAs: ViewsAs | null; // null: the P&ID has no views
  onViewsAs: (v: ViewsAs) => void;
}

export function ConstructBar(p: Props) {
  return (
    <div className="pid-bar pid-layers">
      <span role="group" aria-label="Layers" className="pid-layers__group">
        <span className="pid-muted">Show</span>
        {LAYERS.map((l) => (
          <label key={l.key} className="pid-layers__check">
            <input type="checkbox" checked={p.layers[l.key]} onChange={(e) => p.onLayers({ ...p.layers, [l.key]: e.target.checked })} />
            {l.label}
          </label>
        ))}
        {p.viewsAs && (
          <label className="pid-layers__check" title="How the views inside the P&ID are shown: each as set in the Views list, or all at one level">
            Views
            <select className="field field--sm" value={p.viewsAs} onChange={(e) => p.onViewsAs(e.target.value as ViewsAs)} aria-label="Show the views as">
              <option value="own">each its own</option>
              <option value="auto">auto (box, picture zoomed in)</option>
              <option value="box">boxes</option>
              <option value="sheet">the sheet underneath</option>
              <option value="picture">their pictures</option>
            </select>
          </label>
        )}
      </span>
      <button type="button" className={p.editing ? "btn btn--primary" : "btn"} aria-pressed={p.editing} onClick={() => p.onEditing(!p.editing)}>
        Edit construct
      </button>
      {p.editing && (
        <span role="group" aria-label="Drawing tool" className="pid-layers__group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={p.tool === t.id ? "chip chip--on" : "chip"}
              aria-pressed={p.tool === t.id}
              onClick={() => p.onTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </span>
      )}
      {p.onRemovePicture && (
        <button type="button" className="btn pid-delete" onClick={p.onRemovePicture} title="Remove the P&ID picture (backed up first)">
          Remove picture
        </button>
      )}
      <span className="pid-hint">
        {p.drawing ? `${p.drawing} lines and texts of the sheet · ${p.count - p.drawing} recognised` : `${p.count} shapes`}
        {p.firstGuess && p.count ? " · read from the drawing, not saved yet" : ""}
        {p.editing && p.tool !== "select" ? " · drag on the drawing to draw, a click gives the default size" : ""}
      </span>
    </div>
  );
}
