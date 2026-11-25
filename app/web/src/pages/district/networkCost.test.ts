/** The heat network's money: pipe sizes, the BEW operating aid, the station's capacity, and the cash flows of a small
 * synthetic street of houses (the NPV their sum, the break-even where it turns, prices and grants moving it); the
 * heat pump and the peak boiler's split; the plan hour by hour for the time view. */
import { describe, expect, test } from "vitest";
import type { HeatPoint, Site } from "../../api";
import { buildingsOf, planNetwork, simultaneity } from "./network";
import { bewOperatingEurPerMwh, capacityOnCurve, copLabel, DEFAULT_PARAMS, heatYear, hourAt, networkEconomics, networkHours, PARAMS, pipeDn, pipesOver, wholeYears, type NetworkParams } from "./networkCost";
import { stationCapacity } from "./hpSizing";
import { demandEntries } from "../../lib/demand";
import { translator } from "../../lib/i18n";
import DE from "../../lib/i18n.de";
import { CO2, co2Basis, co2Short } from "../../lib/partKpis";
import { designKw, sinkKw, YEAR_TIMES, yearSupply } from "./quickAnalysis";

// metres east (x) and north (y) of 50° N, 8° E as [lat, lon]
const M = 111_194.9;
const P = (x: number, y: number): [number, number] => [50 + y / M, 8 + x / (M * Math.cos((50 * Math.PI) / 180))];

test("pipeDn: the smallest DN that carries the load, more with a larger ΔT; the largest flagged when none does", () => {
  expect(pipeDn(200, 30).dn).toBe(50); // DN50 carries 243 kW at 30 K
  expect(pipeDn(250, 30).dn).toBe(65);
  expect(pipeDn(200, 10).dn).toBe(80); // a third of the ΔT: 750 kW at 30 K is 250 kW at 10 K
  expect(pipeDn(1e6, 30)).toMatchObject({ dn: 300, over: true });
  expect(pipeDn(0, 30)).toMatchObject({ dn: 20, over: false });
});

test("BEW operating aid: (5.5 − (6.8 − 17/SCOP) · 0.75) ct per kWh of heat, none below SCOP 2.5", () => {
  expect(bewOperatingEurPerMwh(4.3)).toBeCloseTo(33.65, 1); // 4.39 ct per kWh of waste heat
  expect(bewOperatingEurPerMwh(2.4)).toBe(0);
  expect(bewOperatingEurPerMwh(3)).toBeCloseTo(10 * (5.5 - (6.8 - 17 / 3) * 0.75), 6);
});

/** 20 houses of 200 MWh a year (their typical year: buildingsOf) on one 400 m street north of a data center of 1.5 MW
 * at 30 °C. */
function street(p: NetworkParams = DEFAULT_PARAMS) {
  const sinks: HeatPoint[] = Array.from({ length: 20 }, (_, i) => ({
    id: `h${i}`,
    name: `House ${i}`,
    lat: P(20 + i * 20, 15)[0],
    lon: P(20 + i * 20, 15)[1],
    temp_c: 70,
    power_kw: 80,
    demand: { houses: 1, kwhPerHouse: 200_000, supplyTemp: 70, returnTemp: 40 },
  }));
  const site: Site = { building: null, source: { id: "dc", name: "DC", lat: P(0, -10)[0], lon: P(0, -10)[1], temp_c: 30, power_kw: 1500 }, sinks };
  const net = planNetwork({
    streets: [{ kind: "road", line: [P(0, 0), P(420, 0)] }],
    source: site.source!,
    buildings: buildingsOf(site),
    capacityKw: capacityOnCurve(site.source, 70, 40), // as the page: the ceiling on the heating curve
    station: { lat: P(0, 0)[0], lon: P(0, 0)[1] },
    hpShare: p.hpSharePct / 100,
    minDcShare: p.dcSharePct / 100,
    fullPeak: p.fullPeak,
  });
  return { site, net };
}

