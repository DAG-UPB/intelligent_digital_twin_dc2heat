---
title: How to add a wiki page
tags: [wiki, contributing, format, meta]
summary: The format every wiki page follows (front matter, three parts, length) and how to check links before you finish.
---

# How to add a wiki page

The wiki is for **AI agents**: dense, correct domain knowledge plus where it lives in this app. Human
documentation is `docs/`. Link to it, do not copy it. MCP tools `wiki_search` / `wiki_read` read these files.

1. **Place.** A Markdown file in the topic folder (`datacenter/`, `cooling/`, `temperatures/`, `interfaces/`, `recovery/`,
   `modelling/`, `profiles/`, `datasets/`, `app/`), lower-case-with-hyphens name. A new topic may get a new folder.
2. **Front matter**, first thing in the file:
   ```
   ---
   title: Short title
   tags: [cooling, temperatures, ...]
   summary: one line, what an agent finds here
   ---
   ```
3. **Body**, roughly 60–200 lines, tables and numbers over prose. Say "typical" for a typical range. Never copy text from a standard; summarise with numbers.
   End with three sections:
   - `## In this app`: the `dataset.json` keys, variable names, modules and file paths (as in the AGENTS.md module map). Check each path exists.
   - `## See also`: relative links to related wiki pages.
   - `## Sources`: standards and literature behind the numbers.
4. **Index.** Add one line to `index.md` under its topic.
5. **Rules.** Never open real data (only `app/data/sim_*`); never name or describe real sites or data centers.
6. **Check.** Every relative link must resolve, every page must have the three front-matter keys, and every backticked
   repo path must exist. A small script that walks `wiki/**/*.md` does it (regex for `](...)` links and backticked paths).
