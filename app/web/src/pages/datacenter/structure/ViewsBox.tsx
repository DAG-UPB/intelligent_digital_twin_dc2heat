/**
 * The views of the P&ID in the side panel (views.ts): mark an area of the drawing as a view (drag a box, then name
 * it), give it a picture of its own (another P&ID: PDF, SVG or PNG), choose how it is shown (a box, the sheet
 * underneath, its picture, or auto: a box until zoomed into), open it (zoom onto it), remove it. Each is written
 * at once (site.json pid_views, the picture in the data center's folder), like the P&ID picture itself.
 */
import { useState } from "react";
import { SHOW_AS, type PidView, type ShowAs } from "./views";

interface Props {
  views: PidView[];
  pictures: Record<string, number>; // view id -> picture version (no entry: no picture)
  construct: Record<string, { shapes: number; components: number }>; // view id -> what was read from its picture
  marking: boolean; // the next drag on the drawing marks an area
  onMarking: (on: boolean) => void;
  marked: boolean; // an area is marked and waits for its name
  onCreate: (name: string) => void;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onWhole: () => void;
  onPicture: (id: string, file: File) => void;
  onRemove: (id: string) => void;
  onShowAs: (id: string, show: ShowAs) => void;
}

const SHOW_LABEL: Record<ShowAs, string> = { auto: "Auto", box: "Box", sheet: "Sheet underneath", picture: "Its picture" };

export function ViewsBox(p: Props) {
  const [name, setName] = useState("");
  return (
    <details className="pid-changes" open>
      <summary>
        <span className="caps">Views</span> <span className="pid-muted">{p.views.length || "none yet"}</span>
      </summary>
      <div className="pid-stack" style={{ fontSize: 12, marginTop: 6 }}>
        {p.marked ? (
          <form
            className="pid-stack"
            onSubmit={(e) => {
              e.preventDefault();
              p.onCreate(name);
              setName("");
            }}
          >
            <label className="pid-stack">
              Name of the new view
              <input
                className="field field--sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                placeholder="e.g. Cooling unit 1"
              />
            </label>
            <div className="pid-chips">
              <button type="submit" className="btn btn--sm btn--primary" disabled={!name.trim()}>
                Make view
              </button>
              <button type="button" className="btn btn--sm" onClick={p.onCancel}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={p.marking ? "btn btn--sm btn--primary" : "btn btn--sm"}
            aria-pressed={p.marking}
            onClick={() => p.onMarking(!p.marking)}
            title="Then drag a box on the drawing around the area (e.g. one unit): it becomes a view with a picture of its own"
          >
            {p.marking ? "Drag a box on the drawing…" : "Mark an area as a view"}
          </button>
        )}
        {p.views.length > 0 && (
          <ul className="pid-views" aria-label="Views of the P&ID">
            {p.views.map((v) => (
              <li key={v.id}>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => p.onOpen(v.id)} title="Zoom onto this view">
                  ▣ {v.name}
                </button>
                <select
                  className="field field--sm"
                  value={v.show ?? "auto"}
                  onChange={(e) => p.onShowAs(v.id, e.target.value as ShowAs)}
                  aria-label={`Show ${v.name} as`}
                  title="Auto: a box while it is small on screen, its picture once you zoom in"
                >
                  {SHOW_AS.map((s) => (
                    <option key={s} value={s}>
                      {SHOW_LABEL[s]}
                    </option>
                  ))}
                </select>
                <label
                  className="btn btn--sm"
                  title="A PDF (its first page), SVG, DEXPI or PNG drawn inside the view; a PDF, SVG or DEXPI file is also read into the view's construct (a PNG or a scan is not)"
                >
                  {p.pictures[v.id] !== undefined ? "New picture…" : "Picture…"}
                  <input
                    type="file"
                    accept=".pdf,.svg,.png,application/pdf,image/svg+xml,image/png"
                    hidden
                    aria-label={`Picture of ${v.name}`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) p.onPicture(v.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <span className="pid-muted pid-views__status" aria-label={`Construct of ${v.name}`}>
                  {p.pictures[v.id] === undefined
                    ? "no picture yet: a PDF, SVG or DEXPI file is also read into a construct"
                    : p.construct[v.id]
                      ? `construct: ${p.construct[v.id].shapes} shapes, ${p.construct[v.id].components} components and instruments`
                      : "picture only, no construct: a PNG or a scan has nothing to read. Give it the drawing as a PDF, SVG or DEXPI file"}
                </span>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  aria-label={`Remove the view ${v.name}`}
                  onClick={() =>
                    window.confirm(`Remove the view ${v.name}? Its picture is backed up; the variables in it stay where they are.`) && p.onRemove(v.id)
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {p.views.length > 0 && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={p.onWhole}>
            Back to the whole P&ID
          </button>
        )}
      </div>
    </details>
  );
}