test("the cash flows: the NPV is their discounted sum, the break-even where the cumulative turns positive", () => {
  const { site, net } = street();
  expect(net.chosen).toHaveLength(20);
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  expect(e.apartments).toBe(20 * Math.round(200 / DEFAULT_PARAMS.aptMwh)); // a building's heat ÷ one apartment's
  expect(e.flows).toHaveLength(DEFAULT_PARAMS.years + 1);
  expect(e.flows[0].net).toBeCloseTo(-e.invest, 6);
  expect(e.npv).toBeCloseTo(
    e.flows.reduce((a, f) => a + f.net / 1.05 ** f.year, 0),
    3,
  );
  expect(e.year.soldMwh).toBeCloseTo(4000, 0); // all the demand is sold
  expect(e.year.hpMwh + e.year.boilerMwh).toBeCloseTo(e.year.soldMwh + e.year.lossMwh, 0); // heat pump + boiler make it all
  expect(e.capex).toBeCloseTo(
    e.lines.reduce((a, l) => a + l.eur, 0),
    6,
  );
  if (e.breakEven != null) {
    expect(e.flows[e.breakEven].cum).toBeGreaterThanOrEqual(0);
    expect(e.flows[e.breakEven - 1].cum).toBeLessThan(0);
  }
  // pipes sized by their load: the trunk at the station carries more than the last house's run
  const dist = e.pipes.filter((x) => x.pipe.kind === "distribution");
  expect(Math.max(...dist.map((x) => x.dn.dn))).toBeGreaterThan(Math.min(...dist.map((x) => x.dn.dn)));
});

test("a higher heat price, a grant and a lower discount rate raise the NPV; no grant below 17 buildings and 101 dwellings", () => {
  const { site, net } = street();
  const npv = (p: Partial<NetworkParams>) => networkEconomics(site, net, { ...DEFAULT_PARAMS, ...p }).npv;
  expect(npv({ heatPrice: 150 })).toBeGreaterThan(npv({ heatPrice: 130 }));
  expect(npv({ bew: true })).toBeGreaterThan(npv({ bew: false }));
  expect(npv({ discountPct: 3 })).toBeGreaterThan(npv({ discountPct: 7 }));
  const off = networkEconomics(site, net, { ...DEFAULT_PARAMS, bew: false });
  expect(off).toMatchObject({ grant: 0, bewWhy: "switched off", m4EurPerMwh: 0 });
  expect(off.invest).toBeCloseTo(off.capex, 6);
  // 4 houses of 200 MWh: 88 dwellings (10 of them are 220 dwellings: more than BEW's 100, so no longer refused)
  const few = { ...net, chosen: net.chosen.slice(0, 4) };
  expect(networkEconomics(site, few, DEFAULT_PARAMS).bewWhy).toMatch(/only 4 buildings and 88 dwellings/);
  expect(networkEconomics(site, { ...net, chosen: net.chosen.slice(0, 10) }, DEFAULT_PARAMS).bewWhy ?? "").not.toMatch(/buildings/);
});

test("BEW aid is at most the funding gap: none when the network pays without it, else the NPV up to 0", () => {
  const { site, net } = street();
  const at = (heatPrice: number) => networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice });
  const m1 = DEFAULT_PARAMS.studyEur / 2;
  const full = (e: ReturnType<typeof at>) => (e.lines.filter((l) => l.eligible).reduce((a, l) => a + l.eur, 0) * DEFAULT_PARAMS.bewPct) / 100;
  const rate = bewOperatingEurPerMwh(at(130).year.scop);
  const pays = at(130); // it pays without BEW: Modul 1 only, no grant, no operating aid
  expect(pays).toMatchObject({ gap: 0, grant: m1, m4EurPerMwh: 0 });
  expect(pays.npv).toBeGreaterThan(0);
  expect(pays.lcoh).toBeLessThan(130);
  // K10: the investment grant (Modul 2) comes first, the operating aid (Modul 4) only for what of the gap is left
  // (it was the other way round: the operating aid used up first)
  const little = at(pays.lcoh - 4); // a small gap (4 €/MWh under the cost of heat): the Modul 2 grant alone closes it
  expect(little.gap).toBeGreaterThan(0);
  expect(little.gap).toBeLessThan(full(little));
  expect(little.grant).toBeCloseTo(m1 + little.gap, 3);
  expect(little.m4EurPerMwh).toBe(0);
  expect(little.npv).toBeCloseTo(0, 3);
  const closed = at(80); // more than the 40 %: the whole Modul 2 grant, and the operating aid, cut to the rest, close it
  expect(closed.gap).toBeGreaterThan(full(closed));
  expect(closed.grant).toBeCloseTo(m1 + full(closed), 3);
  expect(closed.m4EurPerMwh).toBeGreaterThan(0);
  expect(closed.m4EurPerMwh).toBeLessThan(rate);
  expect(closed.npv).toBeCloseTo(0, 3);
  expect(closed.breakEven).toBe(DEFAULT_PARAMS.years);
  // the cost of heat does not follow the price: the aid is sized on the price, so it is counted without (Modul 1 only)
  expect(closed.lcoh).toBeCloseTo(pays.lcoh, 6);
  expect(little.lcoh).toBeCloseTo(pays.lcoh, 6);
  expect(closed.lcoh).toBeGreaterThan(80);
  const short = at(0); // a gap larger than all the aid: 40 % of the eligible, still short
  expect(short.grant).toBeCloseTo(m1 + full(short), 3);
  expect(short.npv).toBeLessThan(0);
});

