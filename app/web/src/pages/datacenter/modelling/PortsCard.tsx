/**
 * Modelling › Connection points: what this part must deliver to the rest of the twin (pages/heat/ports.ts), and how
 * each of those variables is made here. Heat Matching runs on them, so a point with a role missing is
 * marked: model the variable under Variables, or (a data center without dataset.json heat_source) pick its columns.
 * The heat distribution's plant models (a component per part) are chosen here too: they are its Model there.
 * Each point folds on its title, open only when something is missing (the column beside the graph stays short): its
 * name, its status beside it while both fit (else under it), what it is about in small text (two lines, the rest in its
 * tooltip).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchSite, updateSite, type Component, type DatasetInfo, type StructureScope } from "../../../api";
import { configOf, DATASET } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import { asHeatSourceMap, guessHeatSourceMap, type HeatSourceMap } from "../../../lib/sourceMap";
import { MapEditor } from "../../heat/MapEditor";
import { asPartComponents, CONTRACT, PLANTS, usableFor, type PartComponents, type Plant } from "../../heat/partComponents";
import {
  dcPoints,
  DELIVERY_LABEL,
  deliveryOf,
  districtPoint,
  heatPoints,
  DC_INTERFACE,
  missingRoles,
  ROLES,
  WEATHER,
  type Delivery,
  type Point,
} from "../../heat/ports";
import { useComponentList } from "../../heat/usePartComponents";
import { renameFor } from "../structure/bindSetup";
import type { Approach } from "./approaches";

const ABOUT: Record<StructureScope, string> = {
  dc: "The data center hands its waste heat to the heat distribution at each extraction point.",
  heat: "The heat distribution takes the data center's waste heat and gives the district its heat.",
  district: "The district takes its heat from the heat distribution: its demand, and the network's supply and return (the Site map's, unless modelled here).",
};

const PLANT_TITLE: Record<Plant, string> = { hex: "Heat exchanger", hp: "Heat pump", tank: "Thermal storage" };

/** The site.json fields of the data center this card edits, each saved by a read-modify-write, one after the other. */
function useDcSite() {
  const [site, setSite] = useState<{ map: unknown; components: PartComponents } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    fetchSite(DATASET)
      .then((s) => setSite({ map: s.heat_source_map, components: asPartComponents(s.heat_components) }))
      .catch(() => setSite({ map: null, components: {} }));
  }, []);
  const timer = useRef<number | undefined>(undefined);
  // a typed factor changes the mapping on every key: it is saved once the user stops
  const save = (patch: { heat_source_map?: HeatSourceMap; heat_components?: PartComponents }) => {
    setSite((s) => s && { map: patch.heat_source_map ?? s.map, components: patch.heat_components ?? s.components });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        saving.current = saving.current
          .then(() => updateSite(DATASET, (s) => ({ ...s, ...(patch as Record<string, unknown>) })))
          .catch((e) => setError(`Saving: ${errorMessage(e)}`));
      },
      patch.heat_source_map ? 600 : 0,
    );
  };
  return { site, save, error };
}

function PlantModels({ list, picked, onPick }: { list: Component[]; picked: PartComponents; onPick: (c: PartComponents) => void }) {
  return (
    <div className="ports__plants">
      <span className="caps">Plant models · used by Heat Matching's Model</span>
      {PLANTS.map((p) => {
        const usable = usableFor(p, list);
        const id = picked[p] && usable.some((c) => c.id === picked[p]) ? picked[p] : "";
        return (
          <div key={p} className="ports__plant">
            <span>{PLANT_TITLE[p]}</span>
            <select
              className="field field--sm"
              value={id}
              aria-label={`${PLANT_TITLE[p]} model`}
              onChange={(e) => {
                const next = { ...picked };
                if (e.target.value) next[p] = e.target.value;
                else delete next[p];
                onPick(next);
              }}
            >
              <option value="">Built-in formula</option>
              {usable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.preset ? "" : " (yours)"}
                </option>
              ))}
            </select>
            <span className="muted">{CONTRACT[p].reads}</span>
            <PlantEquations plant={p} c={usable.find((c) => c.id === id)} />
          </div>
        );
      })}
    </div>
  );
}

