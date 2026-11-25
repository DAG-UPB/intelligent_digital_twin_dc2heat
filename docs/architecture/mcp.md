# MCP server: the app as tools for an AI agent

An AI assistant such as Claude can use the app directly through the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), instead of through the web page or raw HTTP.
It sees the data centers, their causal graphs, equations, models, the heat distribution and the components as
tools, and it can look at the data center's P&ID drawing and put variables on it with you. You can then ask, for
example, "put all temperature sensors of this data center on the P&ID", "write a physics equation for the chiller
energy and check it", or "fit the 5 MW heat pump to my CSV".

## How it works

`app/backend/mcp_server.py` is a small program (standard library only) that speaks MCP over stdin/stdout. It
does not hold any data itself: every call goes to the running app on port 7600, so there is one process within
the 2 GB budget, and the page and the agent see the same files.

- **Every API route is a tool.** The tool list is generated from the app's own OpenAPI schema (read from the code,
  so the list is there even when the app is not running yet). A new endpoint is a new tool, with no change in the
  MCP server. Tool names are the route functions: `list_datasets`, `get_summary`, `get_graph`, `save_graph`,
  `discover_link_lags`, `get_equations`, `check_equation`, `save_equations`, `train`, `evaluate`, `simulate`,
  `get_site`, `buildings`, `list_components`, `simulate_component`, `fit_component`, …
- **Reads and writes are marked.** Tools that change files say `[writes]` and carry `readOnlyHint: false`; GETs
  and the compute-only POSTs (check, evaluate, simulate, discover lags, fit, P&ID extract/preview) are read-only.
  A read never stores: evaluate's `store` (which writes `models/evaluation.json` for the Modelling page) is left out of
  its tool and dropped from a call.
- **The initialize instructions are a guide.** They say where to look things up (the agent wiki, then this
  documentation), how to connect to the open page and work it (look, act, look again), and the pages in the order
  the work goes, each with what its page details hold and the controls and commands it has.
- **Tools for working with an LLM:**