test("the station is the plan's: half the peak hour, a peak boiler for the rest; the data center's share meets BEW's 75 %", () => {
  const { site, net } = street();
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  expect(e.hpKw).toBeCloseTo(net.hpKw, 6);
  expect(e.hpKw).toBeCloseTo(0.5 * net.yearPeakKw, 6); // within what the data center allows
  expect(e.hpKw).toBeLessThan(e.capacityKw);
  expect(e.boilerKw).toBeGreaterThan(0);
  expect(e.dcShare + e.boilerShare).toBeCloseTo(1, 6);
  expect(e.dcShare).toBeGreaterThan(0.8); // ~86 % from half the peak hour
  expect(Math.abs(e.dcShare - net.dcShare)).toBeLessThan(0.01); // the plan's estimate of the losses is close
  expect(e.bewWhy).toBeNull();
  // the old rule: the heat pump for the whole design peak, the boiler only for the hours above it
  const p = { ...DEFAULT_PARAMS, fullPeak: true };
  const full = street(p);
  const f = networkEconomics(full.site, full.net, p);
  expect(f.hpKw).toBeCloseTo(full.net.hpKw, 6);
  expect(f.hpKw).toBeGreaterThan(full.net.yearPeakKw); // the peak hour with the losses, not the lower design peak
  expect(f.boilerShare).toBeLessThan(0.001);
  expect(f.dcShare).toBeGreaterThan(e.dcShare);
});

