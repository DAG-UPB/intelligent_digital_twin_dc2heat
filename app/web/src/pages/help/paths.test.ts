/** The tutorial's paths and the tours point at live pages; every step of a path starts a tour, at a step it has. */
import { expect, test } from "vitest";
import { resolveRoute } from "../../app/routes";
import { PATHS } from "./paths";
import { APP_ROUTE, APP_TOUR, TOURS } from "./tours";

const live = (route: string) => {
  const { tab, sub } = resolveRoute(`#/${route}`);
  return `${tab.id}/${sub.id}`;
};

test("every step of a path links to a live page with a tour, starting at one of its steps", () => {
  for (const p of PATHS)
    for (const s of p.steps) {
      expect(live(s.route), s.text).toBe(s.route);
      expect(TOURS[s.route], s.route).toBeDefined();
      if (s.at)
        expect(
          TOURS[s.route].map((t) => t.title),
          s.text,
        ).toContain(s.at);
    }
});

test("every tour is of a live page, each step on a part of it, with a title and a text", () => {
  for (const [route, steps] of [...Object.entries(TOURS), [APP_ROUTE, APP_TOUR] as const]) {
    expect(live(route)).toBe(route);
    for (const s of steps) expect(s.target && s.title && s.text, `${route}: ${s.title}`).toBeTruthy();
  }
});
