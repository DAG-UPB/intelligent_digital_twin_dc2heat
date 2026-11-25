/** The landing page describes every section and every section page (a new page needs a line). */
import { expect, test } from "vitest";
import { TABS } from "../../app/routes";
import { PAGE_TEXT, SECTION_TEXT } from "./home";

test("every section and section page has a line on the landing page", () => {
  expect(Object.keys(SECTION_TEXT).sort()).toEqual(TABS.map((t) => t.id).sort());
  expect(Object.keys(PAGE_TEXT).sort()).toEqual(TABS.flatMap((t) => t.subs.map((s) => `${t.id}/${s.id}`)).sort());
});
