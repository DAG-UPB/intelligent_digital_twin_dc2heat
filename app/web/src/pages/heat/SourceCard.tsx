/**
 * The "Data center" card of Heat Matching: its Model (what Data Center › Structure and Modelling delivers at the
 * extraction point: the trained model's free run, else the measurements) or the Calculation (the formulas, their
 * numbers under Settings), and how many data centers it is scaled to.
 */
import type { ReactNode } from "react";
import { fmt } from "../../lib/format";
import type { SourcePhysics } from "../../lib/matching";
import { Card } from "../../ui/Card";
import { NumberField } from "../../ui/NumberField";
import { Slider } from "../../ui/Slider";
import { Switch } from "../../ui/Switch";
import { Formula, From, Note, Settings, shown, WayPicker } from "./controls";
import { wayOf, type Way, type WhyNot } from "./parts";
import { pointTitle, ROLES, type PointVars } from "./ports";

export function SourceCard(p: {
  at: string | undefined; // the selected extraction point
  way: Way;
  why: WhyNot;
  onWay: (w: Way) => void;
  vars: PointVars | null; // the point's variables (Model)
  fromModel: string[]; // the columns the trained model's free run gives; the others are measured
  phys: SourcePhysics;
  onPhys: (p: SourcePhysics) => void;
  compare: boolean;
  onCompare: (v: boolean) => void;
  scale: number;
  onScale: (v: number) => void;
  liquid?: boolean; // a liquid-cooled data center: the condenser carries the air's share (1 − f) only
  models?: string[]; // the trained models of the data center, to pick the one whose free run is its Model
  model?: string;
  onModel?: (name: string) => void;
  pick?: ReactNode; // which model it runs, under its switch
}) {
  const { at, phys } = p;
  const runs = wayOf(p.way, p.why);
  const setP =
    <K extends keyof SourcePhysics>(k: K) =>
    (v: SourcePhysics[K]) =>
      p.onPhys({ ...phys, [k]: v });
  return (
    <Card title="Data center" tone="var(--hot)">
      <WayPicker name="Data center" way={p.way} why={p.why} onChange={p.onWay} pick={p.pick} />
      <Settings label="More options">
      {at && <div className="heat-point-name">{pointTitle(at)}</div>}
      {runs === "model" ? (
        p.vars && (
          <>
            <div className="heat-plants">
              {ROLES.filter((r) => p.vars![r.id]).map((r) => (
                <span key={r.id}>
                  {r.label}: <span className="mono">{p.vars![r.id]}</span>{" "}
                  <span className="muted">· {p.fromModel.includes(p.vars![r.id]!) ? "model" : "measured"}</span>
                </span>
              ))}
            </div>
            {!p.vars.t_return && <Note>No return temperature delivered: assumed 5 K below the supply.</Note>}
            <From href="#/dc/pid" page="Data Center › Structure and Modelling">
              {p.fromModel.length ? "The trained model's free run, the rest measured." : "As measured: no trained model gives these."}
            </From>
          </>
        )
      ) : (
        <>
          <Formula>
            {at === "hall" ? (
              <>
                Q = η · ITE_Ener
                <br />T = In_Temp + ΔT<sub>rack</sub> − approach
              </>
            ) : at === "liquid" ? (
              <>
                Q = η · f · ITE_Ener
                <br />T = clip(Out_Temp + approach<sub>facility</sub>, {fmt(phys.tFacility)}, 45) + ΔT<sub>rack</sub> − approach
              </>
            ) : (
              <>
                Q = η · ({p.liquid ? "(1 − f) · " : ""}ITE_Ener + HVAC_Ener)
                <br />T = clip(Out_Temp + approach<sub>tower</sub>, {fmt(phys.tMin)}, {fmt(phys.tMax)}) − approach
              </>
            )}
          </Formula>
          <Settings>
            <Slider
              label="Recovered share η"
              value={phys.eta * 100}
              show={shown(phys.eta * 100, 0, "%")}
              onChange={(v) => setP("eta")(v / 100)}
              min={10}
              max={100}
            />
            {at === "hall" && (
              <Slider label="Rack ΔT" value={phys.rackDt} show={shown(phys.rackDt, 1, "K")} onChange={setP("rackDt")} min={4} max={25} step={0.5} />
            )}
            {at === "liquid" && (
              <>
                <Slider
                  label="Cold plates' share f"
                  value={phys.liquidShare * 100}
                  show={shown(phys.liquidShare * 100, 0, "%")}
                  onChange={(v) => setP("liquidShare")(v / 100)}
                  min={10}
                  max={100}
                />
                <Slider
                  label="Facility water above outdoor"
                  value={phys.facilityApproach}
                  show={shown(phys.facilityApproach, 1, "K")}
                  onChange={setP("facilityApproach")}
                  min={-10}
                  max={15}
                  step={0.5}
                />
                <Slider label="Facility water (lowest)" value={phys.tFacility} show={shown(phys.tFacility, 0, "°C")} onChange={setP("tFacility")} min={15} max={50} />
                <Slider
                  label="Rack water ΔT"
                  value={phys.liquidDt}
                  show={shown(phys.liquidDt, 1, "K")}
                  onChange={setP("liquidDt")}
                  min={3}
                  max={20}
                  step={0.5}
                />
              </>
            )}
            {at !== "hall" && at !== "liquid" && (
              <>
                <Slider
                  label="Tower approach"
                  value={phys.towerApproach}
                  show={shown(phys.towerApproach, 1, "K")}
                  onChange={setP("towerApproach")}
                  min={0}
                  max={20}
                  step={0.5}
                />
                <div className="heat-pair">
                  <Slider
                    label="T min"
                    value={phys.tMin}
                    show={shown(phys.tMin, 0, "°C")}
                    onChange={(v) => setP("tMin")(Math.min(v, phys.tMax))}
                    min={0}
                    max={40}
                  />
                  <Slider
                    label="T max"
                    value={phys.tMax}
                    show={shown(phys.tMax, 0, "°C")}
                    onChange={(v) => setP("tMax")(Math.max(v, phys.tMin))}
                    min={20}
                    max={60}
                  />
                </div>
              </>
            )}
            <Slider label="HEX approach" value={phys.approach} show={shown(phys.approach, 1, "K")} onChange={setP("approach")} min={0} max={15} step={0.5} />
            <Switch checked={p.compare} onChange={p.onCompare} label="Compare with the Model" />
            <Note>From the measured IT / HVAC power and temperatures, one step delay.</Note>
          </Settings>
        </>
      )}
      <NumberField label="Scale (× data centers)" value={p.scale} onChange={p.onScale} max={1000} step={0.5} unit="×" />
      </Settings>
    </Card>
  );
}
