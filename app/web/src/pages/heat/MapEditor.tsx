/** Picks the heat source from the data when dataset.json names none: a heat column, or the temperature difference of two columns. */
import { fmt } from "../../lib/format";
import type { HeatSourceMap } from "../../lib/sourceMap";
import { NumberField } from "../../ui/NumberField";
import { Segmented } from "../../ui/Segmented";
import { Formula, Note } from "./controls";

/** Switching the kind keeps what fits: the heat column becomes the hot temperature and back. */
function switchKind(map: HeatSourceMap, kind: HeatSourceMap["kind"], columns: string[]): HeatSourceMap {
  if (kind === map.kind) return map;
  if (kind === "column") return { kind: "column", q: map.kind === "delta" ? map.hot : map.q, factor: 1, t: map.t };
  return { kind: "delta", hot: map.t, cold: columns.find((c) => c !== map.t) ?? map.t, factor: 1, t: map.t };
}

export function MapEditor({ map, columns, onChange }: { map: HeatSourceMap; columns: string[]; onChange: (m: HeatSourceMap) => void }) {
  const pick = (name: string, value: string, set: (v: string) => void) => (
    <label className="heat-pick">
      <span>{name}</span>
      <select className="field field--sm mono" value={value} onChange={(e) => set(e.target.value)} aria-label={name}>
        {columns.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <Segmented<HeatSourceMap["kind"]>
        label="Heat from"
        value={map.kind}
        onChange={(k) => onChange(switchKind(map, k, columns))}
        options={[
          { id: "column", label: "Heat column" },
          { id: "delta", label: "Temperature difference" },
        ]}
      />
      {map.kind === "column" ? (
        <>
          {pick("Heat (kW)", map.q, (q) => onChange({ ...map, q }))}
          <NumberField label="Factor" value={map.factor} onChange={(factor) => onChange({ ...map, factor })} step={0.1} max={1e6} unit="×" />
        </>
      ) : (
        <>
          {pick("T hot", map.hot, (hot) => onChange({ ...map, hot }))}
          {pick("T cold", map.cold, (cold) => onChange({ ...map, cold }))}
          <NumberField label="Factor (flow × cp)" value={map.factor} onChange={(factor) => onChange({ ...map, factor })} step={0.1} max={1e6} unit="kW/K" />
        </>
      )}
      {pick("Source temperature (°C)", map.t, (t) => onChange({ ...map, t }))}
      <Formula>
        {map.kind === "column" ? `Q = ${fmt(map.factor, 2)} · ${map.q}` : `Q = ${fmt(map.factor, 2)} kW/K · |${map.hot} − ${map.cold}|`}
        <br />T = {map.t}
      </Formula>
      <Note>
        This data center's dataset names no heat source, so pick it here. For the temperature difference the factor is the mass flow × c<sub>p</sub> (water: 1 kg/s ≈
        4.19 kW/K). Saved for this data center.
      </Note>
    </>
  );
}
