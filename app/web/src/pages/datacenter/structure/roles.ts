/**
 * Roles of the variables on the drawing: each is coloured by how Modelling makes it (its approach, Modelling's column
 * colours), and so are the links into it; actuators ("actuators", dataset.json) are drawn as a control function
 * (circle in a square). Variables with no data column can be linked but not trained.
 */
import type { Approach } from "../modelling/approaches";

/** Each approach's colour (index.css --way-*), as Modelling's columns have it; "none": not known yet. */
export const WAYS: Record<Approach | "none", string> = {
  data: "var(--way-data)",
  physics: "var(--way-physics)",
  profile: "var(--way-profile)",
  off: "var(--way-off)",
  none: "var(--foreground)",
};
/** Fill of a selected (or link-start) instrument. */
export const SELECTED_FILL = "color-mix(in srgb, #8b5cf6 20%, var(--surface))";
/** An instrument's fill (and an actuator's square): a light tint of its colour. */
export const tint = (color: string) => `color-mix(in srgb, ${color} 12%, var(--surface))`;

export interface Roles {
  actuators: Set<string>;
  approach: Record<string, Approach | null>; // as Modelling shows it (useApproaches); null: calculated, shown as not modelled
  noData: (v: string) => boolean;
  prepared: (v: string) => boolean; // made from the data on the Dashboard (silver): marked "new"
}

/** A variable's approach for its colour: a calculated one as not modelled, one not known yet "none". */
export const wayOf = (r: Roles, v: string): Approach | "none" => (v in r.approach ? (r.approach[v] ?? "off") : "none");

/** Outline and label colour of an instrument, and of the links into it. */
export const roleColor = (r: Roles, v: string) => WAYS[wayOf(r, v)];
