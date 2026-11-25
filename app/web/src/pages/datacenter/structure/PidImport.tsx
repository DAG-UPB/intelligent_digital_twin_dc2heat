/**
 * "Import P&ID" dialog, in this order: choose a P&ID (PDF, SVG, or DEXPI, the standard machine-readable P&ID
 * format); its preview appears and the user drags a rectangle over the plant (or takes the whole page), leaving out
 * the legend, the instrument tables and the title block; then that area is read: every line and text of it, digital,
 * and on them the pipes (colour runs), named components, instrument bubbles and their traced connections. A DEXPI
 * file is read exactly and whole (tags, pipes and instruments are in it). The drawing stays on this machine; "Use as
 * the P&ID" stores the area as this data center's diagram (then the page reloads to show it).
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { extractPid, previewPid, setPidDrawing, type Extracted, type PidArea, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { Dialog } from "../../../ui/Dialog";
import { areaBetween, type XY } from "./construct";
import "./pid.css";

export default function PidImport({ scope, onClose, onUsed }: { scope: StructureScope; onClose: () => void; onUsed: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<Extracted | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [area, setArea] = useState<PidArea | null>(null); // the part read (null: the whole page)
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState<PidArea | null>(null); // the rectangle being dragged
  const isDexpi = !!file && /\.xml$/i.test(file.name); // read whole: a DEXPI file has no legend to leave out

  useEffect(() => () => void (image && URL.revokeObjectURL(image)), [image]);

  /** A new file: first its preview, for choosing the area; it is read once the area is chosen. Without a preview
   * (no renderer installed) or for a DEXPI file, the whole page is read at once. */
  const read = async (f: File) => {
    setFile(f);
    setResult(null);
    setImage(null);
    setArea(null);
    setSelecting(false);
    setBusy(true);
    setStatus("Rendering the preview…");
    const dexpi = /\.xml$/i.test(f.name);
    const prev = await previewPid(f).catch(() => null);
    if (prev) setImage(URL.createObjectURL(prev));
    setBusy(false);
    if (prev && !dexpi) {
      setSelecting(true);
      setStatus("Drag a rectangle over the plant, leaving out the legend, the tables and the title block; or read the whole page.");
      return;
    }
    await readArea(null, f);
  };

  /** Read this area (null: the whole page): every line and text of it, then what is recognised in them. */
  const readArea = async (a: PidArea | null, f: File | null = file) => {
    if (!f) return;
    setArea(a);
    setSelecting(false);
    setBusy(true);
    setStatus(`Reading ${a ? "the selected area" : "the whole page"}… (a large sheet takes up to a minute)`);
    try {
      setResult(await extractPid(f, a));
      setStatus(null);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const use = async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Saving the drawing as this data center's P&ID…");
    try {
      await setPidDrawing(DATASET, file, area, scope);
      onUsed(); // reloads the page; stay busy until then
    } catch (e) {
      setStatus(errorMessage(e));
      setBusy(false);
    }
  };

  /** Where the pointer is on the preview, as fractions of the page. */
  const pointAt = (e: PointerEvent<SVGSVGElement>): XY => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };
  const startArea = (e: PointerEvent<SVGSVGElement>) => {
    const a = pointAt(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const svg = e.currentTarget;
    const move = (ev: globalThis.PointerEvent) => {
      const r = svg.getBoundingClientRect();
      setDraft(
        areaBetween(a, {
          x: (ev.clientX - r.left) / r.width,
          y: (ev.clientY - r.top) / r.height,
        }),
      );
    };
    const up = (ev: globalThis.PointerEvent) => {
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      const r = svg.getBoundingClientRect();
      const done = areaBetween(a, {
        x: (ev.clientX - r.left) / r.width,
        y: (ev.clientY - r.top) / r.height,
      });
      setDraft(null);
      if (!done) return;
      setSelecting(false);
      readArea(done);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
  };
  const shown = draft ?? area; // the rectangle drawn over the preview
  // what was read sits over its area of the page (the whole page when none is selected)
  const placed =
    area && image
      ? {
          left: `${area[0] * 100}%`,
          top: `${area[1] * 100}%`,
          width: `${(area[2] - area[0]) * 100}%`,
          height: `${(area[3] - area[1]) * 100}%`,
        }
      : undefined;

  const components = result?.components ?? [];
  const at = new Map(components.map((c) => [c.id, c]));
  const vb = result?.viewBox.split(" ").map(Number) ?? [0, 0, 1, 1];
  const r = Math.max(vb[2], vb[3]) / 250; // marker size relative to the sheet

  return (
    <Dialog label="Import a P&ID" onClose={onClose}>
      <div className="pid-import__head">
        <h2>Import a P&ID</h2>
        <button type="button" className="btn btn--pill" onClick={() => picker.current?.click()} disabled={busy}>
          {file ? "Another file…" : "Choose PDF, SVG or DEXPI…"}
        </button>
        <input
          ref={picker}
          type="file"
          accept=".pdf,.svg,.xml,application/pdf,image/svg+xml,application/xml,text/xml"
          hidden
          onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
        />
        {file && <span className="pid-hint">{file.name}</span>}
        {image && !isDexpi && !busy && (
          <>
            {!selecting && (
              <button type="button" className="btn btn--pill" onClick={() => setSelecting(true)}>
                {area ? "Select another area" : "Select area"}
              </button>
            )}
            {(selecting || area) && (
              <button type="button" className="btn btn--pill" onClick={() => readArea(null)}>
                Whole page
              </button>
            )}
          </>
        )}
        <span style={{ flex: 1 }} />
        {result && (
          <button type="button" className="btn btn--pill btn--primary" onClick={use} disabled={busy}>
            Use as the P&ID of this data center
          </button>
        )}
        <button type="button" className="btn btn--pill" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="pid-import__note">
        Choose the file, then drag over the plant on its preview: only that area is read (leave out the legend and the tables), and only it is kept. Every line
        and text of it becomes digital first; on them the pipes (coloured lines), the named equipment (tags like P4711, WT 4a), the instrument bubbles and which
        equipment the pipes connect are recognised. A DEXPI file (the standard P&ID exchange format, Proteus XML, exported by most P&ID CAD tools) is read
        exactly, with no guessing. The drawing stays on this computer: it is read here and not stored, unless you use it as this data center's P&ID (then it is
        kept in the data center's own folder, never uploaded).
      </p>
      {status && (
        <div role="status" aria-busy={busy} className={busy ? "pid-status" : "pid-status pid-hint--error"}>
          {status}
        </div>
      )}

      {(result || image) && (
        <>
          {result && (
            <div className="pid-import__stats">
              {(
                [
                  ["Lines (digital)", result.lines?.length ?? 0],
                  ["Texts", result.texts?.length ?? 0],
                  ["Components", components.length],
                  ["Connections", result.links.length],
                  ["Instruments", result.stats.instruments ?? 0],
                  ["Pipe segments", result.stats.pipeSegments],
                  ["Pipe runs (colour)", result.stats.colorRuns],
                  ["Seconds", result.stats.elapsedSeconds],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="pid-import__stat">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pid-import__sheet">
            {image && <img src={image} alt="The drawing" />}
            {result && (
              <svg
                viewBox={result.viewBox}
                aria-label="What was read from the drawing"
                preserveAspectRatio={placed ? "none" : undefined}
                style={placed}
                className={placed ? "pid-import__read" : undefined}
              >
                {/* the digital drawing: every line in its own colour, hairline */}
                {(result.lines ?? []).map((l, i) => (
                  <polyline
                    key={`l${i}`}
                    points={l.points.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={0.7}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {result.colorRuns.map((run, i) => (
                  <polyline
                    key={i}
                    points={run.points.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={run.color}
                    strokeWidth={r * 0.8}
                    strokeLinecap="round"
                  />
                ))}
                {result.colorRuns.length === 0 &&
                  result.edges.map((e, i) => (
                    <polyline key={i} points={e.route.map((p) => p.join(",")).join(" ")} fill="none" stroke="#2563eb" strokeWidth={r * 0.6} />
                  ))}
                {result.links.map(([a, b]) => {
                  const p = at.get(a);
                  const q = at.get(b);
                  return p && q ? (
                    <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#7c3aed" strokeWidth={r * 0.5} strokeDasharray={`${r * 1.5} ${r}`} />
                  ) : null;
                })}
                {components.map((n) => (
                  <g key={n.id}>
                    <circle cx={n.x} cy={n.y} r={r * 1.6} fill="#7c3aed" stroke="#fff" strokeWidth={r * 0.4} />
                    <text x={n.x + r * 2.2} y={n.y + r} fontSize={r * 4} fontWeight={700} fill="#4c1d95">
                      {n.label}
                    </text>
                  </g>
                ))}
              </svg>
            )}
            {image && (selecting || shown) && (
              <svg
                className={selecting ? "pid-import__area pid-import__area--on" : "pid-import__area"}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-label={selecting ? "Drag a rectangle over the part to read" : "The area read"}
                onPointerDown={selecting ? startArea : undefined}
              >
                {shown && (
                  <>
                    {/* everything outside the area is dimmed */}
                    <path d={`M0,0H1V1H0Z M${shown[0]},${shown[1]}V${shown[3]}H${shown[2]}V${shown[1]}Z`} fillRule="evenodd" fill="rgb(0 0 0 / 0.35)" />
                    <rect
                      x={shown[0]}
                      y={shown[1]}
                      width={shown[2] - shown[0]}
                      height={shown[3] - shown[1]}
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      strokeDasharray={draft ? "6 4" : undefined}
                    />
                  </>
                )}
              </svg>
            )}
          </div>
          {result && components.length > 0 && (
            <div className="pid-import__list">
              <strong>Components:</strong> {components.map((c) => c.label).join(", ")}
              <br />
              <strong>Connected by pipe:</strong>{" "}
              {result.links.length ? result.links.map(([a, b]) => `${at.get(a)?.label} – ${at.get(b)?.label}`).join(", ") : "none traced"}
              <div className="pid-hint">
                After "Use as the P&ID", assign your variables to these components on the Physical structure page and let the pipe connections suggest causal
                links.
              </div>
            </div>
          )}
          {result && result.warnings.length > 0 && (
            <ul className="pid-import__warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
