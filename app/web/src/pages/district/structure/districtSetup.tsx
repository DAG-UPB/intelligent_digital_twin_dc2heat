/** The district's structure: its drawing, starting variables, links and notes, and its equation library (PidPage's StructureSetup); used by its Structure and Modelling and its Visualization and Scenarios. */
import { DISTRICT_LIBRARY } from "../../../lib/districtLibrary";
import type { StructureSetup } from "../../datacenter/structure/structureSetup";
import { districtPoint, portVars } from "../../heat/ports";
import { DistrictDrawing } from "./DistrictDrawing";
import { DISTRICT_DEFAULTS, DISTRICT_LINKS, DISTRICT_NOTES, DISTRICT_STARTER, DISTRICT_TAPS } from "./districtLayout";

export const DISTRICT_SETUP: StructureSetup = {
  scope: "district",
  title: "District · Structure and Modelling",
  intro:
    "The district: the weather and the hour of the day drive the buildings' heat demand.",
  drawing: (opacity, framed) => <DistrictDrawing opacity={opacity} framed={framed} />,
  defaults: DISTRICT_DEFAULTS,
  taps: DISTRICT_TAPS,
  starter: DISTRICT_STARTER,
  starterLinks: DISTRICT_LINKS,
  starterNotes: DISTRICT_NOTES,
  ports: portVars([districtPoint("Q_houses")]),
  portPoints: { in: districtPoint("Q_houses").vars },
  actuators: [],
  frame: { name: "District", outputs: [] }, // what it takes in: the weather above, the heat distribution's water on the left
  library: DISTRICT_LIBRARY,
};