describe("the plan hour by hour (the time view)", () => {
  const { site, net } = street();
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  const hours = networkHours(site, net, e, DEFAULT_PARAMS);

  test("each hour balances: the buildings' demand and the losses come from the heat pump and the boiler", () => {
    for (const h of [0, 400, 4000, 5000, 8759]) {
      const x = hourAt(hours, h);
      expect(x.time).toBe(YEAR_TIMES[h]);
      expect(x.buildingKw.reduce((a, b) => a + b, 0)).toBeCloseTo(x.demandKw, 6);
      expect(x.hpKw + x.boilerKw).toBeCloseTo(x.demandKw + x.lossKw, 6);
      expect(x.hpKw).toBeLessThanOrEqual(e.hpKw + 1e-6);
      expect(x.takenKw + x.spareKw).toBeCloseTo(hours.year.usableKw, 6);
      expect(x.takenKw).toBeCloseTo(x.hpKw - x.hpElecKw, 6); // the heat pump's heat: the data center's and its electricity
    }
    expect(hourAt(hours, 8760).h).toBe(0); // wraps
  });

  test("each pipe carries its buildings' heat, the transmission line the data center's taken; the water at a pipe's speed", () => {
    const winter = hourAt(hours, hours.winter.first + 8);
    net.pipes.forEach((p, i) => {
      const flow = winter.pipes[i];
      if (p.kind === "transmission") expect(flow.kw).toBeCloseTo(winter.takenKw, 6);
      else
        expect(flow.kw).toBeCloseTo(
          p.served.reduce((a, b) => a + winter.buildingKw[b], 0),
          6,
        );
      expect(flow.velocity).toBeGreaterThan(0);
      expect(flow.velocity).toBeLessThan(4); // m/s: district heating runs ~0.5-2.5
    });
    const trunk = net.pipes.findIndex((p) => p.kind === "distribution" && p.buildings === net.chosen.length);
    expect(winter.pipes[trunk].kw).toBeCloseTo(winter.demandKw, 6);
    // each run is sized for its largest hour: no hour of the year sends more through it; and for its design peak on a
    // design day (1b-7: on this street of 20 houses that decides; it fell short of the summed hours on the typical peaks)
    const most = e.pipes.map(() => 0);
    for (let h = 0; h < 8760; h++) hourAt(hours, h).pipes.forEach((x, i) => (most[i] = Math.max(most[i], x.kw)));
    e.pipes.forEach((x, i) => expect(most[i]).toBeLessThanOrEqual(x.kw + 1e-6));
    expect(e.pipes[trunk].kw).toBeCloseTo(Math.max(net.pipes[trunk].peakKw, most[trunk]), 6);
    // summer: little flows, slowly
    const summer = hourAt(hours, hours.summer.first + 14);
    expect(summer.pipes[trunk].velocity).toBeLessThan(winter.pipes[trunk].velocity / 3);
  });

  test("the months add up to the year; the winter day is the coldest, in January, the summer day the warmest, in July", () => {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(hours.months.demand)).toBeCloseTo(e.year.soldMwh, 3);
    expect(sum(hours.months.hp)).toBeCloseTo(e.year.hpMwh, 3);
    expect(sum(hours.months.boiler)).toBeCloseTo(e.year.boilerMwh, 3);
    expect(sum(hours.months.taken)).toBeCloseTo(e.year.sourceMwh, 3);
    expect(hours.months.boiler[0]).toBeGreaterThan(hours.months.boiler[6]); // the boiler runs in winter
    expect(hours.months.spare[6]).toBeGreaterThan(hours.months.spare[0]); // the data center's heat is spare in summer
    expect(new Date(YEAR_TIMES[hours.winter.first] * 1000).getUTCMonth()).toBe(0);
    expect(new Date(YEAR_TIMES[hours.summer.first] * 1000).getUTCMonth()).toBe(6);
    expect(Math.min(...hours.winter.outdoorC)).toBeLessThan(Math.min(...hours.summer.outdoorC));
    expect(hours.winter.demandKw.map((d, i) => d + hours.winter.lossKw - hours.winter.hpKw[i] - hours.winter.boilerKw[i])).toEqual(
      Array(24).fill(expect.closeTo(0, 6)),
    );
    expect(Math.max(...hours.summer.boilerKw)).toBe(0);
  });

  test("cheap per hour: a year of frames in well under 5 ms each", () => {
    const t0 = performance.now();
    for (let h = 0; h < 8760; h += 10) hourAt(hours, h);
    expect((performance.now() - t0) / 876).toBeLessThan(5);
  });
});

// K8: 74.64 % read "75 % of the heat from the data center (BEW: at least 75 %)"; and it is the heat pump's heat, electricity included
test("BEW's refusal names the heat pump's share with a decimal: just under 75 % does not read 75 %", () => {
  const { site, net } = street();
  let [lo, hi] = [0, net.hpKw]; // the heat pump for which the share is just under 75 %
  for (let i = 0; i < 40; i++) [lo, hi] = networkEconomics(site, { ...net, hpKw: (lo + hi) / 2 }, DEFAULT_PARAMS).dcShare < 0.7464 ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  const e = networkEconomics(site, { ...net, hpKw: hi }, DEFAULT_PARAMS);
  expect(e.dcShare).toBeGreaterThan(0.745);
  expect(e.dcShare).toBeLessThan(0.75);
  expect(e.bewWhy).toBe("74,6 % of the heat from the heat pump (BEW: at least 75 %)");
});

