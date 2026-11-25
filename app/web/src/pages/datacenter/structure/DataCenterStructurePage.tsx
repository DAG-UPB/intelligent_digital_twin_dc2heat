/**
 * Data Center › Physical structure (#/dc/pid): the data center's P&ID (PidPage) with its Modelling (the AI modelling page) whole
 * under it, on the same graph (the graph file picked above, the links as drawn): the structure and its models are one page.
 * The AI modelling tab stays as well.
 */
import { lazy } from "react";
import PidPage from "./PidPage";

const TrainPage = lazy(() => import("../modelling/TrainPage"));

export default function DataCenterStructurePage() {
  return <PidPage model={(link) => <TrainPage link={link} />} />;
}
