/**
 * The Dashboard's Scenarios mode (formerly Data Center > Scenarios, #/dc/scenarios): two modes over the trained 'linear' model (step-through replay with
 * what-if, and a Monte Carlo test-period simulation). The variable picked in the Dashboard's causal graph, on its left,
 * becomes the intervention.
 */
import { useMemo, type ReactNode } from "react";
import { useKept } from "../../../lib/kept";
import type { StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { useHexView } from "../shared/useHexView";
import TestPeriodPage from "./simulation/TestPeriodPage";
import StepThroughPage from "./step/StepThroughPage";
import { useScenarioModel } from "./useScenarioModel";
import type { Picked } from "../shared/focus";
import type { SeriesPeriod } from "../dashboard/seriesPeriod";
import "./scenarios.css";

const MODES = [
  { id: "step", label: "Step-through (replay)" },
  { id: "year", label: "Long period simulation" },
] as const;

/** `picked`: the variable picked in the causal graph of the page it is embedded in (the Dashboard in Scenarios mode).
 * `hide`: the columns that are not the part's (the heat distribution's or the district's page): left out of the
 * signals and interventions, in place of the data center's other HEX option. `levers`: the intervention variables
 * picked on the page (WhatIfCard); `side`: the panel on the left, where the replay's variables are picked; `period`
 * and `periodPick`: the page's year and month (Historical's too), shown over them; the replay moves to it;
 * `controls`: where the replay's buttons go (the band under the page's KPIs). */
export default function ScenariosPage(p: { picked: Picked | null; scope?: StructureScope; hide?: Set<string>; levers: string[];
  side?: HTMLElement | null;
  period?: SeriesPeriod;
  periodPick?: ReactNode;
  controls?: HTMLElement | null;
}) {
  const { picked, scope, hide } = p;
  const [mode, setMode] = useKept<(typeof MODES)[number]["id"]>(`${scope}-scenarios-mode`, "step");
  const [model, setModel] = useScenarioModel(DATASET, scope);
  const hexView = useHexView(); // the signals and the interventions show the selected HEX's variables only
  const view = useMemo(() => (hexView && hide ? { ...hexView, hidden: hide } : hexView), [hexView, hide]);

  return (
    <div className="scenarios">
      <div role="tablist" aria-label="Scenario mode" className="segmented scenarios__tabs">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="scenarios__body">
        {/* Both stay mounted so switching keeps each mode's state. */}
        <div className="scenarios__mode" role="tabpanel" hidden={mode !== "step"}>
          <StepThroughPage picked={picked} model={model} onModel={setModel} view={view} scope={scope} levers={p.levers} side={p.side} period={p.period} periodPick={p.periodPick} controls={p.controls} />
        </div>
        <div className="scenarios__mode" role="tabpanel" hidden={mode !== "year"}>
          <TestPeriodPage picked={picked} model={model} view={view} scope={scope} />
        </div>
      </div>
    </div>
  );
}
