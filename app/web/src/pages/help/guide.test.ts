/** The walkthrough only links to pages that exist, and each step says what to do. */
import { expect, test } from "vitest";
import { resolveRoute, TABS } from "../../app/routes";
import { GUIDE } from "./guide";

test.each(GUIDE.flatMap((s) => s.go.map((g) => [s.title, g.route])))("%s: “Go there” #/%s is a live page", (_, route) => {
  const { tab, sub } = resolveRoute(`#/${route}`);
  expect(`${tab.id}/${sub.id}`).toBe(route);
});

test("every step has something to see and something to do", () => {
  for (const s of GUIDE) {
    expect(s.see.length, s.title).toBeGreaterThan(0);
    expect(s.todo.length, s.title).toBeGreaterThan(0);
  }
});

test("the walkthrough visits every section page (a new page needs a step)", () => {
  const visited = new Set(GUIDE.flatMap((s) => s.go.map((g) => g.route)));
  const pages = TABS.flatMap((t) => t.subs.map((s) => `${t.id}/${s.id}`));
  expect([...visited].sort()).toEqual(pages.sort());
});
