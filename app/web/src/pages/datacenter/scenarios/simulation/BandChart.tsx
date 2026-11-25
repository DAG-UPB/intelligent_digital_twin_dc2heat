/** One variable of a Monte Carlo run (uPlot): actual in grey, baseline (blue) and scenario (red) as p05-p95 bands with the median. */
import type uPlot from "uplot";
import type { Band, SimulateResponse } from "../../../../api";
import { themedAxis, useUplot } from "../../../../ui/LineChart";

const BLUE = "#3b82f6";
const RED = "#ef4444";
const HEIGHT = 220;

export function BandChart({ res, column }: { res: SimulateResponse; column: string }) {
  const { el } = useUplot(
    (width) => {
      const data: number[][] = [res.time.map((t) => new Date(t).getTime() / 1000), res.actual[column]];
      const series: uPlot.Series[] = [{}, { label: "Actual", stroke: "#9ca3af", width: 1 }];
      const bands: uPlot.Band[] = [];
      const addBand = (b: Band, name: string, color: string) => {
        const i = data.length;
        data.push(b.p95, b.p05, b.p50);
        series.push(
          { label: `${name} 95%`, stroke: "transparent", points: { show: false } },
          { label: `${name} 5%`, stroke: "transparent", points: { show: false } },
          { label: `${name} median`, stroke: color, width: 1.5 },
        );
        bands.push({ series: [i, i + 1], fill: color + "26" });
      };
      const baseline = res.baseline?.[column] as Band | undefined;
      if (baseline) addBand(baseline, "Baseline", BLUE);
      addBand(res.scenario[column] as Band, "Scenario", RED);
      return {
        opts: { width, height: HEIGHT, series, bands, legend: { show: true }, scales: { x: { time: true } }, axes: [themedAxis(), themedAxis()] },
        data: data as uPlot.AlignedData,
      };
    },
    [res, column],
  );
  return <div ref={el} />;
}
