/**
 * The Heat distribution card's figures of the planned network's typical year (networkCost.ts networkHours), in one
 * set of colours (district.css --nf-*): the year as a flow from what goes in (the data center's heat, used and left
 * unused, the heat pump's electricity, the peak boiler's gas) through the station to the buildings and the pipes'
 * losses; the months as stacked bars with the demand as a line; a winter day beside a summer day, hour by hour, on
 * one scale. A month or an hour clicked is shown on the map (the card's time controls follow). Plain SVG, each mark
 * with its figures in a tooltip.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { fmt } from "../../lib/format";
import { MONTHS } from "../datacenter/dashboard/seriesPeriod";
import type { DayHours, HeatYear, NetworkHours } from "./networkCost";
import { dayLabel } from "./networkView";

/** The series: the colour's class (district.css) and the name in the legend. */
export const SERIES = {
  dc: { cls: "nf-dc", name: "Heat pump: the data center's heat" },
  elec: { cls: "nf-elec", name: "Heat pump: electricity" },
  boiler: { cls: "nf-boiler", name: "Peak boiler (gas)" },
  spare: { cls: "nf-spare", name: "Data center's heat left over" }, // what the heat pump could still take
} as const;
type Key = keyof typeof SERIES;
const KEYS: Key[] = ["dc", "elec", "boiler", "spare"];

/** The legend of the bars: a swatch and the name for each series, the demand's line. */
export function FigureLegend() {
  return (
    <div className="nf-legend" aria-label="Colours of the figures">
      {KEYS.map((k) => (
        <span key={k}>
          <i className={SERIES[k].cls} />
          {SERIES[k].name}
        </span>
      ))}
      <span>
        <i className="nf-line" />
        Demand of the buildings
      </span>
    </div>
  );
}

/** A clickable mark's keys: Enter or space as a click. */
const keyed = (go: () => void) => ({
  role: "button",
  tabIndex: 0,
  onClick: go,
  onKeyDown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go()),
});

/** A round number at or above x for an axis (1, 1.5, 2, … 8 × 10^n): the bars fill most of the height. */
const niceMax = (x: number) => {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((f) => f * p >= x) ?? 10) * p;
};

/** The year as a flow, MWh a year: in (the data center's heat, used and unused; electricity; gas) → made at the
 * station (heat pump, peak boiler) → to the buildings and lost by the pipes. Rows on one scale, top to bottom. */