/** Heat Matching's built-in formulas (lib/matching.ts matchHeat), when no plant model is picked. */
const BUILT_IN: Record<Plant, [string, string][]> = {
  hp: [
    ["COP", "clip(η_C · (T_supply + 273.15) / max(T_supply − T_source, 5), 1.1, 8)"],
    ["Q_target", "min(capacity, Q_source · COP / (COP − 1), demand + room in the tank)"],
    ["Q_heat", "Q_heat[t−1] + (Q_target − Q_heat[t−1]) · (1 − exp(−Δt / τ))   (τ: its time constant)"],
    ["P_el", "Q_heat / COP"],
  ],
  hex: [
    ["direct", "T_source ≥ T_supply + approach"],
    ["Q", "η_HEX · Q_source"],
  ],
  tank: [
    ["E", "E[t−1] · (1 − loss)^Δt + (Q_in − Q_out) · Δt,   0 ≤ E ≤ capacity"],
    ["Q_out", "min(demand − delivered, E[t−1] / Δt)"],
  ],
};

/** The equations a plant runs: its picked model's (each node, then its parameters), or the built-in formula. */
function PlantEquations({ plant, c }: { plant: Plant; c: Component | undefined }) {
  const rows = c ? c.nodes.map((n) => [n.name, n.equation] as [string, string]) : BUILT_IN[plant];
  return (
    <details className="ports__equations">
      <summary>Equations{c ? "" : " · built-in"}</summary>
      <table>
        <tbody>
          {rows.map(([name, eq]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>
                <code>{eq}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {c && c.params.length > 0 && (
        <p className="muted">{c.params.map((q) => `${q.name} = ${q.value}${q.unit ? ` ${q.unit}` : ""}${q.fixed ? "" : " (learned by Fit)"}`).join(" · ")}</p>
      )}
    </details>
  );
}

// not needed by the twin: they explain the heat and let you play; short, so it fits beside the point's name
const OPTIONAL = (
  <span className="pill pill--sm ports__opt" title="Optional · for scenarios: the twin runs without it">
    Optional
  </span>
);

/** A point's folding title: its name, its status (a pill) and what it is about, each given the column's width. */
function PointTitle({ name, status, about }: { name: string; status: ReactNode; about: string }) {
  return (
    <summary className="ports__title">
      <span className="ports__name">{name}</span>
      {status}
      <span className="muted ports__about" title={about}>
        {about}
      </span>
    </summary>
  );
}

/** One variable of a point: its role, its name and how it is delivered; a click finds it under Variables. `optional`:
 * the twin runs without it, so not marked when missing but said why: it follows from the others (the heat or the flow,
 * Q = ṁ·cₚ·ΔT), or it is optional and nothing makes it yet. */
function RoleBox(p: {
  label: string;
  unit: string;
  v: string | undefined;
  d: Delivery;
  optional: boolean | "follows";
  variables: string[];
  onPick: (v: string) => void;
}) {
  const off = !!p.optional && p.d === "missing";
  const why = p.optional === "follows" ? "from ṁ·cₚ·ΔT" : "optional · not made yet";
  const here = !!p.v && p.variables.includes(p.v);
  return (
    <button
      type="button"
      className={`ports__role ports__role--${off ? "optional" : p.d === "weather" ? "setting" : p.d}`}
      disabled={!here}
      aria-label={`${p.label}: ${p.v ?? "none"}, ${off ? why : DELIVERY_LABEL[p.d]}`}
      onClick={() => p.v && p.onPick(p.v)}
      title={here ? `Find ${p.v} under Variables` : undefined}
    >
      <span className="ports__label">
        {p.label} <span className="muted">{p.unit}</span>
      </span>
      <span className="mono ports__var">{p.v ?? "–"}</span>
      <span className="ports__how">{off ? why : DELIVERY_LABEL[p.d]}</span>
    </button>
  );
}

export function PortsCard({
  scope,
  dataset,
  variables,
  approach,
  inputs,
  demand,
  onPick,
}: {
  scope: StructureScope;
  dataset: DatasetInfo;
  variables: string[];
  approach: Record<string, Approach | null>;
  inputs: string[];
  demand?: string;
  onPick: (v: string) => void;
}) {
  const config = configOf(dataset);
  const columns = dataset.columns;
  const { site, save, error } = useDcSite();
  const { list } = useComponentList();
  const configured = Object.keys(config.heat_source ?? {}).length > 0;
  const map = scope === "dc" && !configured && site ? (asHeatSourceMap(site.map, columns) ?? guessHeatSourceMap(columns, config.heat)) : null;

  // the extraction point the heat distribution's starting variables are bound to (bindSetup): the one whose inlet is in the graph
  const hex = Object.entries(config.heat_source ?? {}).find(([, p]) => variables.includes(p.t_in ?? p.t))?.[0];
  const rename = renameFor(columns, config, hex);
  const to = (v: string) => rename[v] ?? v;
  const points: Point[] = scope === "dc" ? dcPoints(config, map) : scope === "district" ? [districtPoint(demand ?? "Q_houses")] : heatPoints(to);
  // the district's network temperatures are the Site map's settings until they are modelled
  const setting = (role: string) => (scope === "district" && (role === "t_supply" || role === "t_return") ? "setting" : false);
  const weather = WEATHER.map((w) => ({ ...w, v: to(w.v), d: deliveryOf(to(w.v), approach, columns, inputs, w.needed && "weather") }));
  // the data center's other inputs and outputs: the IT load in, its electricity and the heat rejected to the environment out
  const io = DC_INTERFACE.map((x) => ({ ...x, v: to(x.v), d: deliveryOf(to(x.v), approach, columns, inputs) }));
  // the minimum for the twin is each connection point's (both temperatures, the heat or the flow); the weather and the
  // inputs and outputs explain the heat and play scenarios, a must only for the district (its demand follows the outdoor temperature)
  const weatherNeeded = scope === "district";

  return (
    <section className="card ports" aria-label="Connection points">
      <div className="train-vars__head">
        <span className="caps">Connection points · what this part delivers to the twin</span>
      </div>
      <p className="muted train-vars__note">
        {ABOUT[scope]} Each point needs both temperatures and the heat or the mass flow (Q = ṁ·cₚ·ΔT gives the other). Heat Matching runs on them:
        what is missing is marked; model it under Variables{scope === "dc" && !configured ? ", or pick its columns below" : ""}.
      </p>
      {points.map((pt) => {
        const got = Object.fromEntries(ROLES.map((r) => [r.id, deliveryOf(pt.vars[r.id], approach, columns, inputs, setting(r.id))]));
        const missing = missingRoles(got);
        return (
          <details key={pt.id} className="ports__point" open={missing.length > 0}>
            <PointTitle
              name={pt.title}
              about="needed for the twin"
              status={
                <span className={`pill pill--sm${missing.length ? " ports__bad" : " ports__ok"}`}>
                  {missing.length ? `Missing: ${missing.map((r) => ROLES.find((x) => x.id === r)!.label.toLowerCase()).join(", ")}` : "Complete"}
                </span>
              }
            />
            <div className="ports__roles">
              {ROLES.map((r) => (
                <RoleBox
                  key={r.id}
                  label={r.label}
                  unit={r.unit}
                  v={pt.vars[r.id]}
                  d={got[r.id]}
                  // the heat or the flow: one of them is enough, so the other is not missing
                  optional={(r.id === "q" || r.id === "m") && !missing.includes("q") && "follows"}
                  variables={variables}
                  onPick={onPick}
                />
              ))}
            </div>
          </details>
        );
      })}
      <details className="ports__point" open={weatherNeeded && weather[0].d === "missing"}>
        <PointTitle
          name="Weather"
          about="shared by all three parts"
          status={
            weatherNeeded ? (
              <span className={`pill pill--sm${weather[0].d === "missing" ? " ports__bad" : " ports__ok"}`}>
                {weather[0].d === "missing" ? "Missing: outdoor temperature" : "Complete"}
              </span>
            ) : (
              OPTIONAL
            )
          }
        />
        <div className="ports__roles">
          {weather.map((w) => (
            <RoleBox key={w.v} label={w.label} unit={w.unit} v={w.v} d={w.d} optional={!(w.needed && weatherNeeded)} variables={variables} onPick={onPick} />
          ))}
        </div>
      </details>
      {scope === "dc" && (
        <details className="ports__point">
          <PointTitle
            name="Inputs and outputs"
            about="the IT load drives it; nearly all its electricity becomes heat, recovered or rejected"
            status={OPTIONAL}
          />
          <div className="ports__roles">
            {io.map((x) => (
              <RoleBox key={x.v} label={`${x.label} · ${x.io}`} unit={x.unit} v={x.v} d={x.d} optional variables={variables} onPick={onPick} />
            ))}
          </div>
        </details>
      )}
      {map && (
        <details className="ports__more">
          <summary>Columns of the waste heat</summary>
          <MapEditor map={map} columns={columns} onChange={(m) => save({ heat_source_map: m })} />
        </details>
      )}
      {scope === "heat" && site && <PlantModels list={list} picked={site.components} onPick={(c) => save({ heat_components: c })} />}
      {error && <p className="ports__error">{error}</p>}
    </section>
  );
}
