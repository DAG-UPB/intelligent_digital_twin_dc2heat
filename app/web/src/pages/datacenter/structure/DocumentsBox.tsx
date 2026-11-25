/**
 * The data center's documents in the side panel of Physical structure: whatever you know about its physical
 * structure (descriptions, equipment and sensor lists, schematics; any file), kept as it is, with a note of what it
 * holds and the view of the P&ID it is about. The app does not open them: an assistant reads them with its own tools
 * to build the constructs and the causal links, and can keep its own there. Each is written at once to the data
 * center's silver folder; a replaced or removed one is backed up first.
 */
import { useEffect, useState } from "react";
import { documentUrl, fetchDocuments, removeDocument, setDocumentInfo, uploadDocument, type DataCenterDocument } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { fmt } from "../../../lib/format";
import type { PidView } from "./views";

const size = (b: number) => (b < 1024 ? `${b} B` : b < 2 ** 20 ? `${Math.round(b / 1024)} kB` : `${fmt(b / 2 ** 20, 1)} MB`);

interface Props {
  views: PidView[]; // a document can be about one of them
  onStatus: (s: string) => void;
  onChange: (docs: DataCenterDocument[]) => void;
}

function ViewSelect({ views, value, onChange, label }: { views: PidView[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="field field--sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">whole data center</option>
      {views.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
      {value && !views.some((v) => v.id === value) && <option value={value}>{value} (no such view)</option>}
    </select>
  );
}

export function DocumentsBox({ views, onStatus, onChange }: Props) {
  const [docs, setDocs] = useState<DataCenterDocument[]>([]);
  const [note, setNote] = useState("");
  const [view, setView] = useState("");
  const load = () =>
    fetchDocuments(DATASET)
      .then((r) => {
        setDocs(r.documents);
        onChange(r.documents);
      })
      .catch((e) => onStatus(errorMessage(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);
  const upload = async (file: File) => {
    try {
      const r = await uploadDocument(DATASET, file, note.trim(), view);
      setNote("");
      onStatus(`Kept ${r.name}${r.backup ? " (the older one is backed up)" : ""}: an assistant can read it now.`);
      await load();
    } catch (e) {
      onStatus(errorMessage(e));
    }
  };
  const describe = (d: DataCenterDocument, next: { note?: string; view?: string }) =>
    setDocumentInfo(DATASET, d.name, next.note ?? d.note, next.view ?? d.view)
      .then(load)
      .catch((e) => onStatus(errorMessage(e)));
  return (
    <details className="pid-changes" open={docs.length > 0}>
      <summary>
        <span className="caps">Documents</span> <span className="pid-muted">{docs.length || "none yet"}</span>
      </summary>
      <div className="pid-stack" style={{ fontSize: 12, marginTop: 6 }}>
        <span className="pid-muted">
          What you know about the physical structure, any file: kept as it is, for an assistant to build the constructs and links.
        </span>
        <input
          className="field field--sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="What it holds (optional)"
          aria-label="Note for the next document"
        />
        <ViewSelect views={views} value={view} onChange={setView} label="The next document is about" />
        <label className="btn btn--sm">
          Add a document…
          <input
            type="file"
            hidden
            aria-label="Add a document"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
        {docs.length > 0 && (
          <ul className="pid-views" aria-label="Documents of the data center">
            {docs.map((d) => (
              <li key={d.name}>
                <a
                  className="mono"
                  style={{ flex: 1, overflowWrap: "anywhere" }}
                  href={documentUrl(DATASET, d.name)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${size(d.bytes)}, ${d.modified.replace("T", " ")}: open it`}
                >
                  {d.name}
                </a>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  aria-label={`Remove the document ${d.name}`}
                  onClick={() =>
                    window.confirm(`Remove ${d.name}? It is backed up first.`) &&
                    removeDocument(DATASET, d.name)
                      .then(load)
                      .catch((e) => onStatus(errorMessage(e)))
                  }
                >
                  ✕
                </button>
                <input
                  className="field field--sm"
                  style={{ flexBasis: "100%" }}
                  defaultValue={d.note}
                  key={`${d.name}-${d.note}`}
                  placeholder="What it holds"
                  aria-label={`Note of ${d.name}`}
                  maxLength={500}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  onBlur={(e) => e.target.value.trim() !== d.note && describe(d, { note: e.target.value.trim() })}
                />
                <ViewSelect views={views} value={d.view} onChange={(v) => describe(d, { view: v })} label={`${d.name} is about`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