export function YearFlow({ y }: { y: HeatYear }) {
  const fade = `nf-fade${useId().replace(/:/g, "")}`; // one per figure: the card's and the dialog's
  const [W, BAR, G] = [260, 12, 8];
  const unused = Math.max(0, y.wasteMwh - y.sourceMwh);
  // of it, what the heat pump could still have taken (the months' "left over") and what the transmission line loses on
  // the way (the heat is the heat used: no exchanger share comes off it)
  const left = Math.max(0, (y.hours.usableKw * y.hours.takenKw.length) / 1000 - y.sourceMwh);
  const k = (W - 2 * G) / Math.max(1, unused + y.sourceMwh + y.hpElecMwh + y.boilerMwh);
  const w = (mwh: number) => Math.max(0, mwh * k);
  const [r1, r2, r3] = [18, 88, 152];
  const x0 = w(unused) + G; // the station's column
  const used = { x: x0, w: w(y.sourceMwh) };
  const elec = { x: used.x + used.w, w: w(y.hpElecMwh) };
  const gas = { x: elec.x + elec.w + G, w: w(y.boilerMwh) };
  const hp = { x: x0, w: w(y.hpMwh) };
  const boiler = { x: hp.x + hp.w + G, w: w(y.boilerMwh) };
  const sold = { x: x0, w: w(y.soldMwh) };
  const loss = { x: sold.x + sold.w + 2, w: w(y.lossMwh) };
  /** A band from [a, a + aw] at height ya down to [b, b + bw] at yb. */
  const band = (a: number, aw: number, ya: number, b: number, bw: number, yb: number) => {
    const m = (ya + yb) / 2;
    return `M${a},${ya}C${a},${m} ${b},${m} ${b},${yb}L${b + bw},${yb}C${b + bw},${m} ${a + aw},${m} ${a + aw},${ya}Z`;
  };
  const seg = (s: { x: number; w: number }, yy: number, cls: string, title: string, value: number, text = true) => (
    <g>
      <rect x={s.x} y={yy} width={Math.max(0.5, s.w)} height={BAR} rx={2} className={`nf-seg ${cls}`}>
        <title>{`${title}: ${fmt(value)} MWh/a`}</title>
      </rect>
      {text && s.w >= 40 && (
        <text x={s.x + 4} y={yy + BAR - 3} className="nf-in">
          {fmt(value)}
        </text>
      )}
    </g>
  );
  const head = (x: number, yy: number, t: ReactNode) => (
    <text x={x} y={yy - 5} className="nf-head">
      {t}
    </text>
  );
  const pct = (a: number, b: number) => (b > 0 ? fmt((100 * a) / b) : "0");
  return (
    <figure className="nf">
      <svg
        viewBox={`0 0 ${W} ${r3 + BAR + 4}`}
        role="img"
        aria-label={`The year: ${fmt(y.wasteMwh)} MWh of the data center's heat, ${fmt(y.sourceMwh)} used, ${fmt(y.hpElecMwh)} MWh electricity, ${fmt(y.boilerMwh)} MWh from the boiler, ${fmt(y.soldMwh)} MWh to the buildings, ${fmt(y.lossMwh)} MWh lost`}
      >
        <defs>
          <linearGradient id={fade} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="nf-fade-top" />
            <stop offset="1" className="nf-fade-end" />
          </linearGradient>
        </defs>
        {/* the bands first, the bars over them */}
        <path d={band(0, w(unused), r1 + BAR, 0, w(unused) * 0.6, r3 + BAR)} fill={`url(#${fade})`}>
          <title>{`The data center's heat left unused: ${fmt(unused)} MWh/a (${pct(unused, y.wasteMwh)} % of it): ${fmt(left)} left over, ${fmt(unused - left)} lost by the transmission line`}</title>
        </path>
        <path d={band(used.x, used.w, r1 + BAR, hp.x, used.w, r2)} className="nf-band nf-dc" />
        <path d={band(elec.x, elec.w, r1 + BAR, hp.x + used.w, elec.w, r2)} className="nf-band nf-elec" />
        <path d={band(gas.x, gas.w, r1 + BAR, boiler.x, boiler.w, r2)} className="nf-band nf-boiler" />
        <path d={band(hp.x, hp.w, r2 + BAR, sold.x, Math.min(hp.w, sold.w), r3)} className="nf-band nf-dc" />
        <path d={band(boiler.x, boiler.w, r2 + BAR, sold.x + Math.min(hp.w, sold.w), boiler.w, r3)} className="nf-band nf-boiler" />
        {head(0, r1, "The data center's heat · electricity · gas")}
        {seg({ x: 0, w: w(unused) }, r1, "nf-spare", `The data center's heat, unused (${fmt(left)} left over, ${fmt(unused - left)} lost on the way)`, unused)}
        {seg(used, r1, "nf-dc", "The data center's heat, used by the heat pump", y.sourceMwh)}
        {seg(elec, r1, "nf-elec", "The heat pump's electricity", y.hpElecMwh, false)}
        {seg(gas, r1, "nf-boiler", "The peak boiler's heat (from gas)", y.boilerMwh)}
        {w(unused) >= 46 && (
          <text x={4} y={(r2 + r3) / 2 + 12} className="nf-note">
            unused
          </text>
        )}
        {head(x0, r2, "At the station: heat pump · boiler")}
        {seg(hp, r2, "nf-dc", `From the heat pump (seasonal COP ${fmt(y.scop, 1)})`, y.hpMwh)}
        {seg(boiler, r2, "nf-boiler", "From the peak boiler", y.boilerMwh)}
        {head(x0, r3, `To the buildings · lost ${pct(y.lossMwh, y.soldMwh + y.lossMwh)} %`)}
        {seg(sold, r3, "nf-sold", "Sold to the buildings", y.soldMwh)}
        {seg(loss, r3, "nf-loss", "Lost by the pipes", y.lossMwh, false)}
      </svg>
      <figcaption className="nf-list">
        <span>
          <i className="nf-spare" /> unused {fmt(unused)} ({fmt(unused - left)} lost on the way)
        </span>
        <span>
          <i className="nf-dc" /> used {fmt(y.sourceMwh)}
        </span>
        <span>
          <i className="nf-elec" /> electricity {fmt(y.hpElecMwh)}
        </span>
        <span>
          <i className="nf-boiler" /> boiler {fmt(y.boilerMwh)}
        </span>
        <span>
          <i className="nf-sold" /> sold {fmt(y.soldMwh)}
        </span>
        <span>
          <i className="nf-loss" /> lost {fmt(y.lossMwh)}
        </span>
        <span className="nf-unit">MWh a year</span>
      </figcaption>
    </figure>
  );
}

