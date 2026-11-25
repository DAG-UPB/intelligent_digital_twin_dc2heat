/**
 * Prepare variables: combine or transform variables into new ones (backend/core/prepare.py). Pick an operation,
 * the variables and its settings, preview the result, then create it: it is written next to the data (silver),
 * never into it, and is then a variable like the others. The prepared ones are listed with what they are made of.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { addPrepared, previewPrepared, removePrepared, type PreparedChange, type PreparedPreview, type PreparedStep, type VariableSummary } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { Field } from "../../../ui/Field";
import { Kpi } from "../../../ui/Kpi";
import { themedAxis, useUplot } from "../../../ui/LineChart";
import { compact, unixSeconds } from "./dashboard";
import { cleanStep, defaultName, initialParams, notReady, operation, OPERATIONS } from "./prepare";

const GROUPS = ["Combine", "Transform", "Time", "Formula"] as const;

function PreviewChart({ p }: { p: PreparedPreview }) {
  const xs = useMemo(() => unixSeconds(p.time), [p]);
  const { el } = useUplot(
    (width) => ({
      opts: {
        width,
        height: 140,
        scales: { x: { time: true } },
        legend: { show: true },
        axes: [themedAxis(), themedAxis({ size: 60, values: (_u, ticks) => ticks.map((t) => compact(t)) })],
        series: [{}, { label: p.name, stroke: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), width: 1.5, value: (_u, x) => compact(x) }],
      },
      data: [xs, p.values as number[]],
    }),
    [xs, p],
  );
  return <div ref={el} className="dash-series__chart" role="img" aria-label={`${p.name} over time (preview)`} />;
}

const describeStep = (s: PreparedStep) => {
  const o = operation(s.op);
  const settings = Object.entries(s.params)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return `${o.label}${s.inputs.length ? ` of ${s.inputs.join(", ")}` : ""}${settings ? ` (${settings})` : ""}`;
};

export function PrepareVariables({
  variables,
  recipe,
  draft,
  onChanged,
}: {
  variables: VariableSummary[];
  recipe: PreparedStep[];
  draft: PreparedStep | null; // a recommendation's step, to start from
  onChanged: () => void;
}) {
  const names = variables.map((v) => v.name);
  const [op, setOp] = useState("mean");
  const [inputs, setInputs] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, unknown>>(initialParams("mean"));
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false); // the user typed a name: stop proposing one
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PreparedChange | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // a recommendation's "Prepare" fills the form
  useEffect(() => {
    if (!draft) return;
    setOp(draft.op);
    setInputs(draft.inputs);
    setParams({ ...initialParams(draft.op), ...draft.params });
    setName(draft.name);
    setNamed(true);
    setPreview(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft]);

  const o = operation(op);
  const proposed = defaultName(op, inputs, names);
  const step = cleanStep({ name: named ? name : proposed, op, inputs, params });
  const blocked = notReady(step);

  const pickOp = (id: string) => {
    setOp(id);
    setParams(initialParams(id));
    const most = operation(id).inputs[1];
    if (most !== null) setInputs((xs) => xs.slice(0, most));
    setPreview(null);
  };
  const toggle = (v: string) => {
    setPreview(null);
    setInputs((xs) => (xs.includes(v) ? xs.filter((x) => x !== v) : o.inputs[1] === 1 ? [v] : [...xs, v]));
  };

  const run = async (what: "preview" | "create") => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (what === "preview") setPreview(await previewPrepared(DATASET, step));
      else {
        setDone(await addPrepared(DATASET, step));
        setPreview(null);
        setNamed(false);
        onChanged();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: string) => {
    setError(null);
    try {
      setDone(await removePrepared(DATASET, n));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="dash-prep" ref={top}>
      <div className="dash-prep__row">
        <Field label="Operation">
          <select className="field field--sm" value={op} onChange={(e) => pickOp(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {OPERATIONS.filter((x) => x.group === g).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {o.params.map((p) => (
          <Field key={p.key} label={p.label}>
            {p.kind === "choice" ? (
              <select className="field field--sm" value={String(params[p.key] ?? "")} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}>
                {p.options!.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            ) : (
              <input
                className={`field field--sm${p.kind === "text" ? " dash-prep__formula" : ""}`}
                type={p.kind === "number" ? "number" : "text"}
                value={params[p.key] == null ? "" : String(params[p.key])}
                placeholder={p.kind === "text" ? "A[t] + 0.5 * B[t-1]" : "none"}
                onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}
                spellCheck={false}
              />
            )}
          </Field>
        ))}
        <Field label="New variable">
          <input
            className="field field--sm"
            value={named ? name : proposed}
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
            spellCheck={false}
          />
        </Field>
      </div>
      <p className="muted dash__note">{o.about}</p>

      {o.inputs[1] !== 0 && (
        <div className="chips" role="group" aria-label="Variables to use">
          {names.map((v) => (
            <button key={v} type="button" className={inputs.includes(v) ? "chip chip--on" : "chip"} aria-pressed={inputs.includes(v)} onClick={() => toggle(v)}>
              {o.group === "Combine" && o.inputs[1] === 2 && inputs.includes(v) ? `${"AB"[inputs.indexOf(v)] ?? ""} · ${v}` : v}
            </button>
          ))}
        </div>
      )}

      <div className="dash-prep__actions">
        <button type="button" className="btn btn--pill" disabled={!!blocked || busy} onClick={() => run("preview")}>
          Preview
        </button>
        <button type="button" className="btn btn--pill btn--primary" disabled={!!blocked || busy} onClick={() => run("create")}>
          Create {step.name || "variable"}
        </button>
        {blocked && <span className="muted dash__note">{blocked}</span>}
      </div>
      <ErrorBanner error={error} />
      {done && (
        <p className="dash-prep__done" role="status">
          {done.did[0].toUpperCase() + done.did.slice(1)}. Saved in your data folder: {done.files.join(", ")}. The data as delivered is unchanged.
        </p>
      )}

      {preview && (
        <div className="dash-prep__preview">
          <div className="dash__kpis">
            <Kpi label="Values" value={String(preview.count)} sub={preview.missing ? `${preview.missing} empty` : "none empty"} />
            <Kpi label="Mean" value={compact(preview.mean)} sub={`std ${compact(preview.std)}`} />
            <Kpi label="Range" value={`${compact(preview.min)} … ${compact(preview.max)}`} />
          </div>
          <PreviewChart p={preview} />
        </div>
      )}

      {recipe.length > 0 && (
        <div className="dash-prep__list">
          <h3 className="caps">Prepared variables ({recipe.length})</h3>
          <ul>
            {recipe.map((s) => (
              <li key={s.name}>
                <span className="mono">{s.name}</span> <span className="muted">= {describeStep(s)}</span>
                <button type="button" className="btn btn--pill btn--ghost" onClick={() => remove(s.name)} aria-label={`Remove ${s.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
