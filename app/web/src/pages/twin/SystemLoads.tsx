/**
 * Heat Matching's three folders, one at the top right of each part's column in the diagram (heat/controls.tsx
 * SystemLoad): the model each part runs and the system (dataset) it is taken from. The page holds the choices and
 * what they change; these only list them.
 */
import { DATASET } from "../../dataset";
import type { InputSource } from "../../lib/externalInputs";
import { STRUCTURES } from "../../lib/modelCatalog";
import { SystemLoad } from "../heat/controls";
import { usableFor, type PartComponents } from "../heat/partComponents";
import type { Component } from "../../api";

type System = { id: string; label: string };
const trainedLabel = (m: string) => `Trained model · ${STRUCTURES.find((d) => d.name === m)?.label ?? m}`;

/** The data center: which of its trained models runs, and the data center (the page's dataset). */
export function DcSystemLoad(p: { model: string | null; models: string[]; onModel: (m: string) => void; systems: System[]; onSystem: (id: string) => void }) {
  return (
    <SystemLoad
      label="Data center: model and system"
      model={p.model ?? ""}
      models={p.models.map((m) => ({ id: m, label: trainedLabel(m) }))}
      onModel={p.onModel}
      system={DATASET}
      systems={p.systems}
      onSystem={p.onSystem}
    />
  );
}

/** The heat distribution: the heat pump's plant model (or the built-in formula), and the heat distribution's dataset. */
export function HeatSystemLoad(p: {
  partComponents: PartComponents;
  components: Component[];
  onPartComponents: (next: PartComponents) => void;
  system: string;
  systems: System[];
  onSystem: (id: string) => void;
}) {
  return (
    <SystemLoad
      label="Heat distribution: model and system"
      model={p.partComponents.hp ?? ""}
      models={[{ id: "", label: "Heat pump · built-in formula" }, ...usableFor("hp", p.components).map((c) => ({ id: c.id, label: `Heat pump · ${c.name}` }))]}
      onModel={(id) => {
        const next = { ...p.partComponents };
        if (id) next.hp = id;
        else delete next.hp;
        p.onPartComponents(next);
      }}
      system={p.system}
      systems={p.systems}
      onSystem={p.onSystem}
    />
  );
}

/**
 * The district: its own demand, one of its trained models, another dataset's demand, or Chronos-2 on `fromName`'s
 * measured demand ("", "model:<name>", a dataset id, "fm:<mode>"), and the district's dataset.
 */
export function DistrictSystemLoad(p: {
  fmMode: string | null;
  demandFrom: string;
  trained: string | null;
  models: string[];
  demandOptions: InputSource[];
  fromName: string;
  onModel: (v: string) => void;
  systems: System[];
  onSystem: (id: string) => void;
}) {
  return (
    <SystemLoad
      label="District: demand and system"
      model={p.fmMode ? `fm:${p.fmMode}` : p.demandFrom || (p.trained && p.models.includes(p.trained) ? `model:${p.trained}` : "")}
      models={[
        { id: "", label: "Its own (profile or measured)" },
        ...p.models.map((m) => ({ id: `model:${m}`, label: trainedLabel(m) })),
        ...p.demandOptions.map((o) => ({ id: o.id, label: `${o.name} · ${o.column}` })),
        { id: "fm:rolling", label: `Foundation model · Chronos-2, day-ahead on ${p.fromName}'s measured demand` },
        { id: "fm:weather", label: `Foundation model · Chronos-2, a year from the weather (learned from ${p.fromName})` },
      ]}
      onModel={p.onModel}
      system={p.demandFrom || DATASET}
      systems={p.systems}
      onSystem={p.onSystem}
    />
  );
}
