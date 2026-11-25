/**
 * "Choose the KPI variables": when the data does not name them, the user says which variable is the IT
 * equipment's electricity, the cooling's electricity, the facility's other electricity (one or more, summed: then PUE
 * is the full one), the reused heat (one or more, summed) and the heat demand, and their unit. Saved as dataset.json
 * "kpi" (silver; backend set_kpi), then the KPIs above are computed from them.
 */
import { useState } from "react";
import { saveKpiMapping, type KpiMapping } from "../../../api";
import { DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { Field } from "../../../ui/Field";

const SINGLE: { key: "it_power" | "cooling_power" | "heat_demand"; label: string; hint: string }[] = [
  { key: "it_power", label: "IT power (electricity)", hint: "the servers' electric power: every KPI is relative to it" },
  { key: "cooling_power", label: "Cooling power (electricity)", hint: "chillers, fans, pumps: for PUE, ERF and ERE" },
  { key: "heat_demand", label: "Heat demand", hint: "what the reused heat covers" },
];
const OTHER_HINT = "UPS and distribution losses, lighting, building: with it PUE is the full one";

/** A summed KPI's variables to tick: folded, its line shows the ticked ones (a data center has dozens of variables). */
function Ticks({ legend, title, variables, ticked, onChange }: { legend: string; title?: string; variables: string[]; ticked: string[]; onChange: (next: string[]) => void }) {
  return (
    <details className="dash__kpi-ticks" title={title}>
      <summary>
        {legend} · <b>{ticked.length ? ticked.join(", ") : "none"}</b>
      </summary>
      <fieldset className="dash__kpi-heat" aria-label={legend}>
        {variables.map((v) => (
          <label key={v}>
            <input type="checkbox" checked={ticked.includes(v)} onChange={(e) => onChange(e.target.checked ? [...ticked, v] : ticked.filter((x) => x !== v))} />
            {v}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

interface Props {
  variables: string[];
  mapping: KpiMapping; // the saved one (dataset.json "kpi"), {} when none
  open: boolean; // shown unfolded (no KPI could be computed yet)
  bare?: boolean; // no fold of its own: the KPI card's tab shows it
  onSaved: () => void;
}

export function KpiVariables({ variables, mapping, open, bare, onSaved }: Props) {
  const [m, setM] = useState<KpiMapping>(mapping);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a hand-written dataset.json may name one column as a string (the backend takes both): ticked as a list
  const listOf = (v: string | string[] | undefined) => (typeof v === "string" ? [v] : (v ?? []));
  const heat = listOf(m.heat_power);
  const other = listOf(m.other_power);
  // ticked like the reused heat; both bodies below show it
  const otherBox = (
    <Ticks
      legend="Other facility power (summed): for the full PUE"
      title={OTHER_HINT}
      variables={variables}
      ticked={other}
      onChange={(next) => setM({ ...m, other_power: next })}
    />
  );

  const save = async (next: KpiMapping) => {
    setBusy(true);
    try {
      await saveKpiMapping(DATASET, next);
      setStatus(Object.values(next).some((v) => (Array.isArray(v) ? v.length : v)) ? "Saved: the KPIs are computed from these." : "Cleared.");
      onSaved();
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    // bare: the body alone (the KPI card's tab opens it); else folded under its own line
    bare ? (
      <div className="dash__kpi-vars-body">
      <p className="muted dash__note">Which of this data center's variables stand for the KPIs, when the data does not say. Leave out what the data does not have.</p>
      <div className="dash__kpi-grid">
        {SINGLE.map((f) => (
          <Field key={f.key} label={f.label}>
            <select className="field field--sm" title={f.hint} value={m[f.key] ?? ""} onChange={(e) => setM({ ...m, [f.key]: e.target.value || null })}>
              <option value="">— none —</option>
              {variables.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="Power unit">
          <select className="field field--sm" title="needed for the energies (MWh)" value={m.power_unit ?? ""} onChange={(e) => setM({ ...m, power_unit: (e.target.value || null) as KpiMapping["power_unit"] })}>
            <option value="">— unknown —</option>
            <option>W</option>
            <option>kW</option>
            <option>MW</option>
          </select>
        </Field>
      </div>
      {otherBox}
      <Ticks legend="Reused heat (summed): for ERF, ERE and the heat reused" variables={variables} ticked={heat} onChange={(next) => setM({ ...m, heat_power: next })} />
      <div className="dash__kpi-actions">
        <button type="button" className="btn btn--primary" disabled={busy || (heat.length > 0 && !m.it_power)} onClick={() => save(m)}>
          Save KPI variables
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setM({});
            save({});
          }}
        >
          Clear
        </button>
        {heat.length > 0 && !m.it_power && <span className="muted">Choose the IT power first.</span>}
        {status && <span role="status">{status}</span>}
      </div>
      </div>
    ) : (
    <details className="dash__kpi-vars" open={open}>
      <summary>Choose the KPI variables</summary>
      <p className="muted dash__note">Which of this data center's variables stand for the KPIs, when the data does not say. Leave out what the data does not have.</p>
      <div className="dash__kpi-grid">
        {SINGLE.map((f) => (
          <Field key={f.key} label={f.label}>
            <select className="field field--sm" title={f.hint} value={m[f.key] ?? ""} onChange={(e) => setM({ ...m, [f.key]: e.target.value || null })}>
              <option value="">— none —</option>
              {variables.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="Power unit">
          <select className="field field--sm" title="needed for the energies (MWh)" value={m.power_unit ?? ""} onChange={(e) => setM({ ...m, power_unit: (e.target.value || null) as KpiMapping["power_unit"] })}>
            <option value="">— unknown —</option>
            <option>W</option>
            <option>kW</option>
            <option>MW</option>
          </select>
        </Field>
      </div>
      {otherBox}
      <Ticks legend="Reused heat (summed): for ERF, ERE and the heat reused" variables={variables} ticked={heat} onChange={(next) => setM({ ...m, heat_power: next })} />
      <div className="dash__kpi-actions">
        <button type="button" className="btn btn--primary" disabled={busy || (heat.length > 0 && !m.it_power)} onClick={() => save(m)}>
          Save KPI variables
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setM({});
            save({});
          }}
        >
          Clear
        </button>
        {heat.length > 0 && !m.it_power && <span className="muted">Choose the IT power first.</span>}
        {status && <span role="status">{status}</span>}
      </div>
    </details>
    )
  );
}
