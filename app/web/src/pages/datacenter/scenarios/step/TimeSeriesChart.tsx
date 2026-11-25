/**
 * One signal over time (uPlot) with a dashed red playhead line, the x-range following the playhead, and an
 * optional dashed what-if prediction; the signal in amber, Scenarios' colour (Historical draws it in the part's). Built once per data/prediction/window/theme; playhead moves only rescale.
 */
import { useEffect, useRef } from "react";
import type uPlot from "uplot";
import { themedAxis, useUplot } from "../../../../ui/LineChart";
import { alignPrediction, type PredictionOverlay } from "./whatIf";
import { viewRange } from "./windows";

interface Props {
  timestamps: number[]; // unix seconds
  label: string;
  values: (number | null)[]; // null: a gap
  playheadIndex: number;
  windowSize: number; // points visible
  height?: number;
  prediction?: PredictionOverlay;
}

export function TimeSeriesChart({ timestamps, label, values, playheadIndex, windowSize, height = 300, prediction }: Props) {
  // read by the draw hook and at creation: kept out of the creation deps so playing does not rebuild the chart
  const playhead = useRef(playheadIndex);
  useEffect(() => {
    playhead.current = playheadIndex; // declared first: runs before the effects below read it
  });

  const { el, plot } = useUplot(
    (width) => {
      if (timestamps.length === 0) return null;
      const data: (number | null)[][] = [timestamps, values];
      const series: uPlot.Series[] = [{}, { label, stroke: "#f59e0b", width: 1.5 }];
      if (prediction && prediction.timestamps.length > 0) {
        data.push(alignPrediction(timestamps, prediction));
        series.push({ label: "Prediction", stroke: "#475569", width: 2, dash: [6, 3] });
      }
      const [start, end] = viewRange(playhead.current, windowSize, timestamps.length);
      return {
        opts: {
          width,
          height,
          cursor: { drag: { x: true, y: false } },
          scales: { x: { min: timestamps[start], max: timestamps[end] } },
          axes: [themedAxis(), themedAxis({ size: 60 })],
          series,
          plugins: [{ hooks: { draw: [(u: uPlot) => drawPlayhead(u, timestamps[playhead.current])] } }],
        },
        data: data as uPlot.AlignedData,
      };
    },
    [timestamps, label, values, height, prediction, windowSize],
  );

  useEffect(() => {
    if (!plot.current || timestamps.length === 0) return;
    const [start, end] = viewRange(playheadIndex, windowSize, timestamps.length);
    plot.current.setScale("x", { min: timestamps[start], max: timestamps[end] }); // redraws, so the playhead line moves too
  }, [playheadIndex, windowSize, timestamps, plot]);

  return <div ref={el} />;
}

function drawPlayhead(u: uPlot, t: number | undefined) {
  if (t === undefined) return;
  const x = u.valToPos(t, "x", true);
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, u.bbox.top);
  ctx.lineTo(x, u.bbox.top + u.bbox.height);
  ctx.stroke();
  ctx.restore();
}
