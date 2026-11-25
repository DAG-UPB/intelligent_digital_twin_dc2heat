/** Hash routing: live routes, the OLD bookmark aliases, bare tab ids and fallbacks. */
import { describe, expect, test } from "vitest";
import { HELP, HOME, OLD, resolveRoute, TABS } from "./routes";

const at = (hash: string) => {
  const { tab, sub } = resolveRoute(hash);
  return `${tab.id}/${sub.id}`;
};

describe("resolveRoute", () => {
  test.each([...TABS, HOME, HELP].flatMap((t) => t.subs.map((s) => `${t.id}/${s.id}`)))("live route #/%s", (r) => {
    expect(at(`#/${r}`)).toBe(r);
  });

  test.each(Object.entries(OLD))("old bookmark #/%s -> %s", (from, to) => {
    expect(at(`#/${from}`)).toBe(to);
  });

  test.each([
    ["#/district", "district/dashboard"],
    ["#/district/map", "twin/map"], // the site map moved to the whole twin
    ["#/district/demand", "district/structure"], // Heat demand's profiles are the district's Modelling now
    ["#/twin", "twin/map"],
    ["#/heat", "heat/dashboard"],
    ["#/dc", "dc/dashboard"], // a live tab id wins over the old "dc/step" alias
    ["#/help", "help/about"],
    ["#/home", "home/start"],
  ])("bare tab %s -> its first sub %s", (hash, want) => {
    expect(at(hash)).toBe(want);
  });

  test.each([
    ["#/site", "twin/map"],
    ["#/quarters", "twin/map"],
    ["#/graph", "dc/pid"],
    ["#/train", "dc/pid"],
    ["#/dc/train", "dc/pid"], // AI modelling is the Modelling under the structure now
    ["#/heat/components", "heat/structure"],
    ["#/scenarios", "dc/dashboard"], // the Dashboard in Scenarios mode now
    ["#/dc/scenarios", "dc/dashboard"],
    ["#/blocks", "twin/matching"],
    ["#/matching", "twin/matching"],
    ["#/heat/flow", "twin/matching"], // the heat matching moved to the whole twin
  ])("old tab without its sub %s -> %s", (hash, want) => {
    expect(at(hash)).toBe(want);
  });

  test.each([
    ["", "home/start"], // the landing page is the default
    ["#", "home/start"],
    ["#/", "home/start"],
    ["#/nope/x", "home/start"],
    ["#/district/nope", "district/dashboard"],
    ["#/dc/nope", "dc/dashboard"],
  ])("unknown %j -> %s", (hash, want) => {
    expect(at(hash)).toBe(want);
  });

  test("section tabs in heat-flow order; home and help are not among them", () => {
    expect(TABS.map((t) => t.id)).toEqual(["dc", "heat", "district", "twin"]); // the parts left to right as the heat flows, then the whole twin
    expect(TABS.filter((t) => t.whole).map((t) => t.id)).toEqual(["twin"]);
  });
});
