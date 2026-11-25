/**
 * What the Planning page's KPI boxes show on a click (Kpi info): the delivered heat as households and showers, the
 * CO₂ saved as cars and trees (lib/heatFacts.ts), each line with how it is counted.
 */
import { fmt } from "../../lib/format";
import { co2Basis } from "../../lib/partKpis";
import { CAR_T, HOUSEHOLD_MWH, PEOPLE_PER_HOUSEHOLD, SHOWER_KWH, TREE_KG, type HeatFacts } from "../../lib/heatFacts";

function Rows({ rows, note }: { rows: [string, string][]; note: string }) {
  return (
    <>
      <dl className="heat-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="heat-facts__note">{note}</p>
    </>
  );
}

export const HouseholdsInfo = ({ f, demandMwh, deliveredMwh }: { f: HeatFacts; demandMwh: number; deliveredMwh: number }) => (
  <Rows
    rows={[
      ["Households heated a year", fmt(f.households)],
      ["People in them", `≈ ${fmt(f.people)}`],
      ["Households the whole demand would be", fmt((f.households * demandMwh) / Math.max(deliveredMwh, 1e-9))],
      ["Heat per household", `${fmt(HOUSEHOLD_MWH)} MWh/a`],
    ]}
    note={`The delivered heat ÷ ${fmt(HOUSEHOLD_MWH)} MWh a year per household (heating and hot water, ~70 m²), ${fmt(PEOPLE_PER_HOUSEHOLD)} people each (Destatis). A rough figure for its size.`}
  />
);

export const ShowersInfo = ({ f }: { f: HeatFacts }) => (
  <Rows
    rows={[
      ["Showers a year", fmt(f.showers)],
      ["Showers a day", fmt(f.showersPerDay)],
      ["Per household and day", fmt(f.showersPerHouseholdDay, 1)],
      ["Heat of one shower", `${fmt(SHOWER_KWH, 1)} kWh`],
    ]}
    note={`The delivered heat as 5-minute showers: ~40 L warmed from 10 to 38 °C, ${fmt(SHOWER_KWH, 1)} kWh with the storage's and pipes' losses. Most of the heat warms rooms; this only shows how much heat it is.`}
  />
);

export const Co2Info = ({ f, co2T }: { f: HeatFacts; co2T: number }) => (
  <Rows
    rows={[
      ["CO₂ saved", `${fmt(co2T)} t`],
      ["Cars off the road a year", fmt(f.cars)],
      ["Trees taking it up a year", fmt(f.trees)],
    ]}
    note={`Against gas heating, minus the heat pump's grid electricity: ${co2Basis()}. A car ~${fmt(CAR_T, 1)} t a year (~12,500 km at ~150 g/km), a grown tree ~${fmt(TREE_KG)} kg a year: rough figures.`}
  />
);
