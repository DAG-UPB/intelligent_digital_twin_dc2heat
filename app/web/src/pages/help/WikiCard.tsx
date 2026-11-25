/**
 * Help > AI assistant, in the Reference card: what the model knows about data centers, cooling, heat recovery and the
 * app: the agent wiki (app_idz/wiki/), which the MCP server's wiki_search and wiki_read give it. Its pages by folder,
 * the summary on hover, a click opens the page as the model reads it. Built into the page (Vite reads the files at
 * build time): a changed page shows after the next build.
 */
import { useState } from "react";
import { wikiPages, type WikiPage } from "../../lib/wiki";
import { Dialog } from "../../ui/Dialog";

const FILES = import.meta.glob<string>("../../../../../wiki/**/*.md", { query: "?raw", import: "default", eager: true });
const PAGES = wikiPages(FILES);

export default function WikiCard() {
  const [open, setOpen] = useState<WikiPage | null>(null);
  const folders = [...new Set(PAGES.map((p) => p.folder))];
  return (
    <div className="assistant__wiki">
      <h2 className="help__h2">{`What the model knows (${PAGES.length} pages)`}</h2>
      <p>
        {
          "Besides the data, the model looks things up in the agent wiki (wiki_search, wiki_read): how a data center, its cooling and the heat chain work, and where each thing is in this app. Click a page to read it as the model does."
        }
      </p>
      {folders.map((f) => (
        <div key={f}>
          <h3 className="caps" translate="no">
            {f || "general"}
          </h3>
          <ul>
            {PAGES.filter((p) => p.folder === f).map((p) => (
              <li key={p.page}>
                {/* the wiki's own title, as the model reads it: English, like the page itself */}
                <button type="button" className="assistant__wiki-page" title={p.summary} onClick={() => setOpen(p)} translate="no">
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && (
        <Dialog label={open.title} onClose={() => setOpen(null)} className="assistant__wiki-dialog">
          <h2 translate="no">{open.title}</h2>
          <p className="muted">
            <code>wiki_read {open.page}</code> · {open.summary}
          </p>
          <pre translate="no">{open.body}</pre> {/* as the model reads it: Markdown, English */}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
