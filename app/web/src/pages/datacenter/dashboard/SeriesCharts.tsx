/**
 * The time series as small multiples: one chart per chosen variable on its own y-axis (units differ, so never two
 * scales in one chart), sharing time and the hover cursor, over the period chosen (all the data, a year or a month;
 * seriesPeriod.ts). The columns are loaded in full (GET .../data) and thinned to means of consecutive rows; a file
 * with more rows than FINE_ROWS shows the summary's bin means instead (and its strip counts those). Left of each chart
 * the distribution of the shown period's rows turned sideways, on the chart's own y scale, so a level meets its bar. Each line has the
 * colour of its part (the data center red, the heat distribution orange, the district blue, as on Home and Heat Matching);
 * the chips have the colour of how each variable is modelled (index.css --way-*, as on Structure and Modelling). The
 * period, the variables and the colour legend go into the panel on the left (`side`), or above the charts while it is closed.
 */
import { useOnFocus } from "../shared/focus";
import { useKept } from "../../../lib/kept";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import uPlot from "uplot";
import { fetchTimeSeriesData, type DatasetSummary, type StructureScope } from "../../../api";
import { useThemeKey } from "../../../app/theme";
import { DATASET } from "../../../dataset";
import { themedAxis, useUplot } from "../../../ui/LineChart";
import { Field } from "../../../ui/Field";
import { Segmented } from "../../../ui/Segmented";
import { APPROACHES, type Approach } from "../modelling/approaches";
import { compact, defaultShown, unixSeconds } from "./dashboard";
import { FINE_ROWS, MONTHS, countsIn, inPeriod, monthsWithData, periodLabel, yearsOf, type SeriesPeriod } from "./seriesPeriod";

const HEIGHT = 130; // px, a chart and its strip
const STRIP = 72; // px, the sideways distribution

/** A variable's colour: how it is modelled (null, calculated: not modelled); not known yet: the accent. */
const wayToken = (a: Approach | null | undefined) => (a === undefined ? "--accent" : `--way-${a ?? "off"}`);
/** The part's colour, for its lines (index.css twin colours). */
const PART_TOKEN: Record<StructureScope, string> = { dc: "--hot", heat: "--heat", district: "--cool-strong" };
const tokenValue = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

/** Where the chart's plot area is (CSS px from its top) and the y range it shows: the strip draws on the same. */
type Frame = { min: number; max: number; top: number; height: number };
const sameFrame = (a: Frame | null, b: Frame) => !!a && a.min === b.min && a.max === b.max && a.top === b.top && a.height === b.height;
const BINS = 24;

/** The period's values as a histogram turned sideways, bars growing left from the chart's axis, binned over the chart's
 * own y range (values beyond it left out), so each bar sits at the level it counts. */
function SideHistogram({ name, raw, frame, color }: { name: string; raw: (number | null)[]; frame: Frame | null; color: string }) {
  const lo = frame?.min ?? 0;
  const hi = frame?.max ?? 0;
  const counts = useMemo(() => countsIn(raw, lo, hi, BINS), [raw, lo, hi]);
  const edges = Array.from({ length: BINS + 1 }, (_, i) => lo + ((hi - lo) * i) / BINS);
  const most = Math.max(1, ...counts);
  const span = frame ? frame.max - frame.min || 1 : 1;
  const y = (value: number) => (frame ? frame.top + (1 - (value - frame.min) / span) * frame.height : 0);
  return (
    <svg className="dash-series__dist" width={STRIP} height={HEIGHT} style={{ fill: color }} role="img" aria-label={`Distribution of ${name} in the period shown, on the value axis of its chart`}>
      {frame &&
        counts.map((c, i) => {
          const a = Math.max(frame.top, y(edges[i + 1]));
          const b = Math.min(frame.top + frame.height, y(edges[i]));
          const w = (c / most) * (STRIP - 4);
          return b > a && c > 0 ? <rect key={i} x={STRIP - w} y={a} width={w} height={Math.max(1, b - a - 0.5)} /> : null;
        })}
    </svg>
  );
}

