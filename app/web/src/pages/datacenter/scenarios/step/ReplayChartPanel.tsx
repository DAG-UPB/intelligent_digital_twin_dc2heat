/** One chart card per selected signal, with a PREDICTION badge while a what-if overlay is shown for it. */
import type { TimeSeriesResponse } from "../../../../api";
import { ErrorBoundary } from "../../../../ui/ErrorBoundary";
import { TimeSeriesChart } from "./TimeSeriesChart";
import type { PredictionOverlay } from "./whatIf";

interface Props {
  selectedColumns: string[];
  timestamps: number[];
  data: TimeSeriesResponse;
  playheadIndex: number;
  windowSize: number;
  predictionOverlays: Record<string, PredictionOverlay>; // empty when no what-if is active
}

export function ReplayChartPanel({ selectedColumns, timestamps, data, playheadIndex, windowSize, predictionOverlays }: Props) {
  return (
    <ErrorBoundary title="The charts could not be shown.">
      <div className="charts">
        {selectedColumns.map((col) => (
          <section key={col} className="card chart-card" aria-label={col}>
            <div className="chart-card__head">
              {col}
              {predictionOverlays[col] && <span className="pill pill--warn pill--sm">PREDICTION</span>}
            </div>
            <div className="chart-card__body">
              <TimeSeriesChart
                timestamps={timestamps}
                label={col}
                values={data.columns[col]}
                playheadIndex={playheadIndex}
                windowSize={windowSize}
                height={200}
                prediction={predictionOverlays[col]}
              />
            </div>
          </section>
        ))}
      </div>
    </ErrorBoundary>
  );
}
