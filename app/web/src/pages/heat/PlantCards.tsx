/**
 * The Heat distribution and District heat cards of Heat Matching. Heat distribution: its Model (the plant models
 * picked in Heat Distribution › Structure and Modelling, a built-in formula for the rest) or the Calculation (the
 * built-in formulas), its three units switched on and off, their numbers under Settings. District heat: its Model
 * (the demand as District › Structure and Modelling makes it) or the Calculation (the Site map's heat sinks).
 */
import type { ReactNode } from "react";
import type { Component } from "../../api";
import { fmt } from "../../lib/format";
import { COP_MAX, type MatchOptions, type Recovery } from "../../lib/matching";
import { mwh } from "../../lib/period";
import { Card } from "../../ui/Card";
import { NumberField } from "../../ui/NumberField";
import { Slider } from "../../ui/Slider";
import { Switch } from "../../ui/Switch";
import { Formula, From, Note, Settings, shown, WayPicker } from "./controls";
import { PLANTS, type Plant } from "./partComponents";
import { recoveryOf, wayOf, type PartsOn, type Way, type WhyNot } from "./parts";
import type { WindowKind } from "./window";

export type SetOption = <K extends keyof MatchOptions>(k: K) => (v: MatchOptions[K]) => void;

const EXPLAIN: Record<Recovery, string> = {
  direct: "Heat exchanger only: the source must be hotter than the network supply.",
  heatpump: "Heat pump only: it lifts the source heat to the supply temperature, using electricity.",
  auto: "Direct whenever the source is hot enough, heat pump in the other steps; the storage keeps a surplus for later.",
  none: "Heat exchanger and heat pump are off: nothing is delivered. Switch one of them on.",
};

const UNIT: Record<Plant, string> = { hex: "Heat exchanger", hp: "Heat pump", tank: "Thermal storage" };