/** Stacked bars on a shared axis: one per slot (a month, an hour), the demand as a line over them, `picked` marked. */
function Stacks({
  label,
  rows,
  demand,
  top,
  W,
  H,
  ticks,
  unit,
  picked,
  onPick,
  tip,
  solid,
}: {
  label: string;
  rows: Record<Key, number>[];
  demand: number[];
  top: number; // the axis' top
  W: number;
  H: number;
  ticks: { i: number; text: string }[]; // under the slots
  unit: (v: number) => string; // the axis' labels
  picked: number | null;
  onPick?: (i: number) => void; // without: the marks only show their figures
  tip: (i: number) => string;
  solid?: boolean; // the bars side by side without gaps (the hours of a day: an area)
}) {
  const [L, R, T, B] = [26, 2, 6, 14];
  const slot = (W - L - R) / rows.length;
  const bw = solid ? slot + 0.3 : Math.max(1.5, slot * 0.7); // solid: a hair over the slot, no seams between the hours
  const x = (i: number) => L + i * slot + (slot - bw) / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = demand.map((d, i) => `${i ? "L" : "M"}${(x(i) + bw / 2).toFixed(1)},${y(d).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className={solid ? "nf-stacks nf-stacks--solid" : "nf-stacks"}>
      {[0, top / 2, top].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="nf-grid" />
          <text x={L - 3} y={y(v) + 3} textAnchor="end" className="nf-axis">
            {unit(v)}
          </text>
        </g>
      ))}
      {picked != null && <rect x={L + picked * slot} y={T - 4} width={slot} height={H - T - B + 4} rx={3} className="nf-pick" />}
      {rows.map((r, i) => {
        let base = 0;
        return (
          <g key={i}>
            {KEYS.map((k) => {
              const v = Math.max(0, r[k]);
              const y0 = y(base + v);
              base += v;
              return v > 0 ? <rect key={k} x={x(i)} y={y0} width={bw} height={Math.max(0, y(base - v) - y0)} className={`nf-bar ${SERIES[k].cls}`} /> : null;
            })}
          </g>
        );
      })}
      <path d={line} className="nf-demand" />
      {ticks.map((t) => (
        <text key={t.i} x={x(t.i) + bw / 2} y={H - 3} textAnchor="middle" className="nf-axis">
          {t.text}
        </text>
      ))}
      {rows.map((_, i) => (
        <rect
          key={i}
          x={L + i * slot}
          y={0}
          width={slot}
          height={H}
          className="nf-hit"
          {...(onPick ? { "aria-label": tip(i), ...keyed(() => onPick(i)) } : {})}
        >
          <title>{tip(i)}</title>
        </rect>
      ))}
    </svg>
  );
}

const mwh = (v: number) => fmt(v);
const mw = (kw: number) => fmt(kw / 1000, kw && kw < 10_000 ? 1 : 0);

/** Month by month, MWh: the heat pump's heat (the data center's and its electricity), the boiler's, the data
 * center's heat left over (what the heat pump could still take); the demand as a line. */
export function MonthBars({ m, picked, onPick }: { m: NetworkHours["months"]; picked: number | null; onPick?: (month: number) => void }) {
  const rows = MONTHS.map((_, i) => ({ dc: m.taken[i], elec: m.hpElec[i], boiler: m.boiler[i], spare: m.spare[i] }));
  const top = niceMax(Math.max(...rows.map((r) => r.dc + r.elec + r.boiler + r.spare), ...m.demand));
  const tip = (i: number) =>
    `${MONTHS[i]}: demand ${fmt(m.demand[i])} MWh (+ ${fmt(m.loss[i])} lost) · heat pump ${fmt(m.hp[i])} (the data center's ${fmt(m.taken[i])}, electricity ${fmt(m.hpElec[i])}) · boiler ${fmt(m.boiler[i])} · left over ${fmt(m.spare[i])} MWh`;
  return (
    <Stacks
      label="Month by month, MWh: the heat pump's heat, the boiler's and the data center's heat left over, with the demand"
      rows={rows}
      demand={m.demand}
      top={top}
      W={260}
      H={118}
      ticks={MONTHS.map((n, i) => ({ i, text: n[0] }))}
      unit={mwh}
      picked={picked}
      onPick={onPick}
      tip={tip}
    />
  );
}

/** A winter day beside a summer day, hour by hour on one scale, MW. */
export function DayPair({ x, h, onHour }: { x: NetworkHours; h: number | null; onHour?: (h: number) => void }) {
  const y = x.year;
  const rowsOf = (d: DayHours) =>
    d.demandKw.map((_, i) => {
      const at = d.first + i;
      return { dc: y.takenKw[at], elec: y.hpElecKw[at], boiler: d.boilerKw[i], spare: d.spareKw[i] };
    });
  const days = [
    { name: "Winter", d: x.winter },
    { name: "Summer", d: x.summer },
  ].map((o) => ({ ...o, rows: rowsOf(o.d), mean: o.d.outdoorC.reduce((a, b) => a + b, 0) / 24 }));
  const top = niceMax(Math.max(...days.flatMap((o) => [...o.rows.map((r) => r.dc + r.elec + r.boiler + r.spare), ...o.d.demandKw])));
  return (
    <div className="nf-days">
      {days.map(({ name, d, rows, mean }) => (
        <figure key={name} className="nf">
          <figcaption className="nf-day-head">
            <b>{name}</b> {dayLabel(d.day)} · {fmt(mean, 1)} °C
          </figcaption>
          <Stacks
            label={`${name}: ${dayLabel(d.day)} hour by hour, MW`}
            rows={rows}
            demand={d.demandKw}
            top={top}
            W={128}
            H={96}
            ticks={[0, 6, 12, 18].map((i) => ({ i, text: String(i) }))}
            unit={mw}
            solid
            picked={h != null && h >= d.first && h < d.first + 24 ? h - d.first : null}
            onPick={onHour && ((i) => onHour(d.first + i))}
            tip={(i) =>
              `${dayLabel(d.day)}, ${String(i).padStart(2, "0")}:00 · ${fmt(d.outdoorC[i], 1)} °C · demand ${mw(d.demandKw[i])} MW · heat pump ${mw(d.hpKw[i])} · boiler ${mw(d.boilerKw[i])} · left over ${mw(d.spareKw[i])} MW`
            }
          />
        </figure>
      ))}
    </div>
  );
}