| Tool | What it does |
|---|---|
| `pid_view` | The P&ID image with a labelled 0..1 grid, the variables already placed (red, with ISA tag) and the components read from the drawing (blue). `region=[x0, y0, x1, y1]` zooms in to read small text; `scope` (`dc`, `heat`, `district`) picks whose structure. Also returns which variables are placed, which are not, and the components, as JSON. |
| `pid_place` | Puts variables on the P&ID (site.json `pid_layout`, the same entries a Structure and Modelling page saves; `scope` `heat` or `district` for the heat distribution's or the district's, default the data center's): `x, y` as fractions of the drawing, or a `component` id from the drawing. All placements of a call are checked first; nothing is saved if one is wrong. |
| `read_docs` | Reads a page of this documentation, e.g. `concepts/models` for the equation language. |
| `wiki_search` | Searches the agent wiki (`wiki/` in the repository: domain knowledge and where it is in the app). Each page's `title`, `tags`, `summary` (front matter) and body are scored, the title counting most; returns the best pages with their path, summary and the matching lines with a line around each. |
| `wiki_read` | Reads one wiki page by its path (`.md` optional), or without one the index `wiki/index.md` with the list of pages. A path outside `wiki/` is refused. |
| `ui_snapshot` | The page the user has open (below). |

- **The open page only once the user lets it.** The page tools (`ui_state`, `ui_snapshot`, `ui_do`, and
  `pid_view` of a drawing the page renders) are refused until the user connects the agent: *Connect AI* in the
  top bar shows a six-digit code, the user tells it to the agent, and the agent calls `connect_app` with it
  (`POST /api/live/pair`). The code works once, for 10 minutes (`core/live.py` `PAIR_CODE_S`), and is dropped after 5 wrong tries (`PAIR_TRIES`), and only an open
  page can ask for one (`POST /api/live/pair-code`, with its `X-Client-Id` and the secret its event stream gave it in its first message, `{type: "hello", secret}`: an id alone no longer makes a process a page). The app answers with a token, which
  the MCP server keeps in its process and sends as `X-Agent-Token` with every later call; the model only reads
  *Connected*. One agent at a time: a new pairing replaces the last, *Disconnect* (the same button) or a restart
  of the app ends it. The other tools (data, graphs, models) work without it. This is a consent step for the
  page, not a lock against programs on this computer: anything that can reach the app could call the API.

## Working the open page

Everything the user can do on a page the agent can do too, through the page itself: the page carries out the
request with the same code as its buttons, and unsaved work stays in the browser until the user's Save. There is
no working copy on the server.

- **`ui_snapshot`** describes the page (`app/web/src/app/assistant.ts`, `lib/snapshot.ts`): images of its drawings
  and charts, every visible control with its name, kind, value and ref (a folded panel such as *More options* or
  *What if…* is a control of kind `disclosure`, `on` when open; a name the page has more than once gets `in`, its
  card), the visible text, `commands` (the page's own gestures) and `detail`, what the page knows as numbers.
  Each part on screen adds its own detail (`useSnapshotDetail` in `lib/live.ts`; the details are merged):

| Page | Detail key | What it holds |
|---|---|---|
| Visualization and Scenarios (each part) | `dashboard` | Mode, view, data file, period, the KPI tiles of the period with units (in Scenarios: measured, twin without and with the levers), the data overview |
| Structure and Modelling | `instruments`, `links`, `construct`, `views`, `draft`, `built_in_drawing`, … | The P&ID and causal graph as before; the built-in drawing (air-cooled, free cooling, hall HEX in the air or on the chilled-water return, liquid-cooled); whether causal discovery runs |
| Modelling (under a structure) | `modelling` | Each variable's approach, the train plan and its time estimate, the equations, the saved models, the best model per variable once evaluated |
| A profile generator | `profile: <title>` | Total, unit, period, each part's share, driver, weekday factors and average day, the months of the year |
| Site Map | `map_centre`, `sinks`, …, `quick_analysis` | The site; the Quick analysis window's source (*On the map* or *As in Heat Matching*) and its results per year and month |
| Heat Matching | `heat_matching` | The KPIs over the period (coverage, heat delivered, heat-pump electricity, SPF, unmet, surplus, CO₂), each part's chosen and running way with the reason a way cannot run, the units on, the inputs from other datasets, the what-if levers, the window and its mean flows |

- **`ui_do`** acts: `click` and `fill` on any control by its name, ref or `<in> › <name>`; `navigate`,
  `open_dataset`, `message`, `scroll` (some parts load only once scrolled near, e.g. Modelling); and the page
  commands registered with `useCommand`, for what no click can reach: the P&ID gestures, the map's, and
  `set_window` (Heat Matching's year picker band, by number or date), `set_part_way` (a part's Model or
  Calculation) and `set_profile_shape` (a profile generator's drawn day, weekdays and months). The backend checks
  each command's arguments first (`core/live.py` `COMMANDS`, `check_command`); the page does the rest and answers
  with what it did or why it cannot.

Long answers (a whole time series) are cut at `MCP_TEXT_MAX_CHARS` characters; the image is scaled to at most
`MCP_PID_VIEW_MAX_PX` pixels (both in `core/limits.py`).

<details>
<summary><b>Source code:</b> <code>backend/mcp_server.py</code> (render_pid)</summary>

```{literalinclude} ../../app/backend/mcp_server.py
:language: python
:pyobject: render_pid
```

</details>

## Use it

1. Start the app: `cd app && bash scripts/guard.sh ./start.sh`.
2. **Claude Code** in this repository picks up `.mcp.json` (server `digital-twin`) and asks once whether to use
   it. **Other clients** (Claude Desktop, …): add a stdio server with the command
   `<repo>/app/.venv/bin/python -m backend.mcp_server` and the working directory `<repo>/app`.
3. `IDT_URL` points the server at another port (default `http://127.0.0.1:7600`), e.g. the examples app or the
   container: `"env": {"IDT_URL": "http://localhost:7612"}` in the server's `.mcp.json` entry. The stdio server needs
   the checkout's `app/.venv` (`uv sync`): it builds its tool list from the code and reads `docs/` and `wiki/` there.
4. **Without a checkout** (the container, `docker compose up`, see the README): the app serves the same server at
   `/mcp` over HTTP ("Streamable HTTP", `backend/routers/mcp.py`; plain JSON answers, one session per `initialize`,
   each with its own token from `connect_app`). Claude Code: `claude mcp add --transport http digital-twin
   http://localhost:7612/mcp`, or `{"type": "http", "url": "http://localhost:7612/mcp"}` in `.mcp.json`. Its tool calls
   go to `127.0.0.1` on the port the request came in on: publish the container's port under the same number.
5. To let it work your open pages: press **Connect AI** in the app's top bar and give it the code ("connect to
   the app with code 123 456").

The app has no access control of its own beyond answering only to the hosts in `IDT_ALLOWED_HOSTS` (default the
local machine) and taking writes only from a page on one of them: pairing is consent for the page, not a lock. Keep
the port on 127.0.0.1 (`compose.yaml` publishes it there); anyone who reaches it can call every tool.

After `pid_place` or a `[writes]` tool, reload the page to see the change.

A new page feature is covered by `click` / `fill` without any change here as long as it is a button, field, select,
slider or folded panel. Two things need a line of code: what the page shows as numbers goes into its detail
(`useSnapshotDetail`), and a control drawn on a canvas or SVG (a drag) gets a command (`useCommand` in the page,
the action and its required arguments in `COMMANDS`, a line in `ui_do`'s docstring in `routers/live.py`;
`test_ui_do_describes_the_page_commands_the_backend_accepts` checks the last one).

## Privacy

What a tool returns goes to the LLM you use, which for a hosted model means its provider. That includes the
P&ID image (`pid_view`, `pid_image`), time series (`get_data`) and project exports (`export_project`) of real
data centers. Use these tools on real data only when that is fine for that data. Nothing else leaves the machine:
the MCP server only talks to the local app.

For agents that work on the code: the hard rules of `AGENTS.md` still hold. Do not call `[writes]` tools on real
data unless the user asked for that change.
