/** Heat Distribution › Visualization and Scenarios (#/heat/dashboard): the data center's page, on the heat distribution's variables, KPIs and twin. */
import DashboardPage from "../datacenter/dashboard/DashboardPage";
import { useBoundSetup } from "../datacenter/structure/useBoundSetup";
import { HEAT_SETUP } from "./structure/heatSetup";

export default function HeatDashboardPage() {
  const setup = useBoundSetup(HEAT_SETUP); // its starting graph, while its graph file is empty
  return setup ? <DashboardPage scope="heat" starter={setup} /> : <p className="page muted">Loading…</p>;
}