// K3: a source hot enough to feed in directly ran past the station's size (203.75 kW through a 154.3 kW station, boiler 0)
test("a source hot enough for the exchanger alone gives no more than the station's size: the boiler covers the rest", () => {
  const flat = { houses: 1, kwhPerHouse: 876_000, supplyTemp: 70, returnTemp: 40, profile: "constant" }; // 100 kW every hour
  const sinks: HeatPoint[] = ["a", "b"].map((id) => ({ id, name: id, lat: 0, lon: 0, temp_c: 70, power_kw: 100, demand: flat }));
  const site: Site = { building: null, source: { id: "dc", name: "DC", lat: 0, lon: 0, temp_c: 80, power_kw: 1000 }, sinks };
  const y = heatYear(site, ["a", "b"], 154.3, 3.75, 0);
  expect(Math.max(...y.hours.hpKw)).toBeCloseTo(154.3, 6); // was 203.75
  expect(y.boilerKw).toBeCloseTo(203.75 - 154.3, 6); // was 0
  expect(y.boilerMwh).toBeCloseTo((49.45 * 8760) / 1000, 3); // 433 MWh a year
  expect(y.hpElecMwh).toBe(0);
  expect(y.hours.usableKw).toBeCloseTo(154.3, 6); // what the station can take of the 1,000 kW
  expect(y.hours.cop).toBe(0);
  expect(copLabel(0)).toBe("direct, no heat pump");
  expect(copLabel(3.364)).toBe("seasonal COP 3,4");
});

// K5: a life of 12.5 years never came due (no year is a multiple of it) yet the residual counted a heat pump renewed at 12.5
test("lives and the horizon count in whole years: a life of 12.5 years is renewed (year 13), not only credited", () => {
  const { site, net } = street();
  const half = networkEconomics(site, net, { ...DEFAULT_PARAMS, hpLife: 12.5 });
  const whole = networkEconomics(site, net, { ...DEFAULT_PARAMS, hpLife: 13 });
  expect(half.flows[13].reinvest).toBeGreaterThan(0); // was 0 in every year
  expect(half.npv).toBeCloseTo(whole.npv, 6);
  expect(wholeYears({ ...DEFAULT_PARAMS, years: 20.5, pipeLife: 44.4, substationLife: 0.2 })).toMatchObject({ years: 21, pipeLife: 44, substationLife: 1 });
  expect(networkEconomics(site, net, { ...DEFAULT_PARAMS, years: 20.5 }).flows).toHaveLength(22); // 21 years, as the page then says
});

// K9: investment ÷ year 1's net, which holds the ten-year BEW operating aid: on this street 10.4 years at 80 €/MWh
// (in fact 12.9), on Case 1 13.2 years at 130 €/MWh and 10.5 at 80
test("the simple payback is the year the undiscounted flows have paid the investment back, not the investment ÷ year 1's net", () => {
  const { site, net } = street();
  for (const heatPrice of [80, 110, 130]) {
    const e = networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice });
    // without what is left of the plant at the end
    const paid = (n: number) => e.flows.slice(1, n + 1).reduce((a, f) => a + f.net - f.residual, 0);
    const y = Math.ceil(e.payback!);
    expect(paid(y)).toBeGreaterThanOrEqual(e.invest - 1e-6);
    expect(paid(y - 1)).toBeLessThan(e.invest);
  }
  const aided = networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice: 80 });
  expect(aided.flows[1].subsidy).toBeGreaterThan(0); // the operating aid, ten years only
  expect(aided.payback!).toBeGreaterThan(aided.invest / aided.flows[1].net + 0.5); // year 1 alone said less
  expect(networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice: 60 }).payback).toBeNull(); // never within the horizon (was 14.9 years)
});

// K11: the dialog showed the rate (41.9 €/MWh on Case 1 with electricity at 100 €/MWh) where 26.75 is paid in year 1
test("the operating aid paid: the rate, cut to 90 % of the heat pump's electricity cost where that is less", () => {
  const { site, net } = street();
  // heat given away: a gap larger than all the aid, so the operating aid is paid in full (not cut to the gap's rest)
  const e = networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice: 0, elecPrice: 60 }); // cheap electricity: the cap binds
  expect(e.m4EurPerMwh).toBeGreaterThan(0);
  expect(e.m4PaidEurPerMwh).toBeCloseTo(e.flows[1].subsidy / e.year.hpMwh, 9);
  expect(e.m4PaidEurPerMwh).toBeCloseTo((0.9 * e.year.hpElecMwh * 60) / e.year.hpMwh, 6);
  expect(e.m4PaidEurPerMwh).toBeLessThan(e.m4EurPerMwh);
  const free = networkEconomics(site, net, { ...DEFAULT_PARAMS, heatPrice: 0, elecPrice: 400 }); // dear electricity: the rate in full
  expect(free.m4PaidEurPerMwh).toBeCloseTo(free.m4EurPerMwh, 9);
});