export function HeatDistributionCard(p: {
  way: Way;
  why: WhyNot;
  onWay: (w: Way) => void;
  opts: MatchOptions;
  recovered?: boolean; // the data center's heat is already what its HEX passes: no HEX efficiency on it
  set: SetOption;
  on: PartsOn;
  onParts: (o: PartsOn) => void;
  active: Partial<Record<Plant, Component>>; // the plant models that run (Model)
  cop: number | undefined;
  windowKind: WindowKind;
  cp: number; // the water's cₚ, for ṁ = Q / (cₚ · ΔT) in the flow diagram
  onCp: (v: number) => void;
  trained: string[]; // its models trained in its Modelling
  pick?: ReactNode; // which plant model its heat pump runs, under its switch
}) {
  const { opts, set, on, active } = p;
  const model = wayOf(p.way, p.why) === "model";
  const recovery = recoveryOf(on);
  const when = p.windowKind === "period" ? "over the period" : `this ${p.windowKind}`;
  const formula = (x: Plant) => on[x] && !active[x];
  return (
    <Card title="Heat distribution" tone="var(--heat)">
      <WayPicker name="Heat distribution" way={p.way} why={p.why} onChange={p.onWay} pick={p.pick} />
      <Settings label="More options">
        <div className="heat-units" role="group" aria-label="Units">
          {PLANTS.map((x) => (
            <button key={x} type="button" className={`chip${on[x] ? " chip--on" : ""}`} aria-pressed={on[x]} onClick={() => p.onParts({ ...on, [x]: !on[x] })}>
              {UNIT[x]}
            </button>
          ))}
        </div>
        <Note>
          {recovery === "auto" && !opts.physics
            ? "Without temperatures every step counts as hot enough, so the heat exchanger runs and the heat pump stays idle."
            : EXPLAIN[recovery]}
        </Note>
        {model ? (
          <>
            <div className="heat-plants">
              {PLANTS.filter((x) => on[x]).map((x) => (
                <span key={x}>
                  {UNIT[x]}: {active[x] ? <strong>{active[x]!.name}</strong> : <span className="muted">built-in formula</span>}
                </span>
              ))}
            </div>
            {p.trained.length > 0 && (
              <Note>Trained in its Modelling: {p.trained.join(", ")}. Not run here yet: the units run the plant models above, or their built-in formulas.</Note>
            )}
            <From href="#/heat/structure" page="Heat Distribution › Structure and Modelling">
              Its plant models, under Connection points.
            </From>
          </>
        ) : (
          <Note>The built-in formulas of each unit.</Note>
        )}
        {p.cop ? (
          <Note>
            Heat pump COP {when} ⌀ {fmt(p.cop, 2)}.
          </Note>
        ) : null}
        <Settings>
          <Switch checked={opts.physics} onChange={set("physics")} label="Use physical formulas" />
          {opts.physics && p.recovered ? (
            <Note>HEX efficiency: the data center's heat is already what its HEX passes.</Note>
          ) : opts.physics ? (
            <Slider
              label="HEX efficiency"
              value={opts.hexEff * 100}
              show={shown(opts.hexEff * 100, 0, "%")}
              onChange={(v) => set("hexEff")(v / 100)}
              min={0}
              max={100}
              step={5}
            />
          ) : (
            <Slider
              label="Usable share η"
              value={opts.eta * 100}
              show={shown(opts.eta * 100, 0, "%")}
              onChange={(v) => set("eta")(v / 100)}
              min={0}
              max={100}
              step={5}
            />
          )}
          {formula("hex") && opts.physics && (
            <>
              <Slider
                label="Direct HEX approach"
                value={opts.approach}
                show={shown(opts.approach, 1, "K")}
                onChange={set("approach")}
                min={0}
                max={30}
                step={0.5}
              />
              <Formula>
                direct if t<sub>source</sub> ≥ supply + approach
              </Formula>
            </>
          )}
          {formula("hp") && (
            <>
              <NumberField label="Heat pump capacity (thermal)" value={opts.hpCapacity} onChange={set("hpCapacity")} step={10} unit="kW" />
              <NumberField label="Heat pump time constant" value={opts.hpTauH} onChange={set("hpTauH")} min={0} max={12} step={0.1} unit="h" />
              {opts.physics ? (
                <>
                  <Slider
                    label="Carnot efficiency"
                    value={opts.carnotEff}
                    show={shown(opts.carnotEff, 2)}
                    onChange={set("carnotEff")}
                    min={0.1}
                    max={1}
                    step={0.05}
                  />
                  <Formula>
                    COP = η<sub>C</sub> · T<sub>supply</sub>[K] / lift, ≤ {COP_MAX}
                  </Formula>
                </>
              ) : (
                <Slider label="Heat pump COP" value={opts.fixedCop} show={shown(opts.fixedCop, 1)} onChange={set("fixedCop")} min={1.1} max={10} step={0.1} />
              )}
            </>
          )}
          {formula("tank") && (
            <>
              <NumberField label="Storage capacity" value={opts.tankKwh} onChange={set("tankKwh")} step={100} unit="kWh" />
              {opts.tankKwh > 0 ? (
                <NumberField label="Standing loss" value={opts.tankLossPct} onChange={set("tankLossPct")} max={20} step={0.1} unit="%/h" />
              ) : (
                <Note>0 kWh: no storage.</Note>
              )}
            </>
          )}
          <NumberField label="Heat capacity cₚ of the water" value={p.cp} onChange={p.onCp} min={0.5} max={10} step={0.01} unit="kJ/(kg·K)" />
          <Note>For the mass flow ṁ = Q / (cₚ · ΔT) on the pipes; a data center's own cₚ comes from its data.</Note>
        </Settings>
      </Settings>
    </Card>
  );
}

/** The district's demand over the period (energy, peak) and its temperatures, how it runs and where that comes from. */
export function DistrictCard(p: {
  way: Way;
  why: WhyNot;
  onWay: (w: Way) => void;
  kw: number[] | null;
  stepHours: number;
  supply?: number;
  ret?: number;
  isYear: boolean;
  source: string;
  pick?: ReactNode; // where its demand comes from, under its switch
}) {
  const model = wayOf(p.way, p.why) === "model";
  return (
    <Card title="District" tone="var(--cool-strong)">
      <WayPicker name="District" way={p.way} why={p.why} onChange={p.onWay} pick={p.pick} />
      <Settings label="More options">
        {p.kw?.length ? (
          <dl className="stats heat-stats">
            {[
              [p.isYear ? "Annual" : "Test period", `${fmt(mwh(p.kw, p.stepHours), p.isYear ? 0 : 2)} MWh`],
              ["Peak", `${fmt(Math.max(...p.kw), 0)} kW`],
              ["Supply", `${p.supply} °C`],
              ["Return", `${p.ret} °C`],
            ].map(([k, v]) => (
              <div key={k} className="stat">
                <dt className="stat__label">{k}</dt>
                <dd className="mono stat__value">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <Note>loading…</Note>
        )}
        {model ? (
          <From href="#/district/structure" page="District › Structure and Modelling">
            {p.source}; supply and return from the Site map.
          </From>
        ) : (
          <From href="#/twin/map" page="Site map">
            Generated from the heat sinks and the outdoor temperature.
          </From>
        )}
      </Settings>
    </Card>
  );
}
