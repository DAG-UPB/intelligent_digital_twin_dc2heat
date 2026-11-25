/** What-if model box: is the 'linear' model ready, and re-train it with another train split (other settings are kept). */
import { useState } from "react";
import type { TrainedModel } from "../../../../api";
import { fmt } from "../../../../lib/format";
import { Field } from "../../../../ui/Field";
import { splitOf } from "./whatIf";

interface Props {
  model: TrainedModel | null | undefined;
  preparing: boolean;
  onPrepare: (split: number) => void;
}

export function ModelPrepareBox({ model, preparing, onPrepare }: Props) {
  const [typed, setTyped] = useState<number | null>(null); // null: show the saved model's split
  const split = typed ?? splitOf(model);
  return (
    <div className="whatif__box">
      <div className="caps">{model ? "Model Configuration" : "Model Preparation"}</div>
      {model && (
        <div className="whatif__ready">
          <b>Ready</b> · linear regression on graph parents · {fmt(model.split_index)} train / {fmt(model.rows - model.split_index)} test rows
        </div>
      )}
      <div className="whatif__form">
        <Field label="Train split">
          <input className="field whatif__split" type="number" min={0.1} max={0.9} step={0.05} value={split} onChange={(e) => setTyped(Number(e.target.value))} />
        </Field>
        <Field label="Model">
          <select className="field">
            <option>Linear Regression</option>
          </select>
        </Field>
        <button type="button" className="btn" onClick={() => onPrepare(split)} disabled={preparing}>
          {preparing ? "Training…" : model ? "Re-prepare" : "Prepare Models"}
        </button>
      </div>
    </div>
  );
}
