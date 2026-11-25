# Data-center variables: their places and their causal links

A guide for putting a data center's variables on its P&ID and linking them into a causal graph, on the Physical
structure page or over MCP (`ui_do place_instruments`, then `ui_do set_links`). It covers:
- how a data center works;
- what kinds of variables its monitoring delivers, and what their names usually mean;
- where each variable belongs on the drawing;
- which variable causes which.

Names differ from site to site. This page gives the common patterns, not a fixed list.

## The data center's own documents

The user can keep documents about the data center's physical structure (Structure and Modelling › Documents): equipment
and sensor lists, schematics, descriptions of how the parts connect; any file, kept as it is. They say what this
guide can only guess: which sensor sits where, which pump feeds which rack, what the names mean.
- `list_documents` lists them: each one's `path` on this machine, a `note` of what it holds and the `view` of the
  P&ID it is about (empty: the whole data center). `ui_snapshot` on Structure and Modelling lists them too.
- The app does not open them: read the ones that matter from `path` with your own file tools (PDFs, pictures and
  text directly; convert others if you can), before placing variables, building a construct or choosing links,
  and tell the user which documents you used.
- To keep something there: `upload_document {name, file_path, note?, view?}` for a file on this machine, or
  `save_text_document {name, body: {text, note?, view?}}` for a text you wrote (`.md`, `.txt`, `.csv`, `.json`),
  e.g. a table of which variable is which sensor of a rack; `set_document_info` changes the note or the view. These
  write at once (an older one is backed up), so do it when the user asks or agrees.

## Names shown

