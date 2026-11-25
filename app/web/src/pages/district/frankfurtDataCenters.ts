/**
 * The built-in example data centers of the Site map: the app's own datasets (simulation and MiniDC testbed), placed on
 * two Frankfurt buildings (outlines from OpenStreetMap, © OpenStreetMap contributors, ODbL); their figure comes from
 * the datasets. Further examples (real sites) are machine-local: `_local/map_examples.json` in the data directory,
 * served by GET /api/district/examples and never part of the repository.
 */
import type { ExampleDataCenter } from "../../api";
import { fmt } from "../../lib/format";

export const BUILT_IN_EXAMPLES: ExampleDataCenter[] = [
  {
    name: "Simulation data center · European Central Bank",
    buildings: [[[50.109241,8.702786],[50.109085,8.702751],[50.109071,8.702723],[50.108976,8.702533],[50.108956,8.702493],[50.108939,8.702516],[50.108935,8.702509],[50.108776,8.702473],[50.108739,8.702866],[50.108607,8.703239],[50.10886,8.703299],[50.108952,8.703865],[50.108975,8.703856],[50.108975,8.70386],[50.109137,8.703897],[50.109255,8.703519],[50.109207,8.703161],[50.109241,8.702786]]],
    address: "Sonnemannstraße 20, 60314 Frankfurt am Main",
    lat: 50.108981,
    lon: 8.703079,
    heatKw: 63,
    basis:
      "the app's simulated data centers (sim_*), placed here as an example: each has its own power (the open one's " +
      "bubble shows it; 63 kW only sizes this marker); a simulation, not the ECB's data center",
    source: "https://www.openstreetmap.org/way/156432555",
    appDataset: true,
  },
  {
    name: "MiniDC demonstrator · Evangelische Akademie Frankfurt",
    buildings: [[[50.109777,8.681612],[50.109759,8.681623],[50.109763,8.681639],[50.109636,8.681718],[50.109567,8.681761],[50.109564,8.681747],[50.109549,8.681756],[50.109521,8.681774],[50.109519,8.681776],[50.109486,8.681654],[50.109481,8.681634],[50.109505,8.681619],[50.109527,8.681605],[50.109524,8.681593],[50.109596,8.681548],[50.109718,8.681472],[50.109719,8.681471],[50.109721,8.681479],[50.109798,8.68143],[50.109811,8.681422],[50.109848,8.681566],[50.109842,8.68157],[50.109777,8.681612]]],
    address: "Römerberg 9, 60311 Frankfurt am Main",
    lat: 50.109647,
    lon: 8.681612,
    heatKw: 0.5,
    basis:
      "the app's datasets (demonstrator, minidc_exp_1 … 5): a small testbed (< 1 kW); its data have no power column " +
      "(CPU temperatures, a stress level, fans, pumps, water temperatures), so 0.5 kW is a placeholder, not a measurement",
    source: "https://www.openstreetmap.org/way/72473802",
    appDataset: true,
    labelLeft: true, // the ECB is 1.5 km east at the same latitude
  },
];

/** "< 1 kW", "600 kW", "4 MW", "21 MW": the label next to a marker. */
export const heatLabel = (kw: number) => (kw < 1 ? "< 1 kW" : kw >= 1000 ? `${fmt(Math.round(kw / 100) / 10, kw % 1000 < 50 ? 0 : 1)} MW` : `${fmt(kw)} kW`);

/** Marker radius in px: grows with the square root of the heat (area ∝ heat), 6..22 px over 0.5..25 MW. */
export const markerRadius = (kw: number) => Math.max(6, Math.min(22, 6 + 16 * Math.sqrt(Math.max(0, kw - 500) / 24500)));
