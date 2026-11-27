# District demand and the site map

The **District** section describes who takes the heat:

- **Site map** (`#/twin/map`, on the Intelligent Digital Twin; `#/district/map` forwards there): the data center's building and the **heat sinks** (buildings, or whole drawn areas) on an OpenStreetMap map.
- The **demand model** (`lib/demand.ts`) turns each heat sink into a heat demand in kW per step (the whole twin's Heat matching uses it; the Heat demand page that edited it was removed, and its sinks' saved settings are kept; in the district's Modelling the heat demand is a profile that can start from them). It covers the same period, at the same timestamps and with the same outdoor temperature as the data center's data, so that {doc}`heat-distribution` can match the two step by step.

There are no measured demand data here. The demand is **generated** from a few planning numbers (the number of houses, the annual demand per house, a heating limit, daily habits) and shaped by the outdoor temperature. Importing measured district-heating data, or a predictive demand model, is on the roadmap (`app/PLAN.md`).

| Code | Role |
|---|---|
| `app/web/src/lib/demand.ts` | The profile generator: daily curves, space heating, hot water, scaling, per-sink settings, totals |
| `app/web/src/lib/learnedModels.ts` · `aalborgModel.json` · `helsinkiPublicModel.json` | The learned standard profiles (AI): homes (Aalborg model, 3,021 measured homes) and offices and public buildings (Helsinki model, 258 measured service buildings) |
| `app/web/src/lib/demandStore.ts` | The evaluated period with its outdoor temperature (`evaluatedYear`), saving (`saveDemand`), the saved total (`districtYear`) |
| `app/web/src/pages/district/` | The Site map: `SitePage` with `useSiteMap`, `osm.ts`, `drawSite.ts`, `bubbles.ts`, `siteEdits.ts`, the sinks' profiles (`sinkProfile.ts`), the Wärmeatlas layer and the Quick analysis window (`QuickWindow`, `quickAnalysis.ts`) |
| `site.json` (dataset folder) | Where the Site map saves: the building, the source, the sinks with their demand settings, the whole-district settings ({doc}`../architecture/data-and-privacy`) |

---

## The demand of one heat sink

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `houses` | 200 | Number of dwellings the sink stands for (1 for a single building) |
| `kwhPerHouse` | 12 000 kWh/a | Annual heat demand of one house, space heating plus hot water |
| `heatingLimit` | 15 °C | No space heating when the 24 h mean outdoor temperature is above this |
| `dhwShare` | 0.2 | Share of the annual demand that is domestic hot water |
| `morningPeak`, `eveningPeak` | 0.6, 0.5 | Weights of the morning and evening peaks of the heating curve |
| `nightSetback` | 0.3 | Share by which heating is turned down at night (22–5 h) |
| `weekendFactor` | 1.05 | Heating demand on Saturday and Sunday relative to weekdays |
| `supplyTemp`, `returnTemp` | 70 °C, 40 °C | Network temperatures the sink needs |
| `heatingDay`, `hotWaterDay` | none | 48 half-hourly points drawn on the typical-day chart (24 hourly ones in older saves, still read); when present they replace the parametric curves. Only their shape is used here: their height is `kwhPerHouse` and `dhwShare` (see *Height*) |
| `included` | true | Whether the sink counts in the district total |

No page edits these settings by hand any more: the Heat demand page, with its form and house-type select, was removed. A sink added from the Wärmeatlas brings its own numbers (`houses` 1, `kwhPerHouse` its modelled heating + hot water, `dhwShare` its hot-water share; see below), any other sink starts from the defaults, and a sink saved earlier keeps the settings it was saved with. Its curve over the year is then shaped by the profile it is given on the Site map (*Profile of all* or its own select) or in the district's Modelling ({doc}`../user-guide`).

### Daily curves

Two curves give the *relative* demand over a day, before any scaling. Both use a Gaussian bump $g(h;\mu,\sigma) = \exp\!\left(-\tfrac12\left(\tfrac{h-\mu}{\sigma}\right)^2\right)$, where $h$ is the hour of the day of the timestamp (read as UTC, see Limits), with minutes and seconds as fractions.

**Space heating** (parametric):

$$
c_{SH}(h) = f_{we} \left( n(h) + a_m\, g(h;\ \mu_m,\ 1.3) + a_e\, g(h;\ 19,\ 1.8) \right),
\qquad
n(h) = \begin{cases} 1 - s_{night} & h \ge 22 \text{ or } h < 5 \\ 1 & \text{otherwise} \end{cases}
$$

with $a_m$, $a_e$ the morning and evening peak weights, $s_{night}$ the night setback, $\mu_m = 6.5$ h on weekdays and $8.5$ h on weekends, and $f_{we}$ the weekend factor on Saturday and Sunday (1 otherwise).

**Hot water** (parametric):

$$
c_{DHW}(h) = 0.25 + g(h;\ \mu_s,\ 1) + 0.8\, g(h;\ 20,\ 1.5)
$$

with the morning shower peak at $\mu_s = 7$ h on weekdays and $9$ h on weekends. The weekend factor does not apply to hot water.

**Drawn curves.** The removed Heat demand page drew them; a sink saved with drawn curves keeps them, and `lib/demand.ts` still reads and scales them as described here. Its *Typical day* card showed both curves in **kW** of the selected heat sink (see *Height* below), with 48 half-hourly points. A point can be dragged with the mouse, by touch, or moved with the arrow keys (Shift for bigger steps). Grabbing a **line** (or the arrow keys on it) moves the whole curve up or down, keeping its shape. A drawn curve is stored as its 48 points and interpolated linearly, wrapping around midnight; 24 points saved by older versions are read the same way, hourly. Moving a *heating shape preset* slider removes the drawn heating curve and returns to the parametric one. On weekends a drawn curve is **time-warped** so that the morning starts later. A weekend hour $h$ takes the weekday value at

$$
w(h) =
\begin{cases}
h & h \le 4 \text{ or } h \ge 12 \\
4 + (h - 4)\dfrac{\phi - 4}{\tau - 4} & 4 < h < \tau \\
\phi + (h - \tau)\dfrac{12 - \phi}{12 - \tau} & \tau \le h < 12
\end{cases}
$$

which maps the weekend morning peak at $\tau$ onto the weekday one at $\phi$. For heating $(\phi, \tau) = (6.5, 8.5)$, and for hot water $(7, 9)$. These are the same 2 h shifts as the parametric curves.

<details>
<summary><b>Source code:</b> <code>web/src/lib/demand.ts</code> (daily curves)</summary>

```{literalinclude} ../../app/web/src/lib/demand.ts
:language: typescript
:start-at: const gauss =
:end-before: /** 24 h mean outdoor temperature of the typical
```

</details>

### Height: the typical day in kW

The curves are drawn in kW, and their height *is* the annual demand. The link is a typical Frankfurt year (the synthetic curve below), whatever the evaluated period:

- **Space heating** is drawn for a **winter weekday** with a 24 h mean of $T_w = 0$ °C (the dashed line is the same winter day on a weekend). In the model a step's heating is proportional to $T_{lim} - \bar T$, so one such day stands for $T_{lim} - T_w$ degree-days. The typical year has $HDD = \sum_{d=1}^{365} \max(0,\ T_{lim} - \bar T_d)$ heating degree-days, with $\bar T_d = 10.5 - 9.5\cos(2\pi(d - 15)/365.25)$ (≈ 2050 K·d at 15 °C). So
  $$
  E_{SH} = \frac{HDD}{T_{lim} - T_w} \cdot \frac{5\,E_{wd} + 2\,E_{we}}{7}
  $$
  where $E_{wd}$ and $E_{we}$ are the kWh of the drawn winter weekday and weekend day.
- **Hot water** is drawn for a weekday and counts every day: $E_{DHW} = 365 \cdot (5\,E^{DHW}_{wd} + 2\,E^{DHW}_{we})/7$.

The annual demand is $E_a = E_{SH} + E_{DHW}$, so `kwhPerHouse` $= E_a / \text{houses}$ and `dhwShare` $= E_{DHW} / E_a$. **Drawing** a curve sets these two fields (`drawDay`), and **editing** them (or the number of houses, the heating limit, the weekend factor) rescales the curves shown (`typicalDayKw`), so the curves and the form always agree. Drawing the curves that are shown changes nothing, except that the first touch of a parametric curve samples it at 48 points, which moves the annual demand by up to about 0.2 % (its night-setback steps are smoothed). Both directions are pinned by `lib/demand.test.ts`.

The period's profile below still scales to the prorated annual demand over the period's own weather (see the note under *Scaling*). The kW of a 0 °C weekday in the evaluated period is therefore close to the drawn one, but not equal: a mild period concentrates its heating in fewer cold hours.

While a point or line is dragged, every animation frame (not only the release) updates the settings, so the KPIs, the sink's peak and the period charts follow the pointer. A recomputation of one sink takes a few milliseconds even for 20 000 steps.

<details>
<summary><b>Source code:</b> <code>web/src/lib/demand.ts</code> (typicalDayKw, drawDay)</summary>

```{literalinclude} ../../app/web/src/lib/demand.ts
:language: typescript
:start-at: /** 24 h mean outdoor temperature of the typical
:end-before: export function districtProfile
```

</details>

### From curves to kW: weather and scaling

The profile covers the **evaluated period**: the data center's test period, at its own step $\Delta t$ (see {doc}`heat-distribution`). It has $n$ steps at timestamps $t_i$ with outdoor temperatures $T_{out,i}$.

1. **24 h mean temperature.** Buildings react to the mean temperature of the last day rather than to every swing. With $w = \max(1, \operatorname{round}(24/\Delta t))$ steps,

   $$
   \bar T_i = \frac{1}{i - a + 1} \sum_{j=a}^{i} T_{out,j}, \qquad a = \max(0,\ i - w + 1)
   $$

   This is a trailing mean that is shorter at the start of the period. It is computed with prefix sums, so 5-second data stays fast.

2. **Degree-hours times daily curve.** The space heating weight grows linearly with how far the 24 h mean is below the heating limit $T_{lim}$, and is zero above it:

   $$
   sh_i = \max\!\left(0,\ T_{lim} - \bar T_i\right) \cdot c_{SH}(h_i), \qquad dhw_i = c_{DHW}(h_i)
   $$

3. **Scaling to the annual demand.** The annual demand of the sink, $E_a = \text{houses} \cdot \text{kWh per house}$, is prorated to the length of the period and split by the hot-water share $\sigma$. Each part is then distributed over the steps in proportion to its weights:

   $$
   E = E_a \cdot \frac{n\,\Delta t}{8760}, \qquad
   P_i = \frac{(1-\sigma)\,E\ sh_i}{\Delta t \sum_j sh_j} + \frac{\sigma\,E\ dhw_i}{\Delta t \sum_j dhw_j} \quad [\text{kW}]
   $$

   so that $\sum_i P_i\,\Delta t = E$ (unless the period has no heating degree-hours at all; then the space-heating part is 0).

**Outdoor temperature.** `site.json` → `outdoor` (set by the former Heat demand page, default `data`) picks the source:

| Choice (`outdoor`) | Temperature |
|---|---|
| *From the data* (`data`, the default) | The data center's own column `Out_Temp`, else `temperature_2m`, else the synthetic curve |
| *Typical Frankfurt year* (`synthetic`) | The **synthetic** curve below, even when the data has a column |
| *Open-Meteo at the site* (`open-meteo`) | Hourly `temperature_2m` from [Open-Meteo](https://open-meteo.com/) at the data center's location, interpolated linearly to the data's timestamps (hourly data takes the hours as they are, 5-second data the line between them; before the first and after the last hour the value is held) |

**Open-Meteo.** It is off until chosen. The location is the data center's heat-source bubble on the Site map, else the centre of its building outline (shown next to the select). The backend (`GET /api/datasets/{id}/weather/open-meteo?start=…&end=…`, `backend/core/weather.py`) asks the free [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (`archive-api.open-meteo.com/v1/archive`, no key; ERA5 and ECMWF IFS) for the dates of the evaluated period, in UTC like the data's timestamps. The archive lags a few days behind today, and the last days come from the forecast API's `past_days` (at most 92 days back). Only the coordinates (4 decimals, about 10 m) and the two dates are sent. The answer is cached in the dataset folder as `weather_open_meteo.json` and fetched again only when the coordinates or the dates change. The file is derived data: it is git-ignored for every dataset, simulations included, and is not part of a project file. Without a network, or when Open-Meteo refuses (e.g. a period in the future), the page shows why and uses the data's temperature instead. Open-Meteo's free API is for **non-commercial use** (up to 10 000 calls a day), and its data are licensed CC BY 4.0 ([terms](https://open-meteo.com/en/terms)): a commercial use needs their paid plan. Heat Distribution reads the saved choice, so it uses the same temperature.

The synthetic curve is a typical Frankfurt year, about 1 °C in mid-January and 20 °C in mid-July, ±4 K over the day with the maximum at 15 h:

$$
T_{out}(d, h) = 10.5 - 9.5 \cos\!\left(\frac{2\pi (d - 15)}{365.25}\right) + 4 \cos\!\left(\frac{2\pi (h - 15)}{24}\right)
$$

where $d$ is the day of the year (fractional) and $h$ the hour of the timestamp. The chart says which source was used.

<details>
<summary><b>Source code:</b> <code>web/src/lib/demand.ts</code> (districtProfile, syntheticOutdoor)</summary>

```{literalinclude} ../../app/web/src/lib/demand.ts
:language: typescript
:start-at: export function districtProfile
:end-before: /** Where the outdoor temperature came from
```

</details>

<details>
<summary><b>Source code:</b> <code>web/src/lib/demand.ts</code> (alignToTimes), <code>backend/core/weather.py</code> (fetch_hourly)</summary>

```{literalinclude} ../../app/web/src/lib/demand.ts
:language: typescript
:start-at: export function alignToTimes
:end-before: /** The data center's location
```

```{literalinclude} ../../app/backend/core/weather.py
:language: python
:pyobject: fetch_hourly
```

</details>

```{note}
**Prorating, not a calendar.** The annual demand is prorated by the *length* of the period, and the space-heating share is then spread over the degree-hours *inside* the period. A test period that covers only a mild half of the year therefore still receives its full prorated space-heating energy, concentrated in its colder hours. With a full year as the evaluated period, the two readings agree. This behaviour is pinned by `lib/demand.test.ts` and is deliberately kept.
```

---

## Heat sinks and the district total

Each heat sink on the Site map is one **demand entry** with its own settings (`demandEntries`):

- **No sinks on the map:** there is one entry, *Whole district*, with the settings saved in `site.json` → `district`.
- **Sinks on the map:** there is one entry per sink. A sink without its own settings starts from the whole-district numbers, with any drawn curves cleared. A **building** counts as **one house**, and a drawn **area** keeps the number of houses. The sink's own saved settings (`sinks[].demand`) override these.

Each sink's demand over the period is its **standard profile** when it has one (`sinks[].demand.profile`, a preset of `lib/profilePresets.ts`), else its curves above; `siteDemand` (`lib/profilePresets.ts`) computes it the same way for Heat Matching, the Site map and the sink's tooltip. The app's own `residential` profile *is* the curves, with the sink's settings. A standard profile is computed once per kind and scaled by each sink's annual demand, so hundreds of buildings cost one run per kind.

**Which profile a sink gets** (`profileFor`, `pages/district/siteEdits.ts`): homes (OSM house types, Wärmeatlas EFH, RH, MFH, GMH, and an unknown type) and drawn areas get **`aalborg-residential`**, the Aalborg model; offices, public bodies, schools and any other named non-residential use **`helsinki-public`**, the Helsinki model; trade BDEW `DE_GHA03` (too few measured shops to learn from); industry (OSM industrial, manufacture, factory; a use naming industry, production, factory or workshop) the flat `constant` profile, since its heat follows shifts and processes rather than the weather (ask for its metered load). A sink saved earlier keeps the profile it was saved with.

**The Aalborg model** (`lib/learnedModels.ts`, coefficients in `aalborgModel.json`) is a regression learned from measured homes (AI): the mean heat demand of 3,021 homes in Aalborg (smart heat meters, 2018-2020; Schaffer et al. 2022, CC-BY-4.0) from the hour of the week (Central European time), the outdoor temperature smoothed with half-lives of 6, 24 and 72 h (heating degrees at several knots), hour-of-day and weekend terms that grow with the cold, and the clear-sky irradiance of the date and place (sunny spring days need less heat). It is tested on the year it did not see (2020) it misses the Aalborg network by 10 % hourly, 8 % daily, 4 % monthly (CV(RMSE)). Why it replaced BDEW and the app's curves for homes: a reverse test put the profiles on the measured homes and on Flensburg's city network. Over a district (Aalborg network, each profile scaled to the measured year):

| Profile | CV(RMSE) hourly | daily | peak | day shape (energy above the daily mean, profile / measured) |
|---|---|---|---|---|
| BDEW HEF03 / HMF03 | 19 % | 15 % | −14 to −21 % | 0.1 (flat within the day) |
| App's `residential` curves | 40 % | 20 % | +47 % | 3.4 |
| Aalborg model (app variant) | 10 % | 8 % | −7 % | 1.0 |

On Flensburg (2019-2024) the app variant scores 15 % hourly and 11 % daily against 17-19 % and 12-14 % for BDEW and 41 % and 24 % for `residential`. For **one house** no profile comes close (about 45 % hourly, even the measured mean of all Aalborg homes): there the annual demand is the number that counts.

**The Helsinki model** (`lib/learnedModels.ts`, coefficients in `helsinkiPublicModel.json`) has the same features, learned from the hourly heat of 258 of the City of Helsinki's service buildings (20 offices, 124 schools, 114 day-care centres; Nuuka Open API, CC BY 4.0 per Helsinki Region Infoshare) in 2018, 2019 and 2025, each building relative to its own mean; 2023-06-16 to 2024-03-17 is left out (the source serves about twice the level there). One model for all three kinds: offices alone are too few to learn from. Fitted on half the buildings (2018-2019) and tested on the other half (2025), all of a kind summed:

| Kind | Helsinki model hourly / daily / peak | BDEW GKO03 hourly / daily / peak |
|---|---|---|
| Offices (10) | 18 % / 13 % / −6 % | 28 % / 17 % / −35 % |
| Schools (61) | 12 % / 8 % / −3 % | 25 % / 12 % / −34 % |
| Day care (57) | 12 % / 6 % / −6 % | 31 % / 14 % / −36 % |

The app's `office-hours` shape (no weather) missed by 85-102 % hourly. It is learned in Helsinki's climate on Helsinki's clock and applied on Central European time: the shape carries over, whether German buildings (less insulation, fewer ventilation units with heat recovery) answer the weather with the same slope is not checked.

The **district total** is the sum of the profiles of the *included* sinks, the ones whose checkbox is ticked. The network temperatures to meet are those of the included sink with the **highest supply temperature**. If no sink is included, the first entry's settings (or the defaults) are used.

| Figure | Definition |
|---|---|
| Annual demand (KPI, per sink) | $\text{houses} \cdot \text{kWh per house} / 1000$ MWh/a, summed over the included sinks |
| Peak load | Highest step of the included total over the evaluated period (kW) |
| Average | Annual demand ÷ 8760 h (kW) |
| Full-load hours | Annual demand ÷ peak (h) |
| Supply / return | Of the hottest included sink |

Annual and average figures are per year, computed from the houses. The peak comes from the evaluated period's profile, as the page says.

**Saving** (*Save heat demand*) writes to `site.json`. The *Whole district* entry (if present) goes to `district`. Each sink stores its settings in `demand`, and its **map bubble** becomes its peak kW (rounded) and its supply temperature, so the Site map shows the demand you generated. Heat Distribution reads the saved state (`districtYear`), not unsaved edits.

<details>
<summary><b>Source code:</b> <code>web/src/lib/demand.ts</code> (demandEntries, totals), <code>web/src/lib/demandStore.ts</code></summary>

```{literalinclude} ../../app/web/src/lib/demand.ts
:language: typescript
:start-at: export function demandEntries
```

```{literalinclude} ../../app/web/src/lib/demandStore.ts
:language: typescript
:start-at: export async function evaluatedYear
```

</details>

---

## The site map

The Site map is a [Leaflet](https://leafletjs.com) map with three base layers (*Street*, *Dark*, *Satellite*). It opens over Frankfurt at zoom 17 and moves to the data center once the site has loaded. The street map follows the app's light/dark theme. *Dark* uses Esri's World Dark Gray Canvas (keyless; CARTO's `dark_all` now needs an API key). A chosen *Satellite* layer stays when the theme changes.

| Action | What happens |
|---|---|
| **Search an address** | Address → map position (Nominatim search) |
| **Pick another building** | The next click looks up the building under it. It becomes the data center's building (red outline), and the heat-source bubble moves to its centre. A new source starts at 35 °C and 40 kW. |
| **+ Buildings** | Every click adds a heat sink: the clicked building (blue outline, bubble at its centre) or, when there is no building there or OSM does not answer, a plain bubble. A new sink starts with the default demand (12 MWh/a, its bubble sized by its peak hour). |
| **+ Area (district)** | Click the corners (at least 3), then *Finish area*. The polygon (dashed) becomes **one** heat sink standing for a whole district, named "District *n*", at 70 °C. Its Wärmeatlas buildings (centre inside the polygon) then load by themselves, show as points coloured by their demand, and their summed annual demand becomes the district's (one "house" per building at their mean, their hot-water share, the profile of the buildings with the most demand); the card lists each district's buildings and MWh/a. A district with a demand of its own keeps it, with **Use** to take its buildings' instead. Without the Wärmeatlas import (or with no building inside) it keeps the default of 200 houses × 12 MWh/a. |
| **Edit** | Name, temperature (°C) and power (kW) of the source and every sink. Sinks can be deleted. |
| **Save site** | `PUT /api/datasets/{id}/site`. Nothing is saved before this. |
| **Load heat demand in view** | Draws the buildings of the current view with their modelled heat demand from the local Wärmeatlas import (see *Buildings from the Wärmeatlas Hessen* below). A click on one adds it as a heat sink; *Add all in view* adds the loaded buildings in the view, at most the 200 largest, after a confirmation (count and MWh/a). |
| **Open building →** | Goes to Data Center › Structure and Modelling. |

### Bubbles

Following HeatTransPlan, a bubble's **size** is its power and its **colour depth** is its temperature (`pages/district/bubbles.ts`). A sink's power is its demand's peak hour on the typical year, the figure its row in the heat sinks' list shows (`sinkProfile.ts` `bubbleKw`), not its stored `power_kw`; the data center's is its `power_kw`:

$$
r = 7 + \frac{P - P_{min}}{P_{max} - P_{min}} \cdot (22 - 7)\ \text{px}, \qquad
\theta = \operatorname{clip}\!\left(\frac{T - 10}{90 - 10},\ 0,\ 1\right)
$$

The radius is scaled across **all** bubbles on the map (14.5 px when they all have the same power). The colour is on a **fixed** 10–90 °C scale, so a colour means the same temperature on every map. Red is the source, with fill $\text{rgb}(255,\ 150 - 150\theta,\ 150 - 150\theta)$. Blue is a sink, with fill $\text{rgb}(150 - 130\theta,\ 190 - 150\theta,\ 255)$.

### Finding the building under a click

`pages/district/osm.ts:buildingAt` tries three lookups, fastest first:

1. **Nominatim reverse** (address layer, with the polygon). If OSM returns a *building* with an outline, that is the answer, usually in under a second. If the result is anything else but a point (a street, an area, open ground), the answer is "no building".
2. **Nominatim search** by the street address of the clicked point (house number, road, postcode, city), for clicks on a shop or an address node inside a building. A returned building counts only if its outline contains the clicked point (ray casting).
3. **Overpass**, as a last resort: which `building` way contains the point. This is slow, up to ~30 s, with a 45 s timeout.

Outlines are stored as `[lat, lon]` rings (Leaflet's order). GeoJSON is `[lon, lat]`, so `outerRing` swaps the coordinates, and for a MultiPolygon it takes the first polygon's outer ring.

<details>
<summary><b>Source code:</b> <code>web/src/pages/district/osm.ts</code> (buildingAt), <code>bubbles.ts</code></summary>

```{literalinclude} ../../app/web/src/pages/district/osm.ts
:language: typescript
:start-at: export async function buildingAt
```

```{literalinclude} ../../app/web/src/pages/district/bubbles.ts
:language: typescript
:start-at: export const R_MIN
```

</details>

### Example data centers (example layer)

The Site map always shows example data centers as an overlay ("Data centers (example)" in the layer control, on by
default). One is built in: the app's own simulations (`sim_*`) placed on a Frankfurt building, the European Central
Bank, drawn as a red ring (63 kW, the maximum IT power `ITE_Ener` of `sim_1_modified`; mean 38 kW). These datasets'
`site.json` puts their data-center building there, so their Site map opens on it. The built-in list is static
(`app/web/src/pages/district/frankfurtDataCenters.ts`).

Further examples, such as real sites to compare with, are machine-local: `app/data/_local/map_examples.json` (never
committed, see {doc}`../architecture/data-and-privacy`), served by `GET /api/district/examples` and drawn as filled
red circles. Their number is the maximum waste heat, typically the IT capacity, since nearly all IT power becomes heat;
each entry gives its basis and source in the marker popup. Without that file only the built-in examples show.

### Forest equivalents (Quick analysis)

Under the CO₂ saved, the Quick analysis shows the trees that take up as much CO₂ in a year, as a grove of icons, and on demand the forest they make, drawn on the map as soccer fields side by side (`pages/district/trees.ts`, drawn by `TreeGrove.tsx`): **Show in the forest** draws it in the Frankfurter Stadtwald for a site in or by Frankfurt (within 25 km), else in the nearest forest OpenStreetMap knows around the data center, and flies there; **Place the area** puts it where the next click on the map is.

$$
n_{trees} = \frac{1000\, m_{CO_2}}{20}, \qquad A_{CO_2} = \frac{m_{CO_2}}{V_{growth} \cdot 1.4\ \text{t/m}^3} = \frac{m_{CO_2}}{12.5\ \text{t/(ha·a)}}, \qquad
n_{fields} = \frac{A_{CO_2}}{0.714\ \text{ha}}
$$

with $m_{CO_2}$ the CO₂ saved (t a year). No CO₂ saved (more grid CO₂ than gas avoided): no trees and no forest.

| Factor | Value | Source |
|---|---|---|
| CO₂ a grown tree takes up | 20 kg a year | the middle of the estimates per tree, about 10 to 30 kg (a grown beech about 12.5 kg, Wald-Zentrum, Universität Münster; ~22 kg, Arbor Day Foundation; ~29 kg for a beech, Stiftung Unternehmen Wald) |
| Growth, $V_{growth}$ | 8.9 m³ of wood per ha a year | Bundeswaldinventur 2022, *BWI4 Daten Hessen* (Hessian forestry ministry, 2024) |
| CO₂ per m³ of wood grown | about 1.4 t (the whole tree, with branches and roots) | the same, chapter 3; IPCC 2006 Guidelines, vol. 4, tables 4.4 and 4.14 |
| A hectare of forest | 12.5 t of CO₂ a year, as much as about 620 grown trees | the two above (the hectare's uptake is the firmer number; the trees per hectare follow from it) |
| Soccer field | 105 × 68 m, 0.714 ha; lines after Law 1: centre circle 9.15 m, penalty areas 16.5 × 40.32 m | FIFA, *Football Stadiums: Technical Recommendations and Requirements*; IFAB, *Laws of the Game*, Law 1 (100–110 × 64–75 m) |
| The Stadtwald's forest | about 4,800 ha | City of Frankfurt, Waldzustandsbericht 2024 (about 6,000 ha, 1,200 of them in the Taunus) |

For *Recovery · air cooled* on the map (21,957 MWh delivered, 2,836 t CO₂ saved, as of 2026-11-24): about 140,000 trees, a forest of about 230 ha or 320 soccer fields. The forest's label also says the heat in everyday terms, as an equivalent: as much heat as about 2,440 average households use (9 MWh a year each, `lib/heatFacts.ts`); the heat network's "Apartments supplied" on the same page is another number, the apartments of the buildings it supplies.

**On the map.** The fields form a near-square block, rows from the north, the long side east, all in one map shape so that thousands draw as quickly as one; the pitch lines show from zoom 14. Above 2,500 fields the block is one area of their size. The caption sits under the block; one bigger than the Stadtwald says so. The button of the drawn block flies back to where you were.

**Limits.** The trees are an order of magnitude: species, age and site put a tree anywhere from about 10 to 30 kg CO₂ a year. The hectare counts the wood a Hessian forest grows, not its net balance (Hessen's forest lost more wood than it grew in 2012–2022). A block above about 190 ha no longer stays clear of the roads through the Stadtwald.

<details>
<summary><b>Source code:</b> <code>web/src/pages/district/trees.ts</code> (the factors and what is made of them)</summary>

```{literalinclude} ../../app/web/src/pages/district/trees.ts
:language: typescript
:start-at: export const WOOD = {
```

</details>

### External services

The Site map is the only page that sends anything about the site to the internet (the other outside requests are listed in [Data and privacy](../architecture/data-and-privacy.md)). It calls these public services directly from the browser, not through the backend:

| Service | URL | When | What is sent |
|---|---|---|---|
| OpenStreetMap tiles | `tile.openstreetmap.org` | Street layer | Tile coordinates of the visible area |
| Esri World Dark Gray Canvas | `server.arcgisonline.com` | Dark layer | Tile coordinates of the visible area |
| Esri World Imagery | `server.arcgisonline.com` | Only when the Satellite layer is chosen | Tile coordinates |
| Nominatim | `nominatim.openstreetmap.org` | Address search; building look-ups (reverse and search) | The typed address; the clicked coordinates; the address OSM returned |
| Overpass API | `overpass-api.de` | Building look-up fallback | The clicked coordinates |
| Overpass API | `overpass-api.de` | Only on a click of *Load streets from OpenStreetMap* (Heat distribution card), for a data center without stored streets | The box of the heat sinks plus 150 m (south, west, north, east); at most 3 km across ({doc}`heat-network`) |
| Wärmeatlas Hessen | `www.waermeatlas-hessen.de` | Only once, when `scripts/import_waermeatlas.py` downloads the zip (not from the page) | Nothing but the download request; the map box of *Load heat demand in view* goes to the local backend only |

No measurement, model, graph or drawing is sent. The coordinates of the site do reach these services, which also see the user's IP address. Apart from the map, the page loads its fonts from Google Fonts (`app/web/index.html`), and the backend's `tabpfn` package may download its pretrained weights the first time TabPFN is used, with no data sent. See {doc}`../architecture/data-and-privacy`.

---

## Buildings from the Wärmeatlas Hessen

For Frankfurt (and any other Hessian municipality, after a one-line change of the download URL) the Site map can show every heated building with its **modelled** annual heat demand and turn a building into a heat sink with that demand.

**Source.** The [Wärmeatlas Hessen](https://www.waermeatlas-hessen.de) of the LEA LandesEnergieAgentur Hessen, data as of October 2023, base year 2020. LEA delivers one zip per municipality; Frankfurt's is `06412000_Frankfurt_am_Main.zip` (255 MB), a GeoPackage in ETRS89 / UTM 32N (EPSG:25832) with a data description (`Datenbeschreibung.pdf`). The app uses two of its layers:

| Layer | Rows (Frankfurt) | Columns used |
|---|---|---|
| `WAH_Punkte` (one point per building, inside its outline) | 200 279, of which 87 861 have a heat demand | `gebid` building id · `energieflaeche` heated floor area m² · `gebalter_<class>` probability of each of 11 construction-age classes · `nutzmix_alkis_beschreib` ALKIS building use · `gebtyp_gemod` energy type (EFH, RH, MFH, GMH = single-family, terraced, multi-family, large multi-family; else a non-residential class) · `qh_2020_kwh`, `qw_2020_kwh`, `qnutzwaerme_2020_kwh` modelled space heating, hot water and total useful heat in kWh/a · `qh_moderate_sanierung_2030_kwh`, `..._2045_kwh` space heating after moderate renovation |
| `Hausumringe` (ALKIS building outlines) | 228 693 | the polygon |

The layers share no key, so each point is joined to the outline that contains it. The other layers (blocks, 100 m and 1 km grid, street segments, parcels, renovation levels "stärker" and "ambitioniert") are not used.

**Import, once.** `app/scripts/import_waermeatlas.py` downloads the zip into `app/data/_external/waermeatlas/` (git-ignored; the script refuses to run otherwise), unpacks the GeoPackage and writes `buildings.sqlite`: one row per heated building with WGS84 coordinates, its outline as `[lat, lon]` JSON, the most likely age class and its probability, and an SQLite **R-tree** over each outline's bounding box. It streams row by row through the GeoPackage's own R-tree indexes (each point finds the outlines whose box contains it, then a ray-casting test picks the one around it): about 9 s and 35 MB of memory, 39 MB on disk. Coordinates go from UTM 32N to WGS84 with Krüger's series in `backend/core/waermeatlas.py` (millimetre accuracy, no GDAL or pyproj; `tests/test_waermeatlas.py` checks it against the exact meridian arc and the forward series).

```bash
cd app && bash scripts/guard.sh .venv/bin/python scripts/import_waermeatlas.py   # --rebuild to write the SQLite again
```

**Query, one box at a time.** `GET /api/district/buildings?bbox=south,west,north,east` reads only the R-tree pages and rows of that box, biggest demand first, and answers at most 3000 buildings (`truncated: true` when there were more; the smallest are left out). A box larger than 2 × 2 km is refused with *Zoom in* (`WAERMEATLAS_MAX_BOX_KM`, `WAERMEATLAS_MAX_BUILDINGS` in `limits.py`), and without the import the route answers 404 *run scripts/import_waermeatlas.py*. A 1 × 0.6 km view in the city centre: ~400–500 buildings, 5–40 ms in the query, ~1 MB of JSON; a full 2 × 2 km box in the city centre: 3000 buildings (capped), 40–260 ms, ~2 MB of JSON, and the query process's peak memory grows by ~40 MB. The page asks only when *Load heat demand in view* is pressed, never on pan or zoom.

<details>
<summary><b>Source code:</b> <code>backend/core/waermeatlas.py</code> (buildings_in)</summary>

```{literalinclude} ../../app/backend/core/waermeatlas.py
:language: python
:pyobject: buildings_in
```

</details>

**On the map** (`pages/district/WaermeatlasPanel.tsx`, `waermeatlas.ts`) buildings are coloured by total useful heat on a sequential scale with seven classes (≤ 20, 50, 100, 250, 500, 1000 and > 1000 MWh/a). The tooltip shows use, energy type, age class (with its probability), heated floor area, and heating and hot water in MWh/a. While the layer is shown the map's attribution names the sources in view, e.g. *Wärmebedarf © LEA Hessen (Wärmeatlas Hessen), modelled useful heat 2020*.

**As a heat sink** a building becomes one "house" (`houses: 1`) with

$$
\text{kwhPerHouse} = (Q_{heating} + Q_{hot\ water}) \cdot f, \qquad \text{dhwShare} = \frac{Q_{hot\ water}}{Q_{heating} + Q_{hot\ water}}
$$

where $f$ is the **non-residential correction** (default 1, applied only to buildings whose energy type is not EFH, RH, MFH or GMH). Its id is `wah-<gebid>` (a building of another source: `<source>-<id>`, e.g. `nrw-10602251`), so a building is never added twice; its outline and point come from the data, its name is the ALKIS use and the building id, and its starting power is the annual demand over 2000 full-load hours (replaced by the demand model's peak once a page computes it). The Heat demand page then shows exactly that annual demand for it.

**Accuracy.** The values are **modelled useful heat** (Nutzwärme) from building type, size and age class, not measured consumption and not final energy. LEA's own evaluation finds the modelled non-residential demand about **45 % below** the state energy statistics, which matters in the office-heavy city centre: a correction factor of about 1.8 would undo that on average. The age class is a probability (the most likely class is shown), and buildings without a heat demand (garages, sheds) are left out. Positions are right: where ALKIS and OpenStreetMap cut a building the same way, the outlines agree to about 0.1 m (for an office tower in the centre: centroids 0.3 m apart, 807 vs 805 m²), and the buildings of a block add up exactly to LEA's own block sums (`WAH_Baubloecke`). Where they cut it differently (a tower and its podium, one outline per wing) a building's outline and demand cover only its ALKIS part.

**Licence.** "Fachdaten: © LEA LandesEnergieAgentur Hessen GmbH"; no open licence is named. The building outlines come from the Geoportal Hessen (dl-de/zero-2.0). Use the data for internal planning, always show the attribution, and ask LEA (waermeatlas@lea-hessen.de) before any further reuse. The data stays on this machine and is never committed. It is the city's, not a data center's: one import serves every project on this machine, the examples included (`find_dbs` in `backend/core/waermeatlas.py`: each source's newest import of the open data folder, the examples or any version). On another computer, run the import script once. Other municipalities of Hessen: pass each LEA delivery name (or its URL) to the script, e.g. `scripts/import_waermeatlas.py 06411000_Darmstadt`; it rebuilds the file with every delivery fetched so far, and the newest file is the one read.

### Other states: the open atlases of `app/sources/`

Each folder of `app/sources/` imports one more source into the same format, its own `buildings.sqlite` beside the Wärmeatlas one (`app/data/_external/<source>/`, git-ignored); the layer reads every source's import for the box, biggest demand first, and each building and street segment carries its `source`. The attribution and the information texts name the sources in view.

| Source | Folder · run (in `app/`) | What it adds | Licence |
|---|---|---|---|
| Kommunale Wärmeplanung NRW (LANUK, model 2024) | `sources/nrw/` · `bash scripts/guard.sh .venv/bin/python sources/nrw/fetch.py Bonn` (a name, ä → ae, or the AGS; several at once) | every heated building of the municipality (outline, ALKIS use, type EFH/RH/MFH/GMH, age class, useful floor area, space heating and hot water, space heating 2030 and 2045 with moderate renovation) and its street segments' heat line density (with commerce's process heat) | dl-de/zero-2.0 |

The NRW values are modelled **useful heat**, like Hessen's; LANUK warns that a single building can differ greatly from its real consumption (compare sums). A zip is read where it is (`sources/shp.py`, a stdlib shapefile reader): Bonn's 134 MB zip gives 123,461 buildings in about 25 s at 65 MB RSS. The research behind the choice of sources (every German state's atlas, the national grids, profiles, heat networks, with their licences) is kept locally, not in the repository.

---

## Limits

- **Generated, not measured.** The profile is a plausible shape, not a forecast for a real district. Its total is exactly the annual demand you enter. The Aalborg model's shape is learned from measured Danish homes (district heating, median construction year 1967); offices and shops keep BDEW, which nothing measured has checked here.
- **The learned models' clock.** They read the timestamps as UTC (as the examples are) and puts them on Central European time with EU summer time. Data whose timestamps are local time would shift their day shape by one to two hours. Public holidays are not known in the app.
- **Linear in degree-hours.** Space heating is proportional to $T_{lim} - \bar T$. Solar gains, wind and the thermal mass of buildings beyond the 24 h mean are not modelled.
- **One climate.** Every sink uses the data center's outdoor temperature (or the synthetic Frankfurt year).
- **The data's clock.** The daily curves use the hour of the data's own timestamps. These carry no time zone and are read as UTC without any shift, so the peaks sit at the stated hours of the data's clock. Daylight-saving changes are not modelled.
- **No network in the demand.** Distances, pipe losses and the network's own heat demand are not in the demand or in Heat Matching. Supply temperature is a property of each sink, and the hottest included sink sets it for the whole district. The Site map's *Heat distribution* card plans a network with its pipe losses on its own ({doc}`heat-network`).