A variable's own name is the column name of the data, often long or cryptic. `set_variable_names {dataset_id,
body: {names: {"UDPARDUINO//temp_customer_flow rack_01": "Rack 1 supply T"}}}` gives one or many a name shown in
place of their own (`""` gives the own name back). Only a label: the data, the graph files and the models keep the
own names, and every tool still takes the own name. `ui_snapshot` gives both (`name` of an instrument, `names`).
Names shown are written at once, so propose them first; a table of the new names in a document
(`save_text_document`) helps the user check them.

## How a data center works

Every watt the IT equipment draws becomes heat in the room or in the cooling liquid. The cooling plant moves that heat
out of the building, where it is rejected to the outside air or reused, for example in a district heating network.
Follow the energy through these stages:

| Stage | What happens | Typical equipment |
|---|---|---|
| Power | Electricity comes in, passes the UPS and the distribution, and feeds the racks | Transformer, main distribution, UPS, PDU, rack |
| IT | Servers compute. Their power use follows their load (CPU, GPU utilisation) | Server, rack, row |
| Heat capture, air | Fans blow cold air through the servers. Hot air goes back to the air units | CRAH or CRAC, air handling unit, cold and hot aisle |
| Heat capture, liquid | Water or a water-glycol mix flows through cold plates or rear-door coolers in the rack | Cold plate, rear-door HEX, CDU (coolant distribution unit) |
| Facility loop | A water loop carries the heat from the air units or CDUs to the plant | Pumps, valves, buffer tank, HEX |
| Heat rejection or reuse | A chiller or heat pump lifts the temperature if needed. A dry cooler or cooling tower rejects the heat, or a HEX passes it to a heating network | Chiller, heat pump, dry cooler, cooling tower, HEX to the district |

Every loop has a **supply** (flow, outgoing) line and a **return** line. In the facility loop, the supply runs from the
plant to the IT, cold, and the return comes back from the IT, warm. A loop's heat is Q = ṁ · cp · (T_return − T_supply).

The usual key figures:
- **PUE**: total facility power ÷ IT power, 1.0 at best.
- **COP**: heat moved ÷ electricity of the chiller or heat pump.
- **Reuse share**: heat reused ÷ heat produced.

## Kinds of variables

| Kind | What it is | How the series looks | Name hints |
|---|---|---|---|
| Measurement (process value) | A sensor reading: temperature, pressure, flow, humidity, power | Varies all the time, with noise | `T`, `Temp`, `p`, `Flow`, `Ist` (German: actual), `PV`, `_act`, `_meas` |
| Setpoint | The value a controller holds a measurement at. You can change it in Scenarios | Flat, changes in steps, round numbers | `Soll` (German: setpoint), `SP`, `Set`, `_set`, `Sollwert` |
| Actuator output | What a controller sends to a valve, pump or fan | 0–100 % or Hz, moves with the load | `Stell` or `Stellwert` (German: output), `Y`, `Pos`, `Speed`, `Drehzahl`, `Freq`, `%` |
| Status or alarm | On/off, running, fault | 0/1, or a few states | `Status`, `Run`, `Betrieb`, `Stoer` / `Störung`, `Alarm`, `Freigabe` |
| Meter (counter) | Energy or volume summed up | Only rises (resets aside). The rate of change is the power | `kWh`, `MWh`, `Zaehler` / `Zähler`, `Energie`, `Arbeit`, `WMZ` (heat meter), `m3` |
| IT load | What the IT does | 0–100 % utilisation, or kW | `CPU`, `GPU`, `Util`, `Load`, `Auslastung`, `IT_Power` |
| Weather | Outside conditions, which drive the free cooling | Daily and yearly cycles | `Aussen` / `Außen`, `AT`, `Outdoor`, `Out_`, `Wetter`, `Wind`, `Hum` |
| Time | Calendar features | Saw-tooth or steps | `Hour`, `Weekday`, `Month` |
| Calculated | Made from others (heat Q, COP, PUE) | Smooth, a product of other series | `Q`, `COP`, `PUE`, `EER` |

Setpoints and actuator outputs are the variables a twin can act on (Scenarios). Measurements are what it predicts.
A flat, stepwise series is almost always a setpoint, and a series that only rises is a meter. The Dashboard
statistics show this without reading the values one by one.

## Words and abbreviations in variable names

Building-management exports mix English and German. Read a name word by word: equipment, then the medium or place,
then the quantity, then supply or return, then the kind.

| In the name | Meaning |
|---|---|
| `VL`, `Vorlauf`, `Sup`, `Supply`, `Flow` (of a loop) | Supply line |
| `RL`, `Ruecklauf` / `Rücklauf`, `Ret`, `Return` | Return line |
| `In`, `Ein`, `Eintritt` · `Out`, `Aus`, `Austritt` | Inlet · outlet of a unit |
| `ZUL`, `Zuluft`, `SA` · `ABL`, `Abluft`, `RA` · `UML`, `Umluft` · `AUL`, `Aussenluft`, `OA` | Supply air · return air · recirculated air · outdoor air |
| `T`, `Temp`, `TT` | Temperature (°C, sometimes K) |
| `p`, `P` (with bar or Pa), `Druck`, `dp` | Pressure, differential pressure |
| `F`, `V`, `Vdot`, `Durchfluss`, `Volumenstrom`, `m`, `mdot`, `Massenstrom` | Volume or mass flow |
| `P` (with kW), `Leistung`, `Power`, `W`, `kW` | Power |
| `E`, `Energie`, `Arbeit`, `kWh` | Energy |
| `Q`, `Waerme` / `Wärme`, `Heat` · `Kaelte` / `Kälte`, `Cool` | Heat · cooling |
| `rH`, `Hum`, `Feuchte` | Relative humidity (%) |
| `KM`, `Kaeltemaschine` / `Kältemaschine`, `Chiller` | Chiller |
| `WP`, `Waermepumpe` / `Wärmepumpe`, `HP` | Heat pump |
| `RKW`, `Rueckkuehlwerk` / `Rückkühlwerk`, `DryCooler`, `CT` | Dry cooler, cooling tower |
| `WT`, `WUET` / `WÜT`, `HEX`, `PHE` | Heat exchanger |
| `RLT`, `AHU` · `CRAH`, `CRAC`, `ULK` (Umluftkühlgerät) | Air handling unit · computer-room air unit |
| `CDU`, `TCS` · `FWS` | Coolant distribution unit, the rack-side loop · the facility water loop |
| `P` or `Pu` + number, `Pumpe` · `V`, `Ventil`, `MV` · `Lüfter` / `Luefter`, `Fan`, `Vent` | Pump · valve (motorised) · fan |
| `USV`, `UPS` · `NSHV`, `HV`, `UV` · `PDU` | UPS · main or sub distribution · power distribution unit |
| `Rack`, `Row`, `Reihe`, `Gang`, `Hall`, `Raum` | Where in the white space |
| Numbers (`1`, `02`, `_A`, `_B`) | Which of several identical units, or which redundancy line |

The app's ISA tags (shown in the instrument bubble) follow the first letters: `TT` temperature, `PT` pressure, `FT`
flow, `MT` humidity, `EQ` energy or power, `JT` IT load or power, `ST` / `SC` speed, `ZT` position, `FV` valve, `TIC`
a temperature controller (a setpoint), `QT` heat or quantity, `KI` time, `XT` unclassified. Set the tag in the
inspector when the guess is wrong.

## Where a variable goes on the drawing

A variable goes where its sensor or actuator physically is, on the line or unit it belongs to:

| Variable | Place it |
|---|---|
| Supply or return temperature of a loop | On that loop's supply or return pipe, next to the unit it leaves or enters. A unit's inlet temperature sits on the pipe before the unit, its outlet on the pipe after it |
| Flow | On the pipe it is measured in (usually the return of a loop, or the line through a HEX) |
| Pressure, differential pressure | On the pipe, or across a pump or filter (dp) |
| Power or energy of a unit | On the unit it feeds: chiller, pump, fan, CDU, rack |
| Heat meter (`WMZ`) | On the pipe pair where the meter is, usually at a HEX or a transfer station |
| Setpoint | At the unit or loop it controls, next to its measurement (a supply-temperature setpoint beside the supply temperature) |
| Actuator output | At the valve, pump or fan it drives |
| Status or alarm | At the unit it belongs to |
| CPU, GPU, IT load, IT power | At the racks, rows or the IT room |
| Room or aisle temperature and humidity | In the room, in the cold or hot aisle |
| Outdoor temperature, humidity, wind | At the outside equipment (dry cooler, cooling tower) or in a free corner marked outside |
| Time features | A free corner. They belong to no equipment |
| Calculated (Q, COP, PUE) | Next to the unit they describe (Q at its HEX, COP at its heat pump) |

To place many variables at once over MCP, work **rough first, then refine**: put everything on the drawing in a
rough order in one go, look at it together with the user, and only then refine group by group. Getting each
variable exactly right on the first pass takes far longer and is often redone anyway.

1. **Read the drawing, briefly.** `ui_snapshot` with `parts: ["construct.drawing_texts", "construct.shapes"]` gives
   the sheet's texts (room names, equipment tags) and the recognised symbols, with their positions as fractions of
   the P&ID picture. These are your anchors. Recognition finds only some symbols (racks drawn as plain lines are
   no shapes), so the texts are the more reliable anchors. Without `parts` the snapshot holds every control, all
   visible text and every variable: on a page with hundreds of variables that fills your context. Ask only for
   what you need. Each answer lists the detail keys there are.
2. **Match labels.** Equipment tags on the drawing (`WT1`, `P-101`, `KM 2`, a bubble reading `TI 205`) often appear in
   the variable names. A bubble's ISA code and number are the best match.
3. **Classify each variable** with the tables above: kind, equipment, supply or return. Group them by unit. Mark
   every one with `ui_do annotate_variables {annotations: [{variable, kind, confidence, note?}, ...]}`. The kind
   (`sensor`, `setpoint`, `actuator`, `meter`, `it_load`, `weather`, `time`, `calculated`, `status`) is drawn as a
   coloured badge. The confidence (`sure`, `likely`, `unsure`) is drawn as a green, amber or red ring, so the user
   sees at a glance where you guessed. A short `note` says why.
4. **Rough pass.** Place all of them in one `ui_do place_instruments` call with `[{variable, x, y}, ...]`. Each
   group goes next to its anchor, its variables side by side about 0.03 apart, in a row or a small grid. One call
   leaves nothing half-done: every entry is checked first, and one wrong entry moves nothing. The drawing must not
   be locked: a locked drawing refuses with a message, so ask the user to unlock it.
5. **Look together.** `ui_snapshot` with `parts: ["images"]` shows the result. Tell the user what you placed where
   in a few lines, and ask what to change.
6. **Refine group by group** with smaller `place_instruments` calls. To check positions without the picture, use
   `parts: ["instruments"]`. It lists only the variables drawn on the picture, with x and y.
7. **Report.** Tell the user which variables you could not match: leave them unplaced (they wait in the Variables
   menu) rather than guess. Do not press Save unless the user asked for it: the work stays as an unsaved draft
   in the browser.

**Views inside the P&ID.** A part of the plant can have a drawing of its own (a cooling unit's own P&ID, one
room), drawn inside an area of the main P&ID: a *view* (`ui_snapshot` → `views`, areas as fractions of the P&ID;
`picture` says whether it has one). Views can be nested. To work in one:
- `pid_view {dataset_id, view}` shows the view's own picture with its own 0..1 grid and the variables already in it.
- Place its variables in those fractions: `ui_do place_instruments [{variable, x, y, view: "<id>"}]`. A view
  whose picture is a PDF, SVG or DEXPI file has a construct of its own (`view_construct`; `ui_snapshot` views
  `components`): put a variable on one by its tag instead, `{variable, view: "<id>", component: "TT1"}` (an
  instrument also gives its ISA letters as the tag). `move_instrument` takes the same.
- Before giving a view a picture, `extract {file_path, summary: true}` tells what its construct would hold (a dry
  run: counts, the labelled components and instruments, the texts). Identical parts (six racks) are read once:
  give one view the picture, then `copy_view {view_id, source}` for the others. To change a view's construct in
  bulk, read it (`view_construct`), change the shapes, and write it back with `save_view_construct`; for the sheet,
  `get_construct` / `save_construct`. These write at once (the older file is backed up), so ask first.
  `ui_snapshot` then gives them `view`, `view_x`, `view_y`.
- Everything is on one canvas, so `set_links` links a variable in a view with any other, in the view or outside.
- `ui_do open_view {view}` zooms the user's screen onto it, `close_view` shows the whole P&ID again.
- Each view has a level of detail, `show`: `auto` (the default: a box while it is small on screen, its picture once
  zoomed into; the sheet until it has a picture), `box` (a plain box with its name), `sheet` (the drawing underneath, a frame only) or `picture`.
  Set it with `add_view` / `edit_view`; `ui_do set_layers {views: "box"}` shows every view at one level
  (`"own"`: each its own again). `ui_snapshot` views give `show` and `shown_as`, what the user sees now.
- `ui_do add_view {name, x, y, w, h}` marks a new area (a box inside another view nests it), `edit_view {view,
  name?, x?, y?, w?, h?}` renames, moves or resizes one (its variables and the views inside it move with it; only
  `w` or only `h` keeps its shape) and `remove_view {view}` removes one. All three write `site.json` at once, so
  ask first. A view's picture is a file the user chooses (*Picture…*), or the route
  `POST /api/datasets/{id}/pid/views/{view_id}` with a drawing file the user named.

**Many similar variables.** Dozens of values of one kind (one CPU utilisation per core or server) cover the drawing
and add little to a causal twin. Two ways to help:
- **Smaller instruments.** `ui_do fill {control: "Instrument size", value: 0.4}` shrinks all of them to 40 %.
  Long names are already drawn as short labels.
- **Combine them.** Suggest to the user one combined variable per rack or row instead of every single value. It is
  easier to learn from, faster to train and clearer on the drawing. `ui_do group_variables {variables, name?,
  method?: "mean"}` marks them in one call:
  - It is only a mark: no values are computed and the data is not changed. It is unsaved until Save, like
    placements and links, and the Dashboard lists the groups and marks their members.
  - The group is a variable on the drawing, drawn as stacked circles in the middle of its members, which are
    hidden. `name` may be a variable already on the drawing without data (one made by `add_variable`); it then
    stands for the group.
  - `ui_do ungroup_variable {variable}` drops the mark and shows the members again.

  To show the user which variables you mean before grouping, `ui_do select_variables {variables}` marks them on
  the drawing. Computing a group's values is a later step (Dashboard › Prepare variables, combine).

Every change you make (placements, links, marks, groups, deletions) is logged in the page's Changes box, marked
"AI", and in `ui_snapshot` → `changes`. The user reads it to see what you did.

## Causal links: which variable causes which

A link *from → to* says that a change in *from* shows up in *to* after the link's lag (whole time steps; 1 is the
next step). The twin learns each variable only from its parents, so a missing link means the twin ignores that
effect, and a wrong link teaches it a coincidence. Follow the physics: energy and control signals go from cause to
effect.

**Drivers have no parents** other than their own past. Drivers are:
- weather (outdoor temperature, humidity, wind);
- time features;
- IT load or CPU/GPU utilisation, which the IT decides, not the cooling;
- setpoints, which people or a supervisory controller decide.

The other variables are effects. Typical links:

| From → to | Why |
|---|---|
| CPU / GPU utilisation, IT load → IT power | Servers draw power with their load |
| IT power → return air or return water temperature of the IT, heat Q of the IT loop | The power becomes heat |
| IT power, return temperature → power of the cooling units, chiller, pumps, fans | More heat to remove, more work |
| Setpoint → actuator output (valve, pump speed, fan speed) | The controller acts on the difference |
| Actuator output → flow, speed | The valve opens, the pump turns faster |
| Flow, inlet temperature → outlet temperature of a unit (HEX, cooler, rack) | The heat balance of the unit |
| Supply temperature (or its setpoint) → room, aisle or inlet temperatures downstream | Cold supply cools what it reaches |
| Outdoor temperature, humidity → dry cooler or cooling tower outlet, condenser temperature, chiller power, free-cooling share | The heat sink outside |
| Condenser or source temperature, heat load → heat pump or chiller power, COP | The lift and the load set the work |
| Heat reuse demand (district side) → reuse HEX flow, heat delivered | The sink takes what it needs |

Rules that keep the graph useful:
- **The measured value back to the actuator.** A control loop is a cycle: the setpoint and the measured value drive
  the actuator, and the actuator drives the measured value. Link both directions, each with a lag of at least 1.
- **Own past for slow things.** Temperatures of rooms, tanks and loops, and anything with inertia, depend on their own
  past. Add a self-link (*from = to*, lag 1).
- **Lags.** Start with 1. Thermal inertia (big rooms, tanks, long pipes) takes longer: several steps at a 1-minute
  step, usually 1 at an hourly step. Causal discovery (the button on the page, TempCaFe) then lets the data choose the lags of the
  drawn links. Its result is a suggestion, saved only when the user asks.
- **Few parents.** Give each effect its 2–5 real causes, not every variable that correlates with it. The P&ID tells
  which variables sit on the same pipe or unit: those are the first candidates.
- **No links into calculated or meter values.** Calculated values (Q, COP, PUE) are computed from their parts, and a
  meter's running total is no cause or effect (its rate would be).
- **Redundant twins.** Two identical units (pump A and B) each get their own links. Do not link them to each other
  unless one really affects the other.

**Example: a water-cooled rack.** A rack loop takes cold water from a supply line, passes it through the servers'
cold plates or a rear-door heat exchanger, and returns it warmer; a valve (or a pump) sets how much flows. Typical
variables: supply and return temperature of the rack water (TT), the pressures before and after (PT), the flow (FT),
the valve's position and its target (setpoint), the servers' power or CPU load, and the air or rack temperatures.

| From → to | Why |
|---|---|
| Valve target → valve position | The actuator follows its setpoint |
| Valve position, pressure before the rack → flow | The valve opening and the pressure difference set the flow |
| Supply temperature, flow, IT power → return temperature | The heat balance: the water takes up the servers' heat |
| IT power (CPU load) → rack or server temperatures | More load, more heat |
| Return temperature (or rack temperature) → valve target | A controller opens the valve when it gets warm (a loop: both directions, lag ≥ 1) |
| Return temperature → the shared return line, the cooler's inlet | The racks' water goes on together |

Identical racks get the same pattern of links, each with its own variables.

Over MCP, send all links in one call, then check them:

```json
{"action": "set_links", "args": {"links": [
  {"from": "IT_Load", "to": "ITE_Ener"},
  {"from": "ITE_Ener", "to": "HEX_Hall_T_in", "lags": [1, 2]},
  {"from": "In_Temp", "to": "In_Temp"},
  {"from": "Out_Hum", "to": "In_Hum", "lags": []}
]}}
```

The first adds a link at lag 1, the second sets two lags, the third is a self-link, and `lags: []` removes a link.
`ui_snapshot` lists the links with their lags (`links`) and each instrument's own-past lags (`self_lags`). After
placing and linking, tell the user what you linked and why in a few lines. Leave the Save to them.

## Privacy

Everything a tool returns (P&ID images, drawing texts, time series) goes to the model provider. A real data center's
drawing and data are confidential: read only what the placement needs.