// K12: a drawn district not split into buildings (no Wärmeatlas import) was "only 1 buildings (BEW: more than 16)"
test("BEW also takes more than 100 dwellings: a district drawn as one area of 200 houses is not refused for being one building", () => {
  const { site, net } = street();
  const area: Site = { ...site, sinks: [{ ...site.sinks[0], id: "area", area: true, demand: { houses: 200, kwhPerHouse: 20_000, supplyTemp: 70, returnTemp: 40 } }] };
  const one = { ...net, chosen: ["area"] };
  const e = networkEconomics(area, one, DEFAULT_PARAMS);
  expect(e.apartments).toBe(200);
  expect(e.bewWhy ?? "").not.toMatch(/buildings/);
  const small: Site = { ...area, sinks: [{ ...area.sinks[0], demand: { houses: 60, kwhPerHouse: 20_000, supplyTemp: 70, returnTemp: 40 } }] };
  expect(networkEconomics(small, one, DEFAULT_PARAMS).bewWhy).toBe("only 1 building and 60 dwellings (BEW: more than 16 buildings or 100 dwellings)");
});

// K13: a pipe too small for its load showed only in the map's tooltip, and was priced as one DN 300
test("pipes that carry more than the largest DN does are named for the costs dialog", () => {
  const { site, net } = street();
  expect(pipesOver(networkEconomics(site, net, DEFAULT_PARAMS).pipes)).toBeNull();
  // a transmission loop of 0.1 K: no DN carries the data center's heat
  const tight = networkEconomics(site, net, { ...DEFAULT_PARAMS, sourceDtK: 0.1 });
  expect(tight.pipes.find((x) => x.pipe.kind === "transmission")!.dn).toMatchObject({ dn: 300, over: true });
  expect(pipesOver(tight.pipes, () => 0.1)).toMatch(/^Pipes too small: \d+ m carry more than the largest size, DN 300, does \(up to [\d.]+ kW against [\d.]+ kW\)\./);
});

// A10: the network's year ran at one COP (the hottest sink's supply all year)
test("the network's year runs on the heating curve: the seasonal COP is above the design COP and is the one shown", () => {
  const { site, net } = street();
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  const design = stationCapacity(1500, 30, 70).cop;
  expect(e.year.scop).toBeGreaterThan(design * 1.05); // was equal
  expect(e.cop).toBeCloseTo(e.year.scop, 9); // "seasonal COP" on the card
  expect(e.capacityKw).toBeLessThan(stationCapacity(1500, 30, 70).kw); // the ceiling at the coldest hour's supply (under 70 °C)
  expect(copLabel(e.cop)).toMatch(/^seasonal COP \d,\d$/);
});

// A1, A7 (labels): the discount rate is said to be nominal, and the CO₂ figures name their factors, in German too
test("labels: the nominal discount rate and the CO₂ factors read in German", () => {
  const de = translator(DE);
  const note = PARAMS.find((d) => d.key === "discountPct")!.note!;
  expect(note).toMatch(/^a nominal rate: /);
  expect(de(note)).toMatch(/^ein nominaler Zinssatz: /);
  const co2 = PARAMS.find((d) => d.key === "co2Price")!.note!;
  expect(co2).toContain(`${CO2.gas} t CO₂ per MWh of gas`);
  expect(de(co2)).toContain("t CO₂ je MWh Gas");
  expect(de(`Against gas heating, minus the heat pump's grid electricity: ${co2Basis()}. A car ~1,9 t a year (~12,500 km at ~150 g/km), a grown tree ~20 kg a year: rough figures.`)).toContain(
    "der Wärmepumpe: Gas 0,201 kg CO₂ je kWh in einem Kessel mit 90 %",
  );
  // Heat Matching and the quick analysis say their grid factor is flat, Operation's by the hour (audit P3)
  expect(de(co2Basis())).toBe(
    "Gas 0,201 kg CO₂ je kWh in einem Kessel mit 90 %, Netzstrom 0,38 kg je kWh (deutscher Strommix, in jeder Stunde und jedem Jahr gleich; Betrieb rechnet den CO₂ des Netzes Stunde für Stunde, seine Tonnen weichen daher ab)",
  );
  const quickHm = `Heat Matching's year as it last ran (24.11.2026): its models, its period, its heat pump and storage, the same numbers as there (${co2Short()}; Operation counts the grid's CO₂ hour by hour, so its tonnes differ). The heat sinks on the map and their edits count under On the map.`;
  expect(quickHm).not.toContain("on Operation"); // it said "the same numbers as there and on Operation"
  expect(de(quickHm)).toContain("Betrieb rechnet den CO₂ des Netzes Stunde für Stunde");
});

