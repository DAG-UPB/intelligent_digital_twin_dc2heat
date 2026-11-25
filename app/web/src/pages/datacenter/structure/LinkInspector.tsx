/**
 * Side panel for the selected link: its lags (commit on blur or Enter; an empty value is ignored), the strength of
 * each drawn lag when lag discovery or the graph file gave one, and Delete link.
 */
import type { CausalLinkStrength } from "../../../api";
import { fmt } from "../../../lib/format";
import { parseLags, type Link } from "./links";

interface Props {
  link: Link;
  strengths: CausalLinkStrength[];
  onLags: (lags: number[]) => void;
  onDelete: () => void;
}

export function LinkInspector({ link, strengths, onLags, onDelete }: Props) {
  const shown = link.lags.join(",");
  const known = link.lags
    .map((lag) => ({ lag, s: strengths.find((s) => s.source === link.from && s.target === link.to && Math.abs(s.lag) === lag) }))
    .filter((x) => x.s);
  return (
    <>
      <strong>
        {link.from} → {link.to}
      </strong>
      <label className="pid-stack">
        Lags, steps back (e.g. 1,3; 0 = same hour)
        <input
          key={`lags-${link.from}-${link.to}-${shown}`}
          className="field field--sm"
          defaultValue={shown}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const lags = parseLags(e.target.value);
            if (lags.length) onLags(lags);
          }}
        />
      </label>
      {known.length > 0 && (
        <span className="pid-muted" data-testid="link-strengths">
          Strength (partial correlation): {known.map(({ lag, s }) => `lag ${lag}: ${fmt(s!.value, 2)}`).join(", ")}
        </span>
      )}
      <button type="button" className="btn pid-delete" onClick={onDelete}>
        Delete link
      </button>
    </>
  );
}
