/**
 * District › Structure and Modelling (#/district/structure): the district drawn like the data center's P&ID, with the
 * same page (datacenter/structure/PidPage): the weather, the daily habits and the buildings, a very simple causal graph
 * between them, and Modelling under it, the same as the data center's, with the district's equation library. Its
 * files (graph, layout, equations, models) are its own (api StructureScope "district").
 */
import { lazy } from "react";
import PidPage from "../../datacenter/structure/PidPage";
import { useBoundSetup } from "../../datacenter/structure/useBoundSetup";
import { DISTRICT_SETUP } from "./districtSetup";

const TrainPage = lazy(() => import("../../datacenter/modelling/TrainPage"));

export default function DistrictStructurePage() {
  const setup = useBoundSetup(DISTRICT_SETUP); // its starting variables named as the data's columns
  return setup ? <PidPage setup={setup} model={(link) => <TrainPage link={link} />} /> : <p className="page muted">Loading…</p>;
}
