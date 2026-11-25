/**
 * Help > "AI assistant": how to let an AI model work in the app with the user, live, over the app's MCP server
 * (backend/mcp_server.py): how to connect it, what it can do (the tools, read from the app's own OpenAPI schema),
 * and what leaves the computer. The model needs no access to the code: only the MCP server.
 */
import { AssistantFigure } from "./AssistantFigure";
import { useEffect, useState } from "react";
import { fetchConnectInfo, fetchOpenApi, type ConnectInfo, type OpenApiSpec } from "../../api";
import { LANG } from "../../lib/i18n";
import "./help.css";
import WikiCard from "./WikiCard";

interface Tool {
  name: string;
  summary: string;
  writes: boolean;
}

// The MCP server's own tools, next to one tool per API route
const EXTRA: Tool[] = [
  { name: "guide", summary: "Start here: what this app is and how to work with it; also checks the server works", writes: false },
  { name: "pid_view", summary: "Look at the P&ID: the drawing with a coordinate grid and the variables placed on it", writes: false },
  { name: "pid_place", summary: "Place variables on the P&ID", writes: true },
  { name: "read_docs", summary: "Read the technical documentation", writes: false },
];
const COMPUTE_ONLY = /\/(models\/evaluate|simulate|equations\/check|graph\/discover-lags|check|fit|extract|preview|pick)$/;

/** One tool per API operation, named as the MCP server names it (the route function). */
export function toolsOf(spec: OpenApiSpec): Tool[] {
  return Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]) => ({
      name: op.operationId.replace(new RegExp(`${path.replace(/\W/g, "_")}_${method}$`), ""),
      summary: op.summary ?? "",
      writes: method !== "get" && !COMPUTE_ONLY.test(path),
    })),
  );
}

const EXAMPLES = [
  "“Open the Physical structure and select the supply temperature.”",
  "“Look at the P&ID and place the temperature sensors on the pipes where they are drawn.”",
  "“On the Site map, add a heat sink at Hanauer Landstraße 100 that needs 300 kW in winter.”",
  "“Show me the MiniDC example on the map.”",
  "“Which variables drive the condenser heat? Draw that into the causal graph and save it.”",
];

/** The one instruction that sets an agent up: the app's own MCP address (backend/routers/mcp.py), in the page's
 * language, the words the agent reads as they are. */
export const instructionFor = (url: string, lang = LANG) =>
  lang === "de"
    ? `Füge den MCP-Server „digital-twin“ mit der Adresse ${url}/mcp (Transport: HTTP, auch „Streamable HTTP“; kein Befehl auszuführen, nichts zu installieren) zu deinen MCP-Einstellungen hinzu. Rufe danach sein Werkzeug guide auf, um zu prüfen, dass er funktioniert.`
    : `Add the MCP server "digital-twin" with the address ${url}/mcp (transport: HTTP, also called "Streamable HTTP"; no command to run, nothing to install) to your MCP settings. Then call its tool guide to check that it works.`;

function Copyable({ text, wrap }: { text: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`assistant__code${wrap ? " assistant__code--wrap" : ""}`}>
      <pre translate="no">{text}</pre>
      <button
        type="button"
        className="btn btn--pill btn--ghost"
        onClick={() =>
          navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => undefined)
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function AssistantPage() {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  useEffect(() => {
    fetchConnectInfo()
      .then(setInfo)
      .catch(() => undefined);
    fetchOpenApi()
      .then((spec) => setTools([...toolsOf(spec), ...EXTRA]))
      .catch(() => undefined);
  }, []);

  const desktop = info
    ? JSON.stringify(
        { mcpServers: { "digital-twin": { command: info.command, args: info.args, env: { PYTHONPATH: info.cwd, IDT_URL: info.url } } } },
        null,
        2,
      )
    : "";

  return (
    <div className="page help">
      <header className="help__hero">
        <h1 className="page__title help__title">AI assistant</h1>
        <p className="help__lead">
          Work on the twin together with an AI model. It uses the app through its MCP server, without access to the code: it reads the data, graphs and models, saves changes (P&ID
          positions, causal graphs, equations, models, the site and its heat sinks), and steers this page. You see every change here as it happens.
        </p>
      </header>

      {/* the idea in one picture, for a slide too */}
      <section className="card card--lg" aria-label="How it works">
        <AssistantFigure />
      </section>

      <div className="help__grid help__grid--2">
        <section className="card card--lg">
          <h2 className="help__h2">Connect a model</h2>
          <p>
            Keep this app open in the browser
            {info ? ` (${info.pages} page${info.pages === 1 ? "" : "s"} listening now)` : ""}. Then start the model with the MCP server <i>digital-twin</i>:
          </p>
          <p>
            <b>The quickest way</b>: give your agent this instruction (Claude Code, Claude Desktop or another MCP client on this computer). The app answers at its own address:
            nothing to install.
          </p>
          {info && <Copyable text={instructionFor(info.url)} wrap />}
          <p>
            <b>Or by hand, Claude Desktop or another MCP client</b>: add this to its MCP settings (in Claude Desktop: Settings › Developer › Edit config), then restart it. It gives the model the
            app, not the code.
          </p>
          {desktop && <Copyable text={desktop} />}
          <p>
            <b>Claude Code</b>: start <code>claude</code> in the <code>app_idz</code> folder; its <code>.mcp.json</code> starts the server. Claude Code can also read the code there.
          </p>
          <p>
            <b>Let it work your pages</b>: press <b>Connect AI</b> in the top bar and give the model the six-digit code (“connect to the app with code 123 456”).
            Until then it can read the data through the tools but cannot see or work your open pages. The code works once, for 10 minutes; Disconnect, under the
            same button, ends it.
          </p>
        </section>

        <section className="card card--lg">
          <h2 className="help__h2">Working together</h2>
          <p>Tell the model what you see and what you want. For example:</p>
          <ul>
            {EXAMPLES.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p>
            The model sees the tab you have in front (<code>ui_snapshot</code>): pictures of its drawings and charts, the P&ID with a 0 to 1 grid, every button and field with its name and
            value, and the page details such as each instrument's position and each link's lags. It works the page as you do (<code>ui_do</code>): it presses buttons and fills fields
            by their names, moves instruments, clicks on the map and draws demand curves. The page's own code runs, so it does exactly what your click would. Edits stay unsaved
            until Save, as yours do. What it saves through other tools appears here at once; while you have unsaved edits, those changes wait for you and a note offers to reload.
          </p>
        </section>

        <section className="card card--lg">
          <h2 className="help__h2">What leaves this computer</h2>
          <p>
            Everything a tool returns is sent to the model's provider: P&ID images, time series, statistics, the site. For a <b>real data center</b> that means its data leaves this
            computer. Use the simulations and the testbed freely; use real data centers only when that is allowed.
          </p>
          <p>The model changes files of the data folder you have open. Save a project state first (Save project) to be able to go back.</p>
        </section>

        <section className="card card--lg">
          <h2 className="help__h2">Reference</h2>
          <p>Every route of the app's HTTP API is a tool. The full reference, with every field:</p>
          <p>
            <a className="btn btn--pill" href="/api/docs" target="_blank" rel="noreferrer">
              API reference <span aria-hidden>↗</span>
            </a>
          </p>
          <WikiCard />
        </section>
      </div>

      <section className="card card--lg">
        <h2 className="help__h2">The tools ({tools.length})</h2>
        <table className="assistant__tools">
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td>
                  <code>{t.name}</code>
                </td>
                <td translate="no">{t.summary}</td> {/* the tool's own description, as the model reads it: English */}
                <td className="muted">{t.writes ? "changes files or the screen" : "reads"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