// 1b-2: a station fed directly (no heat pump) was costed as a 950 €/kW heat pump, with its O&M
test("a station fed directly is costed as an exchanger station: KWW's substation curve, no grid connection, no heat-pump O&M", () => {
  const { site, net } = street();
  const hot: Site = { ...site, source: { ...site.source!, temp_c: 80 } }; // 80 °C against a 70 °C supply: direct all year
  const e = networkEconomics(hot, net, DEFAULT_PARAMS);
  expect(e.cop).toBe(0);
  const station = e.lines.find((l) => l.key === "hp")!;
  expect(station.label).toBe("Exchanger station");
  expect(station.eur).toBeCloseTo(DEFAULT_PARAMS.substationA * e.hpKw ** 0.37917, 6); // was e.hpKw × 950
  expect(station.asset).toBe("substations");
  expect(e.lines.find((l) => l.key === "grid")!.eur).toBe(0);
  const noOm = networkEconomics(hot, net, { ...DEFAULT_PARAMS, hpOmPct: 0, hpOmVar: 0 });
  expect(e.flows[1].om).toBeCloseTo(noOm.flows[1].om, 6);
  expect(translator(DE)("Exchanger station")).toBe("Wärmeübertragerstation");
  // a heat pump keeps its price per kW
  expect(networkEconomics(site, net, DEFAULT_PARAMS).lines.find((l) => l.key === "hp")).toMatchObject({ label: "Heat-pump station", asset: "hp" });
});

// 1b-3: a pipe that carries more than the largest DN was priced as one DN 300 (K13 only said so)
test("a load above the largest DN is n pipes of it side by side: cost and loss × n, the dialog says how many", () => {
  expect(pipeDn(1e6, 30)).toMatchObject({ dn: 300, over: true, n: Math.ceil(1e6 / 24_900) });
  expect(pipeDn(24_900, 30)).toMatchObject({ dn: 300, over: false, n: 1 });
  expect(pipeDn(200, 30).n).toBe(1);
  const { site, net } = street();
  const tight = networkEconomics(site, net, { ...DEFAULT_PARAMS, sourceDtK: 0.1 });
  const line = tight.pipes.find((x) => x.pipe.kind === "transmission")!;
  const n = Math.ceil(line.kw / ((24_900 * 0.1) / 30));
  expect(n).toBeGreaterThan(1);
  expect(line.dn.n).toBe(n);
  expect(line.eur).toBeCloseTo(line.eurPerM * line.pipe.m * n, 6); // was × 1
  const loose = networkEconomics(site, net, { ...DEFAULT_PARAMS, sourceDtK: 10 }).pipes.find((x) => x.pipe.kind === "transmission")!;
  expect(line.lossW / loose.lossW).toBeGreaterThan(n * 0.99); // the same metres, n pairs of DN 300 against one smaller pair
  const says = pipesOver(tight.pipes, () => 0.1)!;
  expect(says).toContain(`priced as ${n} pipes of that size side by side`);
  expect(translator(DE)(says)).toContain(`als ${n} parallele Leitungen dieser Größe`);
});

// 1b-5: the grid connection was sized at the design COP (hpKw / COP at 70 °C) while the year runs on the heating curve
test("the grid connection is sized for the heat pump's largest hour of electricity in the year", () => {
  const { site, net } = street();
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  const most = Math.max(...e.year.hours.hpElecKw);
  const grid = e.lines.find((l) => l.key === "grid")!;
  expect(grid.eur).toBeCloseTo(most * DEFAULT_PARAMS.gridEurPerKwEl, 6);
  expect(most).toBeLessThan(e.hpKw / stationCapacity(1500, 30, 70).cop); // the design COP's: more than the year ever draws
});

