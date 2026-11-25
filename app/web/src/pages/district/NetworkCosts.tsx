/**
 * The Heat distribution card's dialog (HeatNetwork.tsx): what the planned network costs, line by line and the pipes by
 * DN; its year (the heat pump, the peak boiler, the losses); the cash flows over the horizon with the cumulative
 * discounted cash flow drawn and the break-even marked; and every assumption to change, each with where its default
 * comes from (networkCost.ts); the year's figures as on the card, larger (networkFigures.tsx). A change is kept in
 * this browser and the card follows it at once.
 */
import { Fragment } from "react";
import { fmt } from "../../lib/format";
import { Dialog } from "../../ui/Dialog";
import { NumberField } from "../../ui/NumberField";
import { Segmented } from "../../ui/Segmented";
import { Switch } from "../../ui/Switch";
import type { HeatNetwork } from "./network";
import { DayPair, FigureLegend, MonthBars, YearFlow } from "./networkFigures";
import {
  BEW_M4_SOURCE,
  BEW_SOURCE,
  DEFAULT_PARAMS,
  HEAT_VAT_PCT,
  PARAMS,
  PIPE_SOURCE,
  pipesOver,
  type CashFlow,
  type Economics,
  type NetworkHours,
  type NetworkParams,
  type ParamDef,
  type Source,
} from "./networkCost";

const keur = (x: number) => fmt(x / 1000);
const KINDS = { transmission: "Transmission line", distribution: "Distribution pipes", service: "House connections" } as const;

function SourceLink({ s }: { s: Source }) {
  return s.url ? (
    <a href={s.url} target="_blank" rel="noreferrer">
      {s.label}
    </a>
  ) : (
    <span>{s.label}</span>
  );
}

/** The cumulative discounted cash flow, year 0 to the horizon, with the zero line and the break-even marked; a year's
 * figures on hover. */
