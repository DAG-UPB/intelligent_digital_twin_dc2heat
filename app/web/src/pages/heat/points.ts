/** Extraction points of the data center's heat on Heat distribution: their names and the profile they give. */

/** Heat (kW) and its temperature (°C) at an extraction point, one value per step; tOut: the measured return, if any. */
export type Profile = { q: number[]; t: number[]; tOut?: number[] };

/** The points the physics source offers (physicsSource in lib/matching.ts): an air-cooled data center's, or a
 * liquid-cooled one's facility water (dataset.json heat_source has a "liquid" point). */
export const PHYSICS_POINTS = ["hall", "condenser"];
export const LIQUID_POINTS = ["liquid", "condenser"];

const KNOWN_POINTS: Record<string, { title: string; sub: string }> = {
  hall: { title: "Hall HEX", sub: "hot-aisle air" },
  condenser: { title: "Condenser HEX", sub: "cooling water" },
  liquid: { title: "Liquid cooling HEX", sub: "facility water" },
  mapped: { title: "Heat source", sub: "mapped columns" },
};

/** Title and subtitle of a point: a key of dataset.json heat_source (hall, condenser, …), "mapped", or a physics point. */
export const pointLabel = (x: string) => KNOWN_POINTS[x] ?? { title: x.charAt(0).toUpperCase() + x.slice(1), sub: "heat source" };
