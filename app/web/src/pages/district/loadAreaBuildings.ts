/** The Wärmeatlas buildings of a drawn district's box (the local import, tile by tile): the area's card shows them
 * (AreaBuildings.tsx) and the heat network supplies them one by one (HeatNetwork.tsx, waermeatlas.ts areasAsBuildings). */
import { fetchBuildings, type WaermeatlasBuilding } from "../../api";
import { MAX_BOX_KM, ringBox, tiles } from "./waermeatlas";

/** Every Wärmeatlas building of the ring's box, tile by tile (at most 16 tiles of 2 km: 8 × 8 km), each once. */
export async function areaBuildingsOf(ring: [number, number][]) {
  const parts = tiles(ringBox(ring), MAX_BOX_KM, 16);
  if (!parts.length) throw new Error(`The district is larger than ${4 * MAX_BOX_KM} × ${4 * MAX_BOX_KM} km: its buildings do not load.`);
  const boxes = await Promise.all(parts.map(fetchBuildings));
  const byId = new Map<number, WaermeatlasBuilding>();
  for (const b of boxes) for (const x of b.buildings) byId.set(x.id, x);
  return { buildings: [...byId.values()], truncated: boxes.some((b) => b.truncated) };
}
