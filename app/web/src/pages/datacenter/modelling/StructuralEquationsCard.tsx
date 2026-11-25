/**
 * Structural equations: the winning model's equation for each predicted variable, and the fitted physics/symbolic
 * alternatives. A small box in the side column that scrolls on its own; the variable picked (in the results table, the
 * columns, on the graph or the drawing) is marked, its equations whole (the others cut to a few lines that scroll in
 * themselves), and scrolled into view inside it, the page left where it is.
 */
import { useEffect, useRef } from "react";
import type { EvaluateResponse, TrainedModel } from "../../../api";
import { TAG } from "../../../lib/modelCatalog";
import { equation, learnedText, pct } from "./format";
import type { VariableRanking } from "./ranking";

/** Learned coefficients of a physics equation, by name. */
function Learned({ params }: { params?: Record<string, number> }) {
  if (!params || !Object.keys(params).length) return null;
  return <div className="train-struct__learned">learned: {learnedText(params)}</div>;
}

const ALTERNATIVES = [
  { name: "phys", kind: "physics", title: "Your physics equation, fitted" },
  { name: "sym", kind: "symbolic", title: "Found by symbolic regression" },
] as const;

const ABOUT =
  "Linear regression: the equation with its coefficients, largest effects first. Physics: your equation with the learned coefficients filled in. Symbolic regression: the formula it found, simplified. XGBoost and TabPFN are black boxes: only which variables and lags they use.";

export function StructuralEquationsCard({
  predicted,
  ranking,
  models,
  evalRes,
  selected,
}: {
  predicted: string[];
  ranking: Record<string, VariableRanking>;
  models: Record<string, TrainedModel>;
  evalRes: EvaluateResponse | null;
  selected: string | null;
}) {
  const list = useRef<HTMLDivElement>(null);
  // the picked one to the top of the box: scrolled inside it only (scrollIntoView would move the page too)
  useEffect(() => {
    const box = list.current;
    const el = selected && box?.querySelector<HTMLElement>(`[data-var="${CSS.escape(selected)}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop, behavior: "smooth" });
  }, [selected]);
  return (
    <section className="card train-struct" aria-label="Structural equations">
      <div className="caps train-card__title" title={ABOUT}>
        Structural equations · best model per variable
      </div>
      <div className="train-struct__list" ref={list}>
        {predicted.map((v) => {
          const w = ranking[v]?.winner;
          if (!w) return null;
          return (
            <div key={v} data-var={v} className={`train-struct__var${v === selected ? " train-struct__var--picked" : ""}`}>
              <div className="train-struct__head">
                <strong>{v}</strong>
                <span style={{ color: w.def.color, fontWeight: 600 }}>{w.def.label}</span>
                <span className="train-struct__free">free run {pct(w.free)}</span>
              </div>
              <code className="train-struct__eq">{equation(v, models[w.def.name])}</code>
              {w.def.kind === "physics" && <Learned params={models[w.def.name].variables[v].params} />}
              {ALTERNATIVES.filter((a) => a.name !== w.def.name && models[a.name]?.variables[v]?.equation).map((a) => (
                <div key={a.name} style={{ color: TAG[a.kind].fg }}>
                  <div className="train-struct__alt">
                    {a.title} · free run {pct(evalRes?.models[a.name]?.free_nmae[v])}
                  </div>
                  <code className="train-struct__eq train-struct__eq--alt">{equation(v, models[a.name])}</code>
                  {a.kind === "physics" && <Learned params={models[a.name].variables[v].params} />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
