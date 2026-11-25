import { expect, test } from "vitest";
import { wikiPages } from "./wiki";

test("wikiPages: each page's front matter and text, by folder, without the index and the README", () => {
  const pages = wikiPages({
    "/x/wiki/index.md": "# Index",
    "/x/wiki/README.md": "# How to add a page",
    "/x/wiki/glossary.md": "---\ntitle: Glossary\ntags: [terms]\nsummary: The words.\n---\n\n# Glossary\nPUE: …",
    "/x/wiki/cooling/air-cooling.md": "---\ntitle: Air cooling\ntags: [cooling, crah, hot-aisle]\nsummary: CRAH units and aisles.\n---\n# Air cooling",
    "/x/wiki/cooling/no-front.md": "Just text",
  });
  expect(pages.map((p) => p.page)).toEqual(["glossary", "cooling/air-cooling", "cooling/no-front"]);
  expect(pages[1]).toEqual({
    page: "cooling/air-cooling",
    folder: "cooling",
    title: "Air cooling",
    summary: "CRAH units and aisles.",
    tags: ["cooling", "crah", "hot-aisle"],
    body: "# Air cooling",
  });
  expect(pages[0].body).toBe("# Glossary\nPUE: …");
  expect(pages[2]).toMatchObject({ title: "cooling/no-front", summary: "", tags: [], body: "Just text" });
});