function Cumulative({ flows, breakEven }: { flows: CashFlow[]; breakEven: number | null }) {
  const [W, H, L, R, T, B] = [640, 190, 56, 12, 14, 26];
  const lo = Math.min(0, ...flows.map((f) => f.cum));
  const hi = Math.max(0, ...flows.map((f) => f.cum));
  const span = hi - lo || 1;
  const N = Math.max(1, flows.length - 1);
  const x = (i: number) => L + ((W - L - R) * i) / N;
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / span;
  const line = flows.map((f, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f.cum).toFixed(1)}`).join("");
  const area = `${line}L${x(N).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  // where it crosses zero, between the year before the break-even and it
  const a = breakEven ? flows[breakEven - 1].cum : 0;
  const b = breakEven ? flows[breakEven].cum : 0;
  const cross = breakEven ? breakEven - 1 + (b > a ? -a / (b - a) : 1) : null;
  const step = N > 20 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(N / step) + 1 }, (_, i) => i * step);
  const w = (W - L - R) / N;
  return (
    <figure className="net__chart">
      <figcaption className="caps">Cumulative discounted cash flow, M€ by year</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cumulative discounted cash flow; break-even ${breakEven == null ? "not reached" : `in year ${breakEven}`}`}
      >
        {[hi, 0, lo].map((v, i) => (
          <text key={i} x={L - 6} y={y(v) + 4} className="net__chart-label" textAnchor="end">
            {fmt(v / 1e6, 1)}
          </text>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="net__chart-label" textAnchor="middle">
            {t}
          </text>
        ))}
        <path d={area} className="net__chart-area" />
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="net__chart-zero" />
        <path d={line} className="net__chart-line" />
        {cross != null && (
          <g>
            <line x1={x(cross)} x2={x(cross)} y1={T} y2={H - B} className="net__chart-even-line" />
            <circle cx={x(cross)} cy={y(0)} r={5} className="net__chart-even" />
            <text
              x={x(cross) + (cross > N / 2 ? -8 : 8)}
              y={T + 10}
              textAnchor={cross > N / 2 ? "end" : "start"}
              className="net__chart-label net__chart-label--even"
            >
              break-even in year {breakEven}
            </text>
          </g>
        )}
        {flows.map((f, i) => (
          <g key={f.year} className="net__chart-hit">
            <rect x={x(i) - w / 2} y={T} width={w} height={H - T - B} />
            <circle cx={x(i)} cy={y(f.cum)} r={4} />
            <title>{`Year ${f.year}: ${fmt(f.disc / 1e6, 2)} M€ discounted, ${fmt(f.cum / 1e6, 2)} M€ cumulative`}</title>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export default function NetworkCosts({
  econ,
  net,
  hours,
  params,
  onParams,
  onClose,
}: {
  econ: Economics;
  net: HeatNetwork;
  hours: NetworkHours | null;
  params: NetworkParams;
  onParams: (p: NetworkParams) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof NetworkParams>(k: K, v: NetworkParams[K]) => onParams({ ...params, [k]: v });
  // the pipes of each kind by DN: metres, €/m and €
  const byDn = (kind: keyof typeof KINDS) => {
    const rows = new Map<number, { m: number; eur: number; eurPerM: number }>();
    for (const x of econ.pipes)
      if (x.pipe.kind === kind) {
        const r = rows.get(x.dn.dn) ?? { m: 0, eur: 0, eurPerM: x.eurPerM };
        rows.set(x.dn.dn, { ...r, m: r.m + x.pipe.m * x.dn.n, eur: r.eur + x.eur }); // pipes side by side count their metres each
      }
    return [...rows.entries()].filter(([, r]) => r.m >= 0.5).sort((p, q) => q[0] - p[0]); // not a 0 m one (a street through the building)
  };
  const y = econ.year;
  // pipes above the largest DN's capacity at their ΔT: priced as several side by side, said here (the map's tooltip names each)
  const tooSmall = pipesOver(econ.pipes, (x) => (x.pipe.kind === "transmission" ? params.sourceDtK : Math.max(1, econ.supplyC - econ.returnC)));
  const field = (d: ParamDef) => (
    <div key={d.key} className="net__param">
      <NumberField
        label={d.label}
        value={params[d.key]}
        onChange={(v) => set(d.key, v)}
        min={d.min}
        max={d.max}
        step={d.step}
        unit={d.unit}
        grouped={d.max >= 10_000}
      />
      <div className="net__param-source">
        <SourceLink s={d.source} />
        {params[d.key] !== DEFAULT_PARAMS[d.key] && <span> · default {fmt(DEFAULT_PARAMS[d.key], d.step < 1 ? 1 : 0)}</span>}
        {d.note && <span> · {d.note}</span>}
      </div>
    </div>
  );
  const group = (g: ParamDef["group"]) => PARAMS.filter((d) => d.group === g).map(field);
  const vat = 1 + HEAT_VAT_PCT / 100;
  const aptMwh = econ.apartments ? y.soldMwh / econ.apartments : 0; // the year's first: demand falls as buildings are renovated
  const eurPerM = net.totalM ? econ.pipes.reduce((a, x) => a + x.eur, 0) / net.totalM : 0;

  return (
    <Dialog label="Heat distribution: costs and assumptions" onClose={onClose} className="net__dialog">
      <div className="net__dialog-head">
        <h2>Heat distribution: costs and assumptions</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="muted">
        {fmt(net.chosen.length)} buildings, {fmt(net.totalM)} m of pipe ({fmt(eurPerM)} €/m on average), {fmt(y.soldMwh)} MWh a year sold. Investment{" "}
        {fmt(econ.invest / 1e6, 2)} M€ after grants, net present value {fmt(econ.npv / 1e6, 2)} M€ over {fmt(params.years)} years, break-even{" "}
        {econ.breakEven == null ? `not within ${fmt(params.years)} years` : `in year ${fmt(econ.breakEven)}`}, heat at {fmt(econ.lcoh)} €/MWh. All in € of each
        year (rising with the prices: the discount rate is a nominal one), net of VAT, as the network&apos;s operator sees it (no taxes, no financing); the heat price is paid by the apartments it supplies (below).
      </p>

      <div className="net__dialog-grid">
        <section>
          <span className="caps">Investment</span>
          <table className="net__table" aria-label="Investment">
            <thead>
              <tr>
                <th>Item</th>
                <th>How</th>
                <th className="num">k€</th>
              </tr>
            </thead>
            <tbody>
              {econ.lines.map((l) => (
                <Fragment key={l.key}>
                  <tr>
                    <td>{l.label}</td>
                    <td className="muted">{l.detail}</td>
                    <td className="num">{keur(l.eur)}</td>
                  </tr>
                  {l.key in KINDS &&
                    byDn(l.key as keyof typeof KINDS).map(([dn, r]) => (
                      <tr key={`${l.key}-${dn}`} className="net__table-sub">
                        <td>DN {dn}</td>
                        <td className="muted">
                          {fmt(r.m)} m × {fmt(r.eurPerM)} €/m
                        </td>
                        <td className="num">{keur(r.eur)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
              <tr className="net__table-total">
                <td colSpan={2}>Investment before grants</td>
                <td className="num">{keur(econ.capex)}</td>
              </tr>
              <tr>
                <td>BEW grant</td>
                <td className="muted">
                  {econ.bewWhy
                    ? `none: ${econ.bewWhy}`
                    : econ.gap
                      ? `Modul 2: up to ${fmt(params.bewPct)} % of the eligible (not the gas boiler), first, at most the funding gap of ${keur(econ.gap)} k€; the operating aid only for what of the gap is left; Modul 1: half the study`
                      : "Modul 2 and the operating aid: none, no funding gap (the network pays without BEW); Modul 1: half the study"}
                </td>
                <td className="num">−{keur(econ.grant)}</td>
              </tr>
              <tr className="net__table-total">
                <td colSpan={2}>Investment after grants</td>
                <td className="num">{keur(econ.invest)}</td>
              </tr>
            </tbody>
          </table>
          {tooSmall && (
            <div className="site__hint net__problem" role="note" aria-label="Pipes too small">
              {tooSmall}
            </div>
          )}
          <div className="site__hint">
            Pipes: <SourceLink s={PIPE_SOURCE} />; each run the smallest DN that carries its largest hour of the typical year (its buildings&apos; hours summed,
            at least their design peaks on a day at −12 °C × simultaneity) at {fmt(econ.supplyC)}/{fmt(econ.returnC)} °C, the transmission line the data center&apos;s heat at{" "}
            {fmt(params.sourceDtK)} K.
          </div>
        </section>

        <section>
          <span className="caps">The year (typical, hourly)</span>
          <table className="net__table" aria-label="The year">
            <tbody>
              <tr>
                <td>Heat sold to the buildings</td>
                <td className="num">{fmt(y.soldMwh)} MWh</td>
              </tr>
              <tr>
                <td>from the heat pump (seasonal COP {fmt(y.scop, 1)})</td>
                <td className="num">{fmt(y.hpMwh)} MWh</td>
              </tr>
              <tr>
                <td>from the gas peak boiler</td>
                <td className="num">{fmt(y.boilerMwh)} MWh</td>
              </tr>
              <tr>
                <td>lost by the pipes ({fmt(econ.lossShare * 100, 1)} %)</td>
                <td className="num">{fmt(y.lossMwh)} MWh</td>
              </tr>
              <tr>
                <td>heat pump electricity</td>
                <td className="num">{fmt(y.hpElecMwh)} MWh</td>
              </tr>
              <tr>
                <td>{"network pumps' electricity"}</td>
                <td className="num">{fmt(econ.pumpMwh)} MWh</td>
              </tr>
              <tr>
                <td>data center&apos;s heat used</td>
                <td className="num">
                  {fmt(y.sourceMwh)} of {fmt(y.wasteMwh)} MWh
                </td>
              </tr>
              <tr>
                <td>
                  BEW operating aid (<SourceLink s={BEW_M4_SOURCE} />)
                </td>
                <td className="num">
                  {econ.m4EurPerMwh
                    ? econ.m4PaidEurPerMwh < econ.m4EurPerMwh - 0.05
                      ? `${fmt(econ.m4PaidEurPerMwh, 1)} €/MWh in year 1 (the rate, ${fmt(econ.m4EurPerMwh, 1)} €/MWh, cut to 90 % of the heat pump's electricity cost), 10 years`
                      : `${fmt(econ.m4EurPerMwh, 1)} €/MWh, 10 years`
                    : !econ.bewWhy && !econ.gap && params.bewOperating
                      ? "none: no funding gap"
                      : "none"}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="site__hint">
            The heat pump is{" "}
            {params.fullPeak
              ? "sized to the buildings' design peak"
              : `sized to ${fmt(params.hpSharePct)} % of the network's peak hour (larger if ${fmt(params.dcSharePct)} % of the year's heat from the data center needs it)`}{" "}
            ({fmt(econ.hpKw)} kW; the data center&apos;s heat allows {fmt(econ.capacityKw)} kW): {fmt(econ.dcShare * 100)} % of the heat, the gas peak boiler{" "}
            {fmt(econ.boilerShare * 100)} %. The hour by hour run (Heat Matching&apos;s formulas, no tank) sums the buildings&apos; profiles, each a typical
            building&apos;s hour: the peak boiler ({fmt(econ.boilerKw)} kW), the pipes and the network pumps are sized for its largest hour, at least for the
            buildings&apos; design peaks on a day at −12 °C × simultaneity.
          </div>
          <span className="caps">Per apartment</span>
          <table className="net__table" aria-label="Per apartment">
            <tbody>
              <tr>
                <td>{`Apartments supplied (a building's heat ÷ ${fmt(params.aptMwh, 1)} MWh where its data gives none)`}</td>
                <td className="num">{fmt(econ.apartments)}</td>
              </tr>
              <tr>
                <td>Heat of one apartment</td>
                <td className="num">{`${fmt(aptMwh, 1)} MWh/a`}</td>
              </tr>
              <tr>
                <td>{`It pays, at ${fmt(params.heatPrice)} €/MWh + ${HEAT_VAT_PCT} % VAT`}</td>
                <td className="num">{`${fmt(aptMwh * params.heatPrice * vat)} €/a · ${fmt((aptMwh * params.heatPrice * vat) / 12)} €/month`}</td>
              </tr>
              <tr>
                <td>{`What its heat costs to make (${fmt(econ.lcoh)} €/MWh) + VAT`}</td>
                <td className="num">{`${fmt(aptMwh * econ.lcoh * vat)} €/a`}</td>
              </tr>
            </tbody>
          </table>
          <Cumulative flows={econ.flows} breakEven={econ.breakEven} />
        </section>
      </div>

      {hours && (
        <section className="net__figures" aria-label="The year in figures">
          <span className="caps">The year in figures</span>
          <div className="net__figures-grid">
            <div>
              <span className="site__hint">The year, MWh: in, made at the station, delivered</span>
              <YearFlow y={y} />
            </div>
            <div>
              <span className="site__hint">Month by month, MWh</span>
              <FigureLegend />
              <MonthBars m={hours.months} picked={null} />
            </div>
            <div>
              <span className="site__hint">The coldest and the warmest day, MW</span>
              <DayPair x={hours} h={null} />
            </div>
          </div>
        </section>
      )}

      <details className="net__flows">
        <summary>Cash flows by year (k€)</summary>
        <table className="net__table" aria-label="Cash flows">
          <thead>
            <tr>
              <th className="num">Year</th>
              <th className="num">Heat sold</th>
              <th className="num">Energy</th>
              <th className="num">O&amp;M</th>
              <th className="num">BEW aid</th>
              <th className="num">Renewal</th>
              <th className="num">Residual</th>
              <th className="num">Net</th>
              <th className="num">Discounted</th>
              <th className="num">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {econ.flows.map((f) => (
              <tr key={f.year} className={f.year === econ.breakEven ? "net__table-even" : undefined}>
                <td className="num">{f.year}</td>
                <td className="num">{keur(f.revenue)}</td>
                <td className="num">{keur(-f.energy)}</td>
                <td className="num">{keur(-f.om)}</td>
                <td className="num">{keur(f.subsidy)}</td>
                <td className="num">{keur(-f.reinvest)}</td>
                <td className="num">{keur(f.residual)}</td>
                <td className="num">{keur(f.net)}</td>
                <td className="num">{keur(f.disc)}</td>
                <td className="num">{keur(f.cum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="site__hint">
          Energy: the heat pump&apos;s and the pumps&apos; electricity, the boiler&apos;s gas and its CO₂ price, the waste heat bought. Year 0: the investment
          after grants. The last year adds what is left of the pipes, the heat pump and the substations (straight-line over their lives).
        </div>
      </details>

      <section className="net__assumptions">
        <div className="net__dialog-head">
          <span className="caps">Assumptions</span>
          <button type="button" className="btn btn--sm" onClick={() => onParams(DEFAULT_PARAMS)}>
            Back to the defaults
          </button>
        </div>
        <div className="net__toggles">
          <Segmented<NetworkParams["area"]>
            label="Where the pipes are laid"
            value={params.area}
            onChange={(v) => set("area", v)}
            options={[
              { id: "inner_city", label: "Inner city" },
              { id: "suburban", label: "Suburban" },
            ]}
          />
          <Switch checked={params.bew} onChange={(v) => set("bew", v)} label="BEW grant" />
          <Switch checked={params.bewOperating} onChange={(v) => set("bewOperating", v)} label="BEW operating aid (Modul 4)" />
          <Switch checked={params.residual} onChange={(v) => set("residual", v)} label="Residual value at the end" />
          <Switch checked={params.fullPeak} onChange={(v) => set("fullPeak", v)} label="Heat pump for the full peak (no buildings beyond it)" />
          <span className="site__hint">
            <SourceLink s={BEW_SOURCE} /> (the guideline runs until 2028: check its successor for later projects)
          </span>
        </div>
        <div className="net__params">
          {(["Investment", "Operation", "Money"] as const).map((g) => (
            <div key={g}>
              <span className="caps site__sub-head">{g}</span>
              {group(g)}
            </div>
          ))}
        </div>
      </section>
    </Dialog>
  );
}
