/** The Heat distribution card's view: why a heat sink is left out, the flow and heat steps, the hour's labels. */
import { expect, test } from "vitest";
import type { HeatNetwork, NetworkBuilding } from "./network";
import { localDate } from "../../lib/clock";
import { atHour, dayLabel, dayOf, flowStep, heatStep, hourLabel, hourOf, midMonth, monthOf, notSupplied } from "./networkView";
import { YEAR_TIMES } from "./quickAnalysis";

const b = (id: string, annualMwh = 10): NetworkBuilding => ({ id, lat: 0, lon: 0, peakKw: 5, annualMwh });
const net = (chosen: string[], unreached: HeatNetwork["unreached"] = []) => ({ chosen, unreached }) as HeatNetwork;

test("each heat sink not supplied gets its reason", () => {
  const sinks = ["a", "far", "cut", "thin", "zero", "off", "lone"];
  const buildings = [b("a"), b("far"), b("cut"), b("thin"), b("zero", 0), b("lone")]; // "off": left out of the district
  const plan = net(
    ["a"],
    [
      { id: "far", reason: "212 m from the nearest street" },
      { id: "lone", reason: "its street is not connected to the network's" },
    ],
  );
  const why = notSupplied(sinks, buildings, plan, net(["a", "thin"]), false);
  expect(Object.fromEntries(why)).toEqual({ far: "far", lone: "street", cut: "share", thin: "density", zero: "demand", off: "demand" });
  expect(notSupplied(sinks, buildings, plan, null, true).get("cut")).toBe("peak");
  expect(notSupplied(sinks, buildings, plan, null, true).get("thin")).toBe("peak"); // no density rule: no re-plan
});

test("the flow is still without water moving and faster with it; a building's heat in fifths of the largest peak", () => {
  expect(flowStep(0)).toBe(0);
  expect(flowStep(0.001)).toBe(0);
  expect(flowStep(0.01)).toBe(1); // slow, but moving
  expect(flowStep(0.05)).toBe(1);
  expect(flowStep(0.6)).toBe(4);
  expect(flowStep(2.3)).toBe(6);
  expect([0, 0.005, 0.1, 1, 2.5, 4.9, 5].map((kw) => heatStep(kw, 5))).toEqual([0, 0, 1, 3, 4, 5, 5]); // a square-root scale
  expect(heatStep(3, 0)).toBe(0);
  expect(heatStep(9, 5)).toBe(5); // above the scale's top: the deepest
});

// K14: the labels read the hour as UTC while the demand's profiles follow Frankfurt's clock: "18:00" was 19:00 there
test("an hour of the typical year as its date and time on Frankfurt's clock, as the demand's profiles", () => {
  const local = (h: number) => localDate(YEAR_TIMES[h]);
  const winter = atHour(14, 18);
  expect(hourLabel(winter)).toBe("15 Jan, 18:00");
  expect([local(winter).getUTCDate(), local(winter).getUTCHours()]).toEqual([15, 18]); // 17:00 UTC (was 19:00 local)
  const summer = atHour(196, 12);
  expect(hourLabel(summer)).toBe("16 Jul, 12:00");
  expect(local(summer).getUTCHours()).toBe(12); // 10:00 UTC (was 14:00 local)
  expect([dayOf(summer), hourOf(summer)]).toEqual([196, 12]);
  expect(hourLabel(atHour(0, 0))).toBe("1 Jan, 00:00"); // the year's last UTC hour: it wraps
  expect(dayLabel(364)).toBe("31 Dec");
  expect(atHour(365, 0)).toBe(atHour(0, 0)); // wraps
  expect(monthOf(196)).toBe(6); // 16 Jul
  expect(dayLabel(midMonth(6))).toBe("15 Jul");
  for (let h = 0; h < 8760; h += 37) if (hourOf(h) !== 2 && hourOf(h) !== 3) expect(atHour(dayOf(h), hourOf(h))).toBe(h); // there and back (not in a clock change's hour)
});

// 1b-6: on the clock-change days atHour gave the hour beside: 30 Mar 02:00 (skipped) was 01:00, so the card's play
// stood still at 01:00; 26 Oct 02:00 was the second one, so the first was never shown
const dayPlay = (d: number) => {
  const seen = [atHour(d, 0)];
  for (let i = 0; i < 23; i++) seen.push(atHour(d, (hourOf(seen[seen.length - 1]) + 1) % 24)); // NetworkTime's and MapTime's play
  return seen;
};
const clock = (h: number) => localDate(YEAR_TIMES[h]).getUTCHours(); // the hour the profiles read (lib/profile.ts)

test("spring forward (30 Mar): 02:00 does not exist, so it is 03:00, label and profile alike; the day plays on", () => {
  expect(dayLabel(88)).toBe("30 Mar");
  const h = atHour(88, 2);
  expect(hourLabel(h)).toBe("30 Mar, 03:00"); // was 01:00
  expect(clock(h)).toBe(3);
  const play = dayPlay(88);
  expect(new Set(play).size).toBe(play.length - 1); // 23 hours that day: only the last step wraps to its midnight again
  expect(play.slice(0, 23).map(hourOf)).toEqual([0, 1, ...Array.from({ length: 21 }, (_, i) => i + 3)]);
  expect(play.slice(0, 23).map(clock)).toEqual(play.slice(0, 23).map(hourOf));
});

test("fall back (26 Oct): 02:00 is the first of the two, label and profile alike; every other hour there and back", () => {
  expect(dayLabel(298)).toBe("26 Oct");
  const h = atHour(298, 2);
  expect(hourLabel(h)).toBe("26 Oct, 02:00");
  expect(clock(h)).toBe(2);
  expect(h).toBe(atHour(298, 1) + 1); // the first 02:00 (summer time), was the second
  expect(dayPlay(298).map(hourOf)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  for (let x = 0; x < 8760; x++) if (x !== h + 1) expect(atHour(dayOf(x), hourOf(x))).toBe(x); // all but the repeated 02:00
});