// 1b-7 (audit A2, A3): pipes, pumps and the peak boiler were sized on the typical year's largest hour (−3 °C), with
// the buildings' typical peaks × simultaneity under it: no design day, and the simultaneity never decided
test("pipes, network pumps and the peak boiler are sized on a design day at −12 °C: the buildings' design peaks × simultaneity", () => {
  const { site, net } = street();
  const house = demandEntries(site)[0].settings;
  const typical = Math.max(...sinkKw(house));
  expect(designKw(house) / typical).toBeGreaterThan(1.5); // its day at −12 °C, not the typical year's coldest (a mean of 1 °C)
  expect(buildingsOf(site)[0].peakKw).toBeCloseTo(designKw(house), 9); // was its typical year's peak
  const design = 20 * designKw(house) * simultaneity(20);
  expect(net.peakKw).toBeCloseTo(design, 6);
  expect(net.peakKw).toBeGreaterThan(net.yearPeakKw); // here the design day decides (20 houses: simultaneity 0.92)
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  expect(e.lines.find((l) => l.key === "pumps")!.eur).toBeCloseTo(design * DEFAULT_PARAMS.pumpsEurPerKw, 6);
  const trunk = e.pipes.find((x) => x.pipe.kind === "distribution" && x.pipe.buildings === 20)!;
  expect(trunk.kw).toBeCloseTo(design, 6);
  const lossKw = e.pipes.filter((x) => x.pipe.kind !== "transmission").reduce((a, x) => a + x.lossW, 0) / 1000;
  expect(e.boilerKw).toBe(Math.ceil((design + lossKw - e.hpKw) / 10) * 10); // the design hour less the heat pump
  expect(e.boilerKw).toBeGreaterThan(e.year.boilerKw + 10); // more than the typical year ever asks of it
  expect(e.year.soldMwh).toBeCloseTo(4000, 0); // the year itself stays on the typical weather
});

// 1b-8 (audit A4): the pumps' electricity was 2 % of the heat sold (430 MWh a year on Case 1), whatever the network
test("the network pumps' electricity from the hydraulics: each hour's flow × the longest path's head ÷ the pumps' efficiency", () => {
  const { site, net } = street();
  const e = networkEconomics(site, net, DEFAULT_PARAMS);
  // the longest way from the station to a building, supply and return, at the sizing's 150 Pa/m, plus the fixed head
  const path = Math.max(...net.chosen.map((_, b) => net.pipes.filter((x) => x.kind !== "transmission" && x.served.includes(b)).reduce((a, x) => a + x.m, 0)));
  const headPa = 2 * path * 150 + DEFAULT_PARAMS.pumpHeadBar * 1e5;
  const supply = yearSupply(70, 40);
  const y = e.year.hours;
  let mwh = 0;
  for (let h = 0; h < 8760; h++) mwh += ((y.demandKw[h] + y.lossKw) * headPa) / (4.12e6 * (supply[h] - 40) * (DEFAULT_PARAMS.pumpEffPct / 100)) / 1000;
  expect(e.pumpMwh).toBeCloseTo(mwh, 6);
  expect(e.pumpMwh / e.year.soldMwh).toBeLessThan(0.01); // was 2 %
  // it is paid as electricity: half the efficiency, twice the pumps' electricity
  const half = networkEconomics(site, net, { ...DEFAULT_PARAMS, pumpEffPct: DEFAULT_PARAMS.pumpEffPct / 2 });
  expect(half.pumpMwh).toBeCloseTo(2 * e.pumpMwh, 6);
  expect(half.flows[1].energy - e.flows[1].energy).toBeCloseTo(e.pumpMwh * DEFAULT_PARAMS.elecPrice, 6);
  for (const key of ["pumpHeadBar", "pumpEffPct"] as const) expect(PARAMS.find((d) => d.key === key)!.source.label).toBe("estimate");
  expect(translator(DE)("network pumps' electricity")).toBe("Strom der Netzpumpen");
});
