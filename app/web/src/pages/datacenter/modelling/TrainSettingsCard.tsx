/** Training settings (the Data-driven column's panel, and Train for every kind): model kinds, structures, causal graph, max lag, train/test split, and the Train button. */
import type { DatasetInfo } from "../../../api";
import { KINDS, STRUCTS } from "../../../lib/modelCatalog";
import { Field } from "../../../ui/Field";
import { duration, estimateText, type TrainingEstimate } from "./estimate";
import { splitDate, toggle } from "./inputs";

/** A captioned row of checkboxes, one per option. */
function CheckGroup({ title, items, list, onChange }: { title: string; items: { id: string; label: string }[]; list: string[]; onChange: (l: string[]) => void }) {
  return (
    <div role="group" aria-label={title} className="field-label">
      <span className="caps">{title}</span>
      <div className="train-checks">
        {items.map((it) => (
          <label key={it.id}>
            <input type="checkbox" checked={list.includes(it.id)} onChange={() => onChange(toggle(list, it.id))} />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function TrainSettingsCard(props: {
  dataset: DatasetInfo | null;
  kinds: string[];
  onKinds: (l: string[]) => void;
  structures: string[];
  onStructures: (l: string[]) => void;
  graphFiles: string[];
  graphFile: string;
  onGraphFile: (f: string) => void;
  maxLag: number;
  onMaxLag: (n: number) => void;
  split: number;
  onSplit: (x: number) => void;
  count: number; // models that Train would train
  estimate: TrainingEstimate | null; // how long Train would take (null: not known yet)
  busy: boolean;
  onTrain: () => void;
}) {
  const { dataset, split, count } = props;
  return (
    <div className="train-settings">
      <CheckGroup title="Model" items={KINDS} list={props.kinds} onChange={props.onKinds} />
      <CheckGroup title="Structure" items={STRUCTS} list={props.structures} onChange={props.onStructures} />
      <Field label="Causal graph">
        <select className="field" value={props.graphFile} onChange={(e) => props.onGraphFile(e.target.value)}>
          {(props.graphFiles.length ? props.graphFiles : [props.graphFile]).map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      <Field label="Max lag (all vs all)">
        <input
          className="field train-settings__lag"
          type="number"
          min={1}
          max={48}
          value={props.maxLag}
          onChange={(e) => props.onMaxLag(Math.max(1, Math.min(48, Number(e.target.value) || 1)))}
        />
      </Field>
      <Field label={`Train until ${dataset ? splitDate(dataset.time_range, split) : ""} (${Math.round(split * 100)}%)`}>
        <input type="range" className="train-settings__split" min={0.1} max={0.9} step={0.01} value={split} onChange={(e) => props.onSplit(Number(e.target.value))} />
      </Field>
      <button type="button" className="btn btn--primary train-settings__train" onClick={props.onTrain} disabled={props.busy || !dataset || !count}>
        {props.busy ? "Training… (symbolic regression and TabPFN take a few minutes)" : `Train ${count} model${count === 1 ? "" : "s"}`}
      </button>
      {props.estimate && (
        <p
          className="train-settings__estimate"
          role="status"
          title={props.estimate.parts.map((p) => `${p.label}: ${p.models} models, about ${duration(p.seconds)}`).join("\n")}
        >
          {estimateText(props.estimate)}
          {props.estimate.parts[0] && props.estimate.parts[0].seconds > 30 && <span className="muted"> · mostly {props.estimate.parts[0].label}</span>}
          {props.estimate.problems.map((p) => (
            <span key={p} className="train-settings__problem">
              {p}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
