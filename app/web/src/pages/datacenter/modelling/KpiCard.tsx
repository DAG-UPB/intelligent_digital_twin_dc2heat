/**
 * Modelling › KPI variables (the data center's, in the sidebar under the Connection points): which variables are the
 * IT power, the cooling power, the facility's other power (then PUE is the full one), the reused heat and the heat
 * demand, and which KPI each feeds. It shows what the KPIs
 * use now (the summary's kpi_columns, defaults included) and saves dataset.json "kpi" at once, like the Dashboard's
 * Choose the KPI variables (the same store and formulas). Folded at first, its title saying what PUE uses; open or
 * closed is remembered in this browser.
 */
import { useEffect, useState } from "react";
import { fetchSummary, saveKpiMapping, type DatasetInfo, type KpiMapping } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { Field } from "../../../ui/Field";
import { InfoMark } from "../../../ui/InfoMark";
import type { KpiColumns } from "../dashboard/whatIf";
import { draftOf, kpiFormulas, mappingToSave } from "./kpiVariables";

const SINGLE: { key: "it_power" | "cooling_power" | "heat_demand"; label: string }[] = [
  { key: "it_power", label: "IT power" },
  { key: "cooling_power", label: "Cooling power" },
  { key: "heat_demand", label: "Heat demand" },
];
const OTHER_HINT = "UPS and distribution losses, lighting, building: with it PUE is the full one";
const OPEN_KEY = "kpi-variables-open"; // the fold: "1" open, "0" closed

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false; // storage off: closed, not remembered
  }
};

export function KpiCard({ dataset }: { dataset: DatasetInfo }) {
  const [vars, setVars] = useState<string[]>([]);
  const [cols, setCols] = useState<KpiColumns | null>(null);
  const [m, setM] = useState<KpiMapping | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const toggled = (on: boolean) => {
    setOpen(on);
    try {
      localStorage.setItem(OPEN_KEY, on ? "1" : "0");
    } catch {
      /* not remembered */
    }
  };
  useEffect(() => {
    let live = true;
    fetchSummary(DATASET)
      .then((s) => {
        if (!live) return;
        if (!s.kpi_columns) return setStatus("This data file has no KPI variables.");
        setVars(s.variables.map((v) => v.name));
        setCols(s.kpi_columns);
        setM(draftOf(s.kpi_columns));
      })
      .catch((e) => live && setStatus(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);
  const heat = m?.heat_power ?? [];
  const other = m?.other_power ?? [];
  const select = (label: string, value: string | null | undefined, onChange: (v: string | null) => void, none = "— none —") => (
    <select key={label} className="field field--sm" aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>
      {vars.map((v) => (
        <option key={v}>{v}</option>
      ))}
    </select>
  );
  // one select per summed variable and an empty one to add another: a list of every variable is too long here
  const summed = (key: "heat_power" | "other_power", list: string[], name: string, add: string) =>
    [...list, ""].map((h, i) =>
      select(
        h ? `${name} ${i + 1}` : add,
        h,
        (v) => setM((cur) => cur && { ...cur, [key]: [...new Set([...list.slice(0, i), ...(v ? [v] : []), ...list.slice(i + 1)])] }),
        h ? "— none —" : "+ add",
      ),
    );

  const save = async () => {
    if (!m || !cols) return;
    setBusy(true);
    try {
      await saveKpiMapping(DATASET, mappingToSave(m, cols, (dataset.config?.kpi ?? {}) as KpiMapping));
      setStatus("Saved: the KPIs are computed from these.");
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // the folded title's line: what PUE is computed from now
  const pue = m && kpiFormulas(m)[0];
  const line = !m ? (status ?? "Loading…") : pue?.formula ? `PUE = ${pue.formula}` : `PUE needs ${pue?.missing.join(", ")}`;

  return (
    <section className="card ports kpi-vars" aria-label="KPI variables">
      <details className="kpi-vars__fold" open={open} onToggle={(e) => toggled(e.currentTarget.open)}>
        <summary className="ports__title">
          <span className="caps">KPI variables · what PUE, ERF and ERE use</span>
          <span className="mono kpi-vars__line" title={line}>
            {line}
          </span>
        </summary>
        <div className="kpi-vars__body">
          {!m ? (
            <p className="muted">{status ?? "Loading…"}</p>
          ) : (
            <>
              {SINGLE.map((f) => (
                <Field key={f.key} label={f.label}>
                  {select(f.label, m[f.key], (v) => setM({ ...m, [f.key]: v }))}
                </Field>
              ))}
              <div className="kpi-vars__heat" role="group" aria-label="Other facility power" title={OTHER_HINT}>
                <span className="caps">Other facility power (summed)</span>
                {summed("other_power", other, "Other facility power", "Add another facility power")}
              </div>
              <div className="kpi-vars__heat" role="group" aria-label="Reused heat">
                <span className="caps">Reused heat (summed)</span>
                {summed("heat_power", heat, "Reused heat", "Add a reused heat")}
              </div>
              <Field label="Power unit">
                <select
                  className="field field--sm"
                  value={m.power_unit ?? ""}
                  onChange={(e) => setM({ ...m, power_unit: (e.target.value || null) as KpiMapping["power_unit"] })}
                >
                  <option value="">— unknown —</option>
                  <option>W</option>
                  <option>kW</option>
                  <option>MW</option>
                </select>
              </Field>
              <ul className="kpi-vars__formulas" aria-label="KPI formulas">
                {kpiFormulas(m).map((l) => (
                  <li key={l.label}>
                    <b>{l.label}</b> <InfoMark term={l.label} text={l.about} />{" "}
                    {l.formula ? <span className="mono">{l.formula}</span> : <span className="kpi-vars__missing">needs {l.missing.join(", ")}</span>}
                  </li>
                ))}
              </ul>
              <div className="kpi-vars__actions">
                <button type="button" className="btn btn--primary btn--sm" disabled={busy || (heat.length > 0 && !m.it_power)} onClick={save}>
                  Save KPI variables
                </button>
                {status && (
                  <span role="status" className="muted">
                    {status}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
