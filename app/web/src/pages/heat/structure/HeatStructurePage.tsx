/**
 * Heat Distribution › Structure (#/heat/structure): the heat distribution drawn like the data center's P&ID, with the
 * same page (datacenter/structure/PidPage): a picture of your own or the built-in drawing, the variables on it, the
 * causal links between them, views and the construct, with Modelling under it, the same as the data center's: ML or
 * physical equations, the same models, buttons and evaluation, on this graph, with this system's equation library. Its files (graph,
 * layout, equations, models) are its own (api StructureScope "heat").
 */
import { lazy } from "react";
import PidPage from "../../datacenter/structure/PidPage";
import { useBoundSetup } from "../../datacenter/structure/useBoundSetup";
import { HEAT_SETUP } from "./heatSetup";

const TrainPage = lazy(() => import("../../datacenter/modelling/TrainPage"));

export default function HeatStructurePage() {
  const setup = useBoundSetup(HEAT_SETUP); // its starting variables named as the data's columns
  return setup ? <PidPage setup={setup} model={(link) => <TrainPage link={link} />} /> : <p className="page muted">Loading…</p>;
}
