/**
 * Heat Matching's figures in detail, under the KPIs (KpiRow `detail`): the heat balance (where the delivered heat
 * comes from), the data center's heat, the heat pump, the storage and the peaks, each worked out from the matching's
 * hours (lib/matching.ts), and the CO₂ with its factors.
 */
import { fmt } from "../../lib/format";
import type { MatchResult } from "../../lib/matching";
import { CO2, co2SavedT } from "../../lib/partKpis";

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const max = (xs: number[]) => xs.reduce((a, x) => Math.max(a, x), 0);

export function MatchDetail({ res, demand, stepHours }: { res: MatchResult; demand: number[]; stepHours: number }) {
  const T = res.totals;
  const mwh = (xs: number[]) => (sum(xs) * stepHours) / 1000;
  const pct = (part: number) => (T.deliveredMwh ? (100 * part) / T.deliveredMwh : 0);
  const direct = mwh(res.direct);
  const hp = mwh(res.hp);
  const tank = mwh(res.fromTank);
  const hpHours = res.viaHp.filter((on, i) => on && res.hp[i] + res.charge[i] > 0).length * stepHours;
  const cops = res.cop.filter((c, i) => res.viaHp[i] && c > 0);
  const meanCop = cops.length ? sum(cops) / cops.length : 0;
  const unmetHours = res.unmet.filter((u) => u > 1e-6).length * stepHours;
  const groups: { title: string; rows: [string, string, string?][] }[] = [
    {
      title: "Heat balance",
      rows: [
        ["Demand", `${fmt(T.demandMwh)} MWh`],
        ["Delivered", `${fmt(T.deliveredMwh)} MWh`, `${fmt(T.coveragePct, 1)} % of the demand`],
        ["· directly (heat exchanger)", `${fmt(direct)} MWh`, `${fmt(pct(direct), 0)} %`],
        ["· by the heat pump", `${fmt(hp)} MWh`, `${fmt(pct(hp), 0)} %`],
        ["· from the storage", `${fmt(tank)} MWh`, `${fmt(pct(tank), 0)} %`],
        ["Unmet", `${fmt(T.unmetMwh)} MWh`, `in ${fmt(unmetHours)} h`],
      ],
    },
    {
      title: "Data center heat",
      rows: [
        ["Used", `${fmt(T.dcUsedPct, 0)} %`, "of the heat it gives off"],
        ["Surplus", `${fmt(T.surplusMwh)} MWh`, "recoverable, no taker"],
      ],
    },
    {
      title: "Heat pump",
      rows: [
        ["Runs", `${fmt(hpHours)} h`, `of ${fmt(T.hours)} h`],
        ["Electricity", `${fmt(T.hpElecMwh, 1)} MWh`, `peak ${fmt(max(res.hpElec))} kW`],
        ["SPF", T.spf ? fmt(T.spf, 2) : "–", "its heat / its electricity, over the period"],
        ["Mean COP", meanCop ? fmt(meanCop, 2) : "–", "while it runs"],
      ],
    },
    {
      title: "Storage and peaks",
      rows: [
        ["Charged", `${fmt(mwh(res.charge))} MWh`, `highest level ${fmt(max(res.tankLevel))} kWh`],
        ["Peak demand", `${fmt(max(demand))} kW`],
        ["Peak unmet", `${fmt(max(res.unmet))} kW`],
        ["Hours fully met", `${fmt(T.hoursCovered)} h`, `of ${fmt(T.demandHours)} h with demand`],
      ],
    },
    {
      title: "CO₂ saved",
      rows: [
        ["Saved", `${fmt(co2SavedT(T.deliveredMwh, T.hpElecMwh))} t`],
        ["Gas not burnt", `${fmt((T.deliveredMwh * CO2.gas) / CO2.boiler)} t`, `${CO2.gas} kg/kWh, boiler ${CO2.boiler * 100} %`],
        ["Heat pump's grid power", `− ${fmt(T.hpElecMwh * CO2.grid)} t`, `${CO2.grid} kg/kWh`],
      ],
    },
  ];
  return (
    <div className="match-detail" aria-label="Heat Matching in detail">
      {groups.map((g) => (
        <section key={g.title} className="match-detail__group">
          <h3 className="caps">{g.title}</h3>
          <dl>
            {g.rows.map(([k, v, note]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="mono">{v}</dd>
                {note && <dd className="match-detail__note">{note}</dd>}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
