/**
 * The log of changes made on the Physical structure page, newest first, in the side panel: groups made, variables
 * deleted or added, kinds marked, placements and links, each by "AI" (the assistant over MCP) or "you". Kept per
 * data center in this browser (notes.ts), so what the assistant did can be read afterwards.
 */
import { fmtTime } from "../../../lib/format";
import type { Change } from "./notes";

export function ChangesBox({ log, onClear }: { log: Change[]; onClear: () => void }) {
  const ai = log.filter((c) => c.by === "AI").length;
  return (
    <details className="pid-changes" open>
      <summary>
        <span className="caps">Changes</span> <span className="pid-muted">{log.length ? `${log.length} (${ai} by AI)` : "none yet"}</span>
      </summary>
      {log.length > 0 && (
        <>
          <ol className="pid-changes__list" aria-label="Changes on this page">
            {log.map((c) => (
              <li key={`${c.at}-${c.text}`}>
                <span className={c.by === "AI" ? "pid-changes__by pid-changes__by--ai" : "pid-changes__by"}>{c.by}</span>
                <span className="pid-muted">{fmtTime(c.at)}</span> {c.text}
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClear}>
            Clear the log
          </button>
        </>
      )}
    </details>
  );
}
