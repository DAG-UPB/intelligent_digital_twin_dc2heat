/** What-if panel: model box, then either the scenario setup or the running scenario's stepper. Keeps the setup between runs. */
import { useState } from "react";
import type { TrainedModel } from "../../../../api";
import { ModelPrepareBox } from "./ModelPrepareBox";
import { ScenarioSetup } from "./ScenarioSetup";
import { ScenarioStepper } from "./ScenarioStepper";
import type { WhatIfConfig } from "./whatIf";

interface Props {
  columns: string[];
  playheadIndex: number;
  totalPoints: number;
  model: TrainedModel | null | undefined;
  preparing: boolean;
  onPrepare: (split: number) => void;
  active: boolean;
  loading: boolean;
  currentStep: number;
  totalSteps: number;
  onActivate: (config: WhatIfConfig) => void;
  onDeactivate: () => void;
  onStep: () => void;
  /** The intervention variables, picked on the page (WhatIfCard's list, in the panel on the left when `side`). */
  chosen: string[];
  side: boolean;
}

export function WhatIfPanel({ columns, playheadIndex, totalPoints, model, preparing, onPrepare, active, loading, currentStep, totalSteps, onActivate, onDeactivate, onStep, chosen: all, side }: Props) {
  const chosen = all.filter((c) => columns.includes(c));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState(20);

  const run = () => {
    const parsed: Record<string, number> = {};
    for (const col of chosen) {
      const n = parseFloat(overrides[col] ?? "");
      if (!isNaN(n)) parsed[col] = n; // empty = ground truth; a variable taken off keeps its value for when it comes back
    }
    onActivate({ futureKnownVars: chosen, overrides: parsed, steps });
  };

  return (
    <section className="whatif" aria-label="What-If Scenario">
      <div className="whatif__head">
        <span className="whatif__title">
          What-If Scenario
          {active && (
            <span className="pill pill--warn pill--sm whatif__active">
              <span className="pill__dot" />
              Active
            </span>
          )}
        </span>
        {active && (
          <button type="button" className="btn btn--danger btn--sm whatif__exit" onClick={onDeactivate}>
            Exit What-If
          </button>
        )}
      </div>

      <ModelPrepareBox model={model} preparing={preparing} onPrepare={onPrepare} />

      {active ? (
        <ScenarioStepper step={currentStep} total={totalSteps} loading={loading} onStep={onStep} />
      ) : (
        <ScenarioSetup
          playheadIndex={playheadIndex}
          totalPoints={totalPoints}
          steps={steps}
          onSteps={setSteps}
          chosen={chosen}
          side={side}
          overrides={overrides}
          onOverride={(col, v) => setOverrides((o) => ({ ...o, [col]: v }))}
          onRun={run}
        />
      )}
    </section>
  );
}