function SmallChart({ xs, ys, name, raw, color }: { xs: number[]; ys: (number | null)[]; name: string; raw: (number | null)[]; color: string }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const { el } = useUplot(
    (width) => ({
      opts: {
        width,
        height: HEIGHT,
        // after every redraw (autoscale, resize): the strip follows the y scale and the plot area
        hooks: {
          draw: [
            (u: uPlot) => {
              const { min, max } = u.scales.y;
              if (min == null || max == null) return;
              const f = { min, max, top: u.bbox.top / uPlot.pxRatio, height: u.bbox.height / uPlot.pxRatio }; // bbox: canvas pixels
              setFrame((p) => (sameFrame(p, f) ? p : f));
            },
          ],
        },
        scales: { x: { time: true } },
        cursor: { sync: { key: "dash" } },
        legend: { show: true },
        axes: [themedAxis(), themedAxis({ size: 60, values: (_u, ticks) => ticks.map((t) => compact(t)) })],
        series: [{}, { label: name, stroke: color, width: 1.5, value: (_u, x) => compact(x) }],
      },
      data: [xs, ys as number[]],
    }),
    [xs, ys, name, color],
  );
  return (
    <div className="dash-series__row">
      <SideHistogram name={name} raw={raw} frame={frame} color={color} />
      <div ref={el} className="dash-series__chart" role="img" aria-label={`${name} over time`} />
    </div>
  );
}


/** `scope`: whose data, its colour on the lines; `approach`: how each variable is modelled (useApproaches); `side`: where the filters go, the panel on the left;
 * `period`: what the charts show, chosen here and kept by the page (its KPIs follow it). */
type Layout = "rows" | "tiles";
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "rows", label: "Rows" },
  { id: "tiles", label: "Tiles" },
];
const LAYOUT_KEY = "dash-series-layout";

