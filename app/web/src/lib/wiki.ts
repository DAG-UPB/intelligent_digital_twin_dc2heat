/**
 * The agent wiki (app_idz/wiki/, what the MCP server's wiki_search and wiki_read give an AI model) as pages to show:
 * each Markdown file's front matter (title, tags, summary) and its text. Pure; the files come from the caller.
 */
export interface WikiPage {
  page: string; // as wiki_read names it: "datacenter/overview"
  folder: string; // "datacenter"; "" for the top
  title: string;
  summary: string;
  tags: string[];
  body: string; // the Markdown after the front matter
}

/** The pages of `files` (path → text, any prefix before "wiki/"), the index and the README left out, by folder then title. */
export function wikiPages(files: Record<string, string>): WikiPage[] {
  return Object.entries(files)
    .map(([path, text]) => {
      const page = path.replace(/^.*?wiki\//, "").replace(/\.md$/, "");
      const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
      const meta: Record<string, string> = Object.fromEntries(
        (m?.[1] ?? "").split("\n").flatMap((l) => {
          const kv = /^(\w+):\s*(.*)$/.exec(l);
          return kv ? [[kv[1], kv[2].trim()]] : [];
        }),
      );
      const tags = (meta.tags ?? "")
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const folder = page.includes("/") ? page.slice(0, page.lastIndexOf("/")) : "";
      return { page, folder, title: meta.title || page, summary: meta.summary ?? "", tags, body: (m ? text.slice(m[0].length) : text).trim() };
    })
    .filter((p) => p.page !== "index" && p.page !== "README")
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.title.localeCompare(b.title));
}
