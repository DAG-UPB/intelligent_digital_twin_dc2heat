/**
 * Side panel for the selected variable: its ISA tag, its own-past lags, and chips for the links into and out of it
 * (a chip selects that link; red = lag discovery found no evidence). The lags field commits on blur or Enter.
 * Delete variable: a variable without data leaves the drawing, a prepared one also its column in silver; delivered
 * data (bronze) cannot be deleted. A group (a variable marked as standing for several, notes.ts) lists its members and
 * can be ungrouped; a member names its groups.
 */
import type { PidGroup } from "../../../api";
import { keyOf, parseLags, type Link } from "./links";

export type VariableKind = "delivered" | "prepared" | "column" | "none";
const ABOUT: Record<VariableKind, string> = {
  delivered: "Delivered data (bronze): always on the drawing, cannot be deleted.",
  prepared: "New: prepared on the Dashboard, its column is kept in silver.",
  column: "Data of this data center, on this drawing by choice: Delete takes it off the drawing, the data stays.",
  none: "New: no data yet, only on the drawing. It can be linked, not trained.",
};

interface Props {
  v: string;
  tag: string;
  kind: VariableKind;
  selfLags: number[];
  crossLinks: Link[];
  noEvidence: Set<string>;
  onTag: (tag: string) => void;
  onSelfLags: (lags: number[]) => void;
  onSelectLink: (key: string) => void;
  onDelete: () => void;
  group?: PidGroup | null; // v stands for these variables
  inGroups?: string[]; // the groups v is a member of
  onUngroup?: () => void;
  shownName?: string; // the name shown in place of v (its own name when none is given)
  onRename?: (name: string) => void; // "" gives it its own name back
}

export function VariableInspector(p: Props) {
  const { v, tag, kind, selfLags, crossLinks, noEvidence, onTag, onSelfLags, onSelectLink, onDelete, group, inGroups = [] } = p;
  const shown = selfLags.join(",");
  return (
    <>
      <strong>{p.shownName ?? v}</strong>
      {p.shownName && p.shownName !== v && (
        <span className="pid-muted mono" style={{ fontSize: 11, overflowWrap: "anywhere" }} title="Its own name, as in the data">
          {v}
        </span>
      )}
      {p.onRename && (
        <label className="pid-stack">
          Name shown (the data keeps its own)
          <input
            key={`name-${v}-${p.shownName}`}
            className="field field--sm"
            defaultValue={p.shownName && p.shownName !== v ? p.shownName : ""}
            placeholder={v}
            maxLength={80}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => e.target.value.trim() !== (p.shownName === v ? "" : (p.shownName ?? "")) && p.onRename?.(e.target.value.trim())}
          />
        </label>
      )}
      <span className="pid-muted" style={{ fontSize: 12 }}>
        {group ? `A group: the ${group.method} of ${group.members.length} variables. Only a mark, no values are computed.` : ABOUT[kind]}
      </span>
      {group && (
        <div className="pid-stack" style={{ fontSize: 12 }}>
          <span className="pid-muted">Members</span>
          <span className="mono" style={{ overflowWrap: "anywhere" }}>
            {group.members.join(", ")}
          </span>
          <button type="button" className="btn btn--sm" onClick={p.onUngroup}>
            Ungroup
          </button>
        </div>
      )}
      {inGroups.length > 0 && (
        <span className="pid-muted" style={{ fontSize: 12 }}>
          In the group {inGroups.join(", ")}
        </span>
      )}
      <label className="pid-stack">
        ISA tag
        <input className="field field--sm" value={tag} maxLength={5} onChange={(e) => onTag(e.target.value.toUpperCase())} />
      </label>
      <label className="pid-stack">
        Depends on its own past: lags (e.g. 1,2)
        <input
          // uncontrolled, re-keyed when the lags change elsewhere: an empty value removes the self-link on commit
          key={`self-${v}-${shown}`}
          className="field field--sm"
          defaultValue={shown}
          placeholder="none"
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => onSelfLags(parseLags(e.target.value))}
        />
      </label>
      {(["in", "out"] as const).map((dir) => {
        const ls = crossLinks.filter((l) => (dir === "in" ? l.to : l.from) === v);
        return (
          <div key={dir} style={{ fontSize: 12 }}>
            <div className="pid-muted" style={{ marginBottom: 4 }}>
              {dir === "in" ? "Influenced by" : "Influences"}
            </div>
            <div className="pid-chips">
              {ls.length === 0 && <span className="pid-faint">none</span>}
              {ls.map((l) => (
                <button
                  key={keyOf(l)}
                  type="button"
                  className={`pid-chip${noEvidence.has(keyOf(l)) ? " pid-chip--warn" : ""}`}
                  onClick={() => onSelectLink(keyOf(l))}
                >
                  {dir === "in" ? l.from : l.to} · lag {l.lags.join(",")}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {kind !== "delivered" && (
        <button type="button" className="btn pid-delete" onClick={onDelete}>
          Delete variable
        </button>
      )}
    </>
  );
}