export function SeriesCharts({
  scope = "dc",
  summary,
  approach,
  side,
  period,
  onPeriod,
}: {
  scope?: StructureScope;
  summary: DatasetSummary;
  approach: Record<string, Approach | null>;
  side: HTMLElement | null;
  period: SeriesPeriod;
  onPeriod: (p: SeriesPeriod) => void;
}) {
  // the charts one under the other, or as tiles side by side (as many as the width takes), as last chosen in this browser
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "tiles" ? "tiles" : "rows";
    } catch {
      return "rows";
    }
  });
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* only not remembered */
    }
  };
  const all = useMemo(() => summary.variables.map((v) => v.name), [summary]);
  // the variables picked, kept per part and file when the page is left; one since removed is left out
  const [picked, setShown] = useKept(`${scope}-series-shown|${summary.file}`, () => defaultShown(summary.variables));
  const shown = useMemo(() => picked.filter((n) => all.includes(n)), [picked, all]);
  const toggle = (name: string) => setShown((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  // a double click: only that one, and on the lone one again all of them. Its two clicks have toggled it twice
  // before (no net change), so the click needs no delay
  const only = (name: string) => setShown((s) => (s.length === 1 && s[0] === name ? all : [name]));
  // picked in the graph on the left: a click adds or removes it, a double click shows only it; when the view opens
  // after a pick, the picked one is added (never taken away)
  const opened = useRef(true);
  useOnFocus((v, p) => {
    if (!all.includes(v)) return;
    if (p.only) only(v);
    else if (opened.current) setShown((s) => (s.includes(v) ? s : [...s, v]));
    else toggle(v);
  });
  useEffect(() => {
    opened.current = false;
  }, []);
  const years = useMemo(() => yearsOf(summary.start, summary.end), [summary]);
  const coarseXs = useMemo(() => unixSeconds(summary.series.time), [summary]);

  // the shown columns in full, each loaded once (one request per column: one that cannot be loaded stays coarse)
  const [fine, setFine] = useState<{ times: number[]; cols: Record<string, (number | null)[]> }>({ times: [], cols: {} });
  const asked = useRef(new Set<string>());
  // a column asked for stays asked when the shown ones change, so its answer is dropped only once the charts are gone
  // (another file remounts them)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (summary.rows > FINE_ROWS) return;
    for (const c of shown.filter((c) => !asked.current.has(c))) {
      asked.current.add(c);
      fetchTimeSeriesData(DATASET, summary.file, [c])
        .then((r) => alive.current && setFine((f) => ({ times: f.times.length ? f.times : unixSeconds(r.time), cols: { ...f.cols, [c]: r.columns[c] } })))
        .catch(() => {}); // stays on the summary's bin means
    }
  }, [shown, summary]);

  const theme = useThemeKey(); // the colours are read from the CSS tokens: again on a theme change
  // memoised: a chart is rebuilt only when its points or colour change, not on every render (its strip's redraws)
  const charts = useMemo(
    () =>
      summary.variables
        .filter((v) => shown.includes(v.name))
        .map((v) => {
          const full = fine.cols[v.name];
          const p = full ? inPeriod(fine.times, full, period) : inPeriod(coarseXs, summary.series.columns[v.name], period);
          return { v, p, full: !!full, color: tokenValue(PART_TOKEN[scope]) };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme: the colours are read from the CSS tokens again on a theme change
    [summary, shown, fine, period, coarseXs, scope, theme],
  );
  const first = charts[0];

  const filters = (
    <div className="dash-filters">
      <PeriodPicker summary={summary} period={period} onPeriod={onPeriod} />
      <div className="dash-filters__head">
        <span className="caps">Variables</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setShown(all)}>
          All
        </button>
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setShown([])}>
          None
        </button>
      </div>
      <div className="chips dash-filters__vars" role="group" aria-label="Variables to plot">
        {summary.variables.map((v) => (
          <button
            key={v.name}
            type="button"
            className={shown.includes(v.name) ? "chip chip--on dash-chip" : "chip dash-chip"}
            style={{ "--way": `var(${wayToken(approach[v.name])})` } as CSSProperties}
            aria-pressed={shown.includes(v.name)}
            onClick={() => toggle(v.name)}
            onDoubleClick={() => only(v.name)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <p className="muted dash-filters__hint">Click to add or remove; double-click to show only that one</p>
      <div className="dash-filters__legend" aria-label="Colours: how each variable is modelled">
        {APPROACHES.map((a) => (
          <span key={a.id} className="dash-chip" style={{ "--way": `var(--way-${a.id})` } as CSSProperties}>
            {a.short}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="dash-series">
      {side ? createPortal(filters, side) : filters}
      <div className="dash-series__bar">
      <p className="muted dash__note">
        {periodLabel(period, years)}
        {first &&
          `: ${first.p.xs.length} points per variable (${first.p.per > 1 ? `each the mean of ${first.p.per} ${first.full ? "rows" : "bin means"}` : first.full ? "every row" : "the summary's bin means"})`}
        ; hover a chart to read the values.{side ? " Period and variables: in the panel on the left." : ""}
      </p>
      <Segmented<Layout> label="Layout" value={layout} onChange={chooseLayout} options={LAYOUTS} />
      </div>
      <div className={layout === "tiles" ? "dash-series__list dash-series__list--tiles" : "dash-series__list"}>
      {charts.map(({ v, p, color }) => (
        <div key={v.name}>
          <span className="mono dash-series__name">{v.name}</span>
          {p.xs.length ? <SmallChart xs={p.xs} ys={p.ys} name={v.name} raw={p.raw} color={color} /> : <p className="muted dash__note">No data in this period.</p>}
        </div>
      ))}
      </div>
    </div>
  );
}

/** The period's year and month, as the panel on the left shows them (Historical's time series, Scenarios' replay). */
export function PeriodPicker({ summary, period, onPeriod }: { summary: DatasetSummary; period: SeriesPeriod; onPeriod: (p: SeriesPeriod) => void }) {
  const years = useMemo(() => yearsOf(summary.start, summary.end), [summary]);
  const months = useMemo(() => (period.year == null ? new Set<number>() : monthsWithData(unixSeconds(summary.series.time), period.year)), [summary, period.year]);
  return (
    <div className="dash-filters__period">
      <Field label="Period">
        <select
          className="field field--sm"
          value={period.year == null ? "all" : String(period.year)}
          onChange={(e) => onPeriod({ year: e.target.value === "all" ? null : Number(e.target.value), month: null })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
          <option value="all">{years.length === 2 ? "Both years" : "All years"}</option>
        </select>
      </Field>
      <Field label="Month">
        <select
          className="field field--sm"
          value={period.month == null ? "" : String(period.month)}
          disabled={period.year == null}
          onChange={(e) => onPeriod({ ...period, month: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Whole year</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i} disabled={!months.has(i)}>
              {m}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
