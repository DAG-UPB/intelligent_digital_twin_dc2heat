/** District › Visualization and Scenarios (#/district/dashboard): the data center's page, on the district's variables, KPIs and twin. */
import DashboardPage from "../datacenter/dashboard/DashboardPage";
import { useBoundSetup } from "../datacenter/structure/useBoundSetup";
import { DISTRICT_SETUP } from "./structure/districtSetup";

export default function DistrictDashboardPage() {
  const setup = useBoundSetup(DISTRICT_SETUP); // its starting graph, while its graph file is empty
  return setup ? <DashboardPage scope="district" starter={setup} /> : <p className="page muted">Loading…</p>;
}
