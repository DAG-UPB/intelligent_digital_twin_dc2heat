/** One heat source or sink of the Site panel: its name on a line of its own, then its temperature (°C) and power (kW,
 * or MW on a click of its unit: remembered in this browser; kept in kW) with their units (`captions`: the data
 * center's, a row each with its caption beside it, and `utilization`: its share of that capacity given on average, %),
 * and for sinks a button to its profile (in the district's Modelling) and a delete button. A sink shows `figures`
 * instead of the two fields: what it counts as comes from its demand (its profile), not from temp_c and power_kw. */
import { useState, type ReactNode } from "react";
import type { HeatPoint } from "../../api";
import { HOURS_PER_YEAR } from "../../lib/constants";
import { fmt } from "../../lib/format";
import { InfoMark } from "../../ui/InfoMark";
import { IDLE_SHARE, powerShare } from "./siteEdits";

const UNIT_KEY = "site-power-unit";
const readUnit = () => {
  try {
    return localStorage.getItem(UNIT_KEY) === "MW";
  } catch {
    return false;
  }
};

export default function PointEditor({
  p,
  onChange,
  onDelete,
  onProfile,
  extra,
  captions,
  utilization,
  figures,
}: {
  p: HeatPoint;
  onChange: (p: HeatPoint) => void;
  onDelete?: () => void;
  onProfile?: () => void;
  extra?: ReactNode; // a last line across the row (a sink's profile)
  captions?: { temp: string; power: string };
  utilization?: boolean;
  figures?: string; // read-only, in place of the temperature and power fields (a sink: its demand's numbers)
}) {
  const [mw, setMw] = useState(readUnit);
  const flip = () => {
    setMw(!mw);
    try {
      localStorage.setItem(UNIT_KEY, mw ? "kW" : "MW");
    } catch {
      /* only not remembered */
    }
  };
  const unit = mw ? "MW" : "kW";
  return (
    <div className={captions ? "point-editor point-editor--wide" : "point-editor"}>
      <input
        className="field field--sm point-editor__name"
        value={p.name}
        onChange={(e) => onChange({ ...p, name: e.target.value })}
        aria-label="Name"
        title={p.name}
      />
      {figures != null && (
        <span className="point-editor__figures" aria-label={`Demand of ${p.name}`} title="From its profile: change it in the district's Modelling">
          {figures}
        </span>
      )}
      {figures == null && (
      <label className="point-editor__num" title="Temperature °C">
        {captions && <span className="point-editor__caption">{captions.temp}</span>}
        <input
          className="field field--sm"
          type="number"
          value={p.temp_c}
          onChange={(e) => onChange({ ...p, temp_c: Number(e.target.value) })}
          aria-label="Temperature °C"
        />
        <span>°C</span>
      </label>
      )}
      {figures == null && (
      <label className="point-editor__num" title={`Power ${unit}`}>
        {captions && <span className="point-editor__caption">{captions.power}</span>}
        <input
          className="field field--sm"
          type="number"
          min={0}
          step={mw ? 0.1 : 1}
          value={mw ? Math.round(p.power_kw) / 1000 : p.power_kw}
          onChange={(e) => onChange({ ...p, power_kw: Math.max(0, Number(e.target.value) * (mw ? 1000 : 1)) })}
          aria-label={`Power ${unit}`}
        />
        <button type="button" className="point-editor__unit" onClick={flip} title={mw ? "In kW" : "In MW"} aria-label={`Power in ${mw ? "kW" : "MW"}`}>
          {unit}
        </button>
      </label>
      )}
      {utilization && (
        <label className="point-editor__num" title="Utilization: how busy the IT is on average">
          <span className="point-editor__caption">Utilization</span>
          <input
            className="field field--sm"
            type="number"
            min={0}
            max={100}
            step={5}
            value={Math.round((p.utilization ?? 1) * 100)}
            onChange={(e) => onChange({ ...p, utilization: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
            aria-label="Utilization %"
          />
          <span>%</span>
        </label>
      )}
      {utilization && (
        <label className="point-editor__num" title="Idle power: what it draws doing nothing, a share of its capacity">
          <span className="point-editor__caption">Idle power</span>
          <input
            className="field field--sm"
            type="number"
            min={0}
            max={100}
            step={5}
            value={Math.round((p.idle_share ?? IDLE_SHARE) * 100)}
            onChange={(e) => onChange({ ...p, idle_share: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
            aria-label="Idle power %"
          />
          <span>%</span>
        </label>
      )}
      {utilization && (
        <label className="point-editor__num" title="Waste heat used: the share of the data center's heat taken for the district">
          <span className="point-editor__caption">Waste heat used</span>
          <input
            className="field field--sm"
            type="number"
            min={0}
            max={100}
            step={5}
            value={Math.round((p.heat_used_share ?? 1) * 100)}
            onChange={(e) => onChange({ ...p, heat_used_share: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
            aria-label="Waste heat used %"
          />
          <span>%</span>
        </label>
      )}
      {utilization && (
        <div className="point-editor__share">
          <span className="point-editor__share-text">→ {Math.round(powerShare(p) * (p.heat_used_share ?? 1) * 100)} % of the installed capacity as heat used</span>
          <InfoMark term="the power curve" mark="?" hover text={<PowerCalculation p={p} />} />
        </div>
      )}
      <span className="point-editor__end">
        {onProfile && (
          <button
            type="button"
            className="btn point-editor__delete"
            onClick={onProfile}
            aria-label={`Edit the profile of ${p.name} in Modelling`}
            title="Its profile, in the district's Modelling"
          >
            ∿
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn point-editor__delete" onClick={onDelete} aria-label={`Delete ${p.name}`}>
            ✕
          </button>
        )}
      </span>
      {extra && <div className="point-editor__extra">{extra}</div>}
    </div>
  );
}

/** The data center's waste heat worked out with its own numbers, a line each (siteEdits.ts: powerShare, wasteKw). */
function PowerCalculation({ p }: { p: HeatPoint }) {
  const idle = (p.idle_share ?? IDLE_SHARE) * 100;
  const util = (p.utilization ?? 1) * 100;
  const drawn = powerShare(p) * 100;
  const used = (p.heat_used_share ?? 1) * 100;
  const share = (drawn * used) / 100;
  const mw = p.power_kw / 1000;
  const avg = (mw * share) / 100;
  return (
    <>
      <span className="info-mark__line">{"Power drawn = idle + (100 % − idle) × utilization"}</span>
      <span className="info-mark__line">{`= ${fmt(idle)} % + ${fmt(100 - idle)} % × ${fmt(util)} % = ${fmt(drawn)} % of the installed capacity`}</span>
      <span className="info-mark__line">{`Heat used = ${fmt(drawn)} % × ${fmt(used)} % waste heat used = ${fmt(share)} % of the installed capacity`}</span>
      <span className="info-mark__line">{`Average heat = ${fmt(mw, 2)} MW × ${fmt(share)} % = ${fmt(avg, 2)} MW`}</span>
      <span className="info-mark__line">{`A year = ${fmt(avg, 2)} MW × ${fmt(HOURS_PER_YEAR)} h = ${fmt(avg * (HOURS_PER_YEAR / 1000), 1)} GWh/a`}</span>
      <span className="info-mark__line info-mark__note">
        {"A server draws about half its full power doing nothing (Barroso & Hölzle 2007) and close to linearly more with its utilization (Fan, Weber & Barroso 2007). Nearly all of it becomes heat."}
      </span>
    </>
  );
}
