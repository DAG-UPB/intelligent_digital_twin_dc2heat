/** uPlot line chart over time, and the themed axis options every uPlot chart in the app uses. */
import { useEffect, useRef, type DependencyList } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useThemeKey } from "../app/theme";
import { fmt } from "../lib/format";
import { LANG } from "../lib/i18n";

export interface Line {
  label: string;
  values: number[];
  color: string;
  fill?: boolean;
}

/** uPlot axis options themed from the CSS tokens (read at call time: rebuild the chart on useThemeKey() changes). */
export function themedAxis(extra: uPlot.Axis = {}): uPlot.Axis {
  const css = getComputedStyle(document.documentElement);
  const grid = css.getPropertyValue("--chart-grid").trim();
  return {
    stroke: css.getPropertyValue("--chart-axis").trim(),
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1 },
    font: `11px ${css.getPropertyValue("--font-mono").trim() || "monospace"}`,
    labelFont: `11px ${css.getPropertyValue("--font").trim() || "sans-serif"}`,
    ...extra,
  };
}

const H = 3600;
const D = 24 * H;
const NAMES_DE: uPlot.DateNames = {
  MMMM: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  MMM: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  WWWW: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  WWW: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
};

// the tick formats by tick increment (s): [incr, tick, then at a new year, -, at a new day, -, -, -, 1: appended], as uPlot's own
const STAMPS: uPlot.Axis.TimeValuesConfig = [
  [365 * D, "{YYYY}", null, null, null, null, null, null, 1],
  [28 * D, "{MMM}", "\n{YYYY}", null, null, null, null, null, 1],
  [D, "{D}.{M}.", "\n{YYYY}", null, null, null, null, null, 1],
  [H, "{HH}:{mm}", "\n{D}.{M}.{YYYY}", null, "\n{D}.{M}.", null, null, null, 1],
  [60, "{HH}:{mm}", "\n{D}.{M}.{YYYY}", null, "\n{D}.{M}.", null, null, null, 1],
];

/** A value axis's ticks as every number on the page ("12.500", "0,2"; uPlot's own: "12,500", "0.2"), with the
 * decimals their spacing needs. */
export const germanTicks = (_u: unknown, ticks: number[]) => {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(ticks[0] ?? 1);
  const d = step > 0 ? Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 0;
  return ticks.map((t) => fmt(t, d));
};

/**
 * European dates on every uPlot time chart (ticks 15.1. and 14:00, legend 15.01.2024 14:00), not uPlot's US default
 * (1/15, 2pm), with month names in the page's language. The clock is the browser's (uPlot's default): the time stamps
 * are UTC (`period.ts` reads them with `Z`), shown in the viewer's zone with its summer time. A chart's own x axis
 * values, legend value or `fmtDate` win; a chart whose x is not time (`scales.x.time: false`) is left as it is.
 */
export function europeanTime(o: uPlot.Options): uPlot.Options {
  if (o.scales?.x?.time === false) return o;
  const [xAxis = {}, ...given] = o.axes ?? [{}, {}];
  const yAxes = given.map((a) => ({ values: germanTicks, ...a })); // a chart's own values win
  const [xSeries = {}, ...lines] = o.series;
  const names = LANG === "de" ? NAMES_DE : undefined;
  return {
    fmtDate: (tpl) => uPlot.fmtDate(tpl, names),
    ...o,
    axes: [{ values: STAMPS, ...xAxis }, ...yAxes],
    series: [{ value: "{DD}.{MM}.{YYYY} {HH}:{mm}", ...xSeries }, ...lines],
  };
}

/**
 * Builds a uPlot chart in the returned `el` div, sized to its width and resized with it, and destroys it on
 * unmount. `make` gets the width and returns the options and data (null: no chart yet); the chart is rebuilt
 * when `deps` change and on a theme or palette change (canvas colours are read once). `plot` is the live chart.
 */
export function useUplot(make: (width: number) => { opts: uPlot.Options; data: uPlot.AlignedData } | null, deps: DependencyList) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const themeKey = useThemeKey();

  useEffect(() => {
    const node = el.current; // captured: the ref is already null when a late resize callback runs after unmount
    const made = node && make(node.clientWidth);
    if (!node || !made) return;
    // the app is scaled to the window (main.tsx, CSS zoom): uPlot reads the pointer in screen px, places its cursor in CSS px
    const unzoom = (_: uPlot, left: number, top: number): [number, number] => {
      const z = Number(document.documentElement.style.zoom) || 1;
      return [left / z, top / z];
    };
    const u = new uPlot(europeanTime({ ...made.opts, cursor: { move: unzoom, ...made.opts.cursor } }), made.data, node);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: node.clientWidth, height: u.height }));
    ro.observe(node);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- not `make`: it is new every render, `deps` list what it reads
  }, [...deps, themeKey]);

  return { el, plot };
}

/** Time-series lines over shared hourly timestamps (seconds since epoch); `time` false: xs are plain numbers (e.g. steps). */
export default function LineChart({ xs, lines, height = 240, unit = "kW", time = true }: { xs: number[]; lines: Line[]; height?: number; unit?: string; time?: boolean }) {
  const { el } = useUplot(
    (width) =>
      xs.length
        ? {
            opts: {
              width,
              height,
              scales: { x: { time } },
              axes: [themedAxis(), themedAxis({ label: unit, size: 56 })],
              series: [
                time ? {} : { label: "Step" },
                ...lines.map((l) => ({
                  label: l.label,
                  stroke: l.color,
                  width: 1.5,
                  fill: l.fill ? l.color + "22" : undefined,
                  value: (_: uPlot, v: number | null) => (v == null ? "–" : `${fmt(v, 1)} ${unit}`),
                })),
              ],
            },
            data: [xs, ...lines.map((l) => l.values)],
          }
        : null,
    [xs, lines, height, unit, time],
  );
  return <div ref={el} />;
}
