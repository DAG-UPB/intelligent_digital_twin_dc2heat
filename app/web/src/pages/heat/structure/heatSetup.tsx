/** The heat distribution's structure: its drawing, starting variables, links and notes, and its equation library (PidPage's StructureSetup); used by its Structure and Modelling and its Visualization and Scenarios. */
import type { StructureSetup } from "../../datacenter/structure/structureSetup";
import { HeatDrawing } from "./HeatDrawing";
import { HEAT_LIBRARY } from "../../../lib/heatLibrary";
import { heatPoints, portVars } from "../ports";
import { HEAT_ACTUATORS, HEAT_DEFAULTS, HEAT_LINKS, HEAT_NOTES, HEAT_STARTER, HEAT_TAPS } from "./heatLayout";

export const HEAT_SETUP: StructureSetup = {
  scope: "heat",
  title: "Heat distribution · Structure and Modelling",
  intro:
    "The heat distribution: the data center's water through the heat exchanger and the heat pump into the storage tank and the district.",
  drawing: (opacity, framed) => <HeatDrawing opacity={opacity} framed={framed} />,
  defaults: HEAT_DEFAULTS,
  taps: HEAT_TAPS,
  starter: HEAT_STARTER,
  starterLinks: HEAT_LINKS,
  starterNotes: HEAT_NOTES,
  ports: portVars(heatPoints((v) => v)),
  portPoints: { in: heatPoints((v) => v)[0].vars, out: heatPoints((v) => v)[1].vars },
  actuators: HEAT_ACTUATORS,
  frame: { name: "Heat distribution", outputs: [{ v: "P_el_hp", tag: "EQ" }] }, // the heat pump's electricity out
  library: HEAT_LIBRARY,
  size: 0.6, // many variables close together along the pipes: smaller bubbles
};
