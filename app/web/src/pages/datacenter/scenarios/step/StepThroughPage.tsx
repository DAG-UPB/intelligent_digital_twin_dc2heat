/**
 * Scenarios, level 1: replay a dataset's time series step by step (play, scrub, window size, one chart per signal)
 * and, while paused, run a what-if from the playhead with the 'linear' model, revealed one step at a time.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { StructureScope, TrainedModel } from "../../../../api";
import { DATASET, configOf } from "../../../../dataset";
import { durationLabel, stepHoursOf } from "../../../../lib/period";
import { ErrorBanner } from "../../../../ui/ErrorBanner";
import type { Picked } from "../../shared/focus";
import type { HexView } from "../../shared/useHexView";
import { rangeOf, type SeriesPeriod } from "../../dashboard/seriesPeriod";
import { RunKpis, useRunKpis } from "../RunKpis";
import { useScenarioModel } from "../useScenarioModel";
import { ColumnSelector } from "./ColumnSelector";
import { ReplayChartPanel } from "./ReplayChartPanel";
import { ReplayControls } from "./ReplayControls";
import { useDatasetSelection } from "./useDatasetSelection";
import { useReplayState } from "./useReplayState";
import { useWhatIf } from "./useWhatIf";
import { WhatIfPanel } from "./WhatIfPanel";
import { ALL, defaultWindow, windowsFor } from "./windows";

interface Props {
  picked: Picked | null;
  /** The app data center's 'linear' model (shared with the mini map and the test-period page) and its setter. */
  model: TrainedModel | null | undefined;
  onModel: (m: TrainedModel) => void;
  /** The selected HEX: signals and what-if variables of the app's data center show only its variables. */
  view: HexView | null;
  scope?: StructureScope; // whose structure's model: the data center's by default
  levers: string[]; // the intervention variables, picked on the page (WhatIfCard)
  side?: HTMLElement | null; // the panel on the left: the variables to plot go there
  period?: SeriesPeriod; // the page's year and month: a new one moves the replay to it
  periodPick?: ReactNode; // its pickers, over the variables to plot
  controls?: HTMLElement | null; // where the replay's buttons go: the band under the page's KPIs
}

export default function StepThroughPage({ picked, model, onModel, view, scope, levers, side, period, periodPick, controls }: Props) {
  const ds = useDatasetSelection(view?.hidden ?? null);
  const id = ds.selectedDataset?.id ?? null;
  // another dataset picked on this page brings its own model
  const [otherModel, setOtherModel] = useScenarioModel(id !== DATASET ? id : null, scope);
  const [whatIfModel, setWhatIfModel] = id === DATASET ? [model, onModel] : [otherModel, setOtherModel];

  const n = ds.timestamps.length;
  const windows = useMemo(() => windowsFor(stepHoursOf(ds.timestamps) * 3600, n), [ds.timestamps, n]);
  const [windowPick, setWindowPick] = useState<number | null>(null);
  const windowSize = windowPick ?? defaultWindow(windows);

  const replay = useReplayState(n);
  const derived = useMemo(() => (ds.selectedDataset ? configOf(ds.selectedDataset).derived : null), [ds.selectedDataset]);
  const kpi = useRunKpis(id, whatIfModel, derived, scope);
  const whatIf = useWhatIf(id, ds.selectedFile, replay.playheadIndex, whatIfModel, setWhatIfModel, ds.setError, scope, kpi.columns);

  // picked in the graph on the left: plotted too (and offered to the what-if, WhatIfPanel)
  useEffect(() => {
    // released (clicked again): taken back out
    if (picked && ds.columns.includes(picked.v) && ds.selectedColumns.includes(picked.v) === !!picked.off) ds.handleToggleColumn(picked.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new pick
  }, [picked]);

  const { seek } = replay;
  // a year or month picked (not the one on opening): the window shows it, the playhead in its middle
  const lastPeriod = useRef(period);
  useEffect(() => {
    if (!period || (lastPeriod.current?.year === period.year && lastPeriod.current?.month === period.month)) return;
    lastPeriod.current = period;
    const [from, to] = rangeOf(period);
    const i0 = ds.timestamps.findIndex((t) => t >= from);
    if (i0 < 0) return;
    const i1 = ds.timestamps.findIndex((t) => t >= to);
    const steps = (i1 < 0 ? n : i1) - i0;
    setWindowPick(period.year == null ? ALL : steps);
    seek(i0 + Math.floor(steps / 2));
  }, [period, ds.timestamps, n, seek]);
  // new data starts at its beginning
  useEffect(() => {
    seek(0);
  }, [ds.data, seek]);

  const plotPick = (
    <ColumnSelector
      head={periodPick}
      columns={ds.columns}
      selected={ds.selectedColumns}
      onToggle={ds.handleToggleColumn}
      onSelectAll={ds.handleSelectAll}
      onDeselectAll={ds.handleDeselectAll}
    />
  );

  // the replay's buttons and window: in the band under the page's KPIs (`controls`), else here
  const buttons = ds.data && n > 0 && (
    <div className="step__controls">
      <ReplayControls
        playheadIndex={replay.playheadIndex}
        totalPoints={n}
        isPlaying={replay.isPlaying}
        playbackSpeed={replay.playbackSpeed}
        currentTime={ds.data.time[replay.playheadIndex] ?? null}
        onSeek={replay.seek}
        onTogglePlay={replay.togglePlay}
        onCycleSpeed={replay.cycleSpeed}
      />
      <label className="step__row">
        <span className="caps">Window</span>
        <select className="field field--sm" value={windowSize} onChange={(e) => setWindowPick(Number(e.target.value))}>
          {windows.map((w) => (
            <option key={w.steps} value={w.steps}>
              {w.label}
            </option>
          ))}
          {windowSize !== ALL && !windows.some((w) => w.steps === windowSize) && (
            <option value={windowSize}>{durationLabel(windowSize * stepHoursOf(ds.timestamps) * 3600)}</option> // the picked period's
          )}
          <option value={ALL}>All</option>
        </select>
      </label>
    </div>
  );

  // as Historical's time series: the charts first (in the twin's colour), the what-if under them
  return (
    <div className="step">
      <div className="step__main">
        <ErrorBanner error={ds.error} />
        {ds.selectedDataset && (side ? createPortal(plotPick, side) : plotPick)}
        {buttons && (controls ? createPortal(buttons, controls) : buttons)}

        {ds.data && n > 0 && (
          <>
            <p className="muted dash__note">
              The replay: play or step with the buttons above, the window around the playhead; pause it to run a what-if from there (under the charts).
            </p>
            {ds.loading ? (
              <div className="step__empty">Loading data…</div>
            ) : ds.selectedColumns.length === 0 ? (
              <div className="step__empty">Pick the variables to plot{side ? " in the panel on the left" : " above"}</div>
            ) : (
              <ReplayChartPanel
                selectedColumns={ds.selectedColumns}
                timestamps={ds.timestamps}
                data={ds.data}
                playheadIndex={replay.playheadIndex}
                windowSize={windowSize}
                predictionOverlays={whatIf.predictionOverlays}
              />
            )}

            {!replay.isPlaying && ds.selectedDataset && (
              <WhatIfPanel
                columns={ds.columns}
                playheadIndex={replay.playheadIndex}
                totalPoints={n}
                model={whatIfModel}
                preparing={whatIf.preparing}
                onPrepare={whatIf.prepare}
                active={whatIf.active}
                loading={whatIf.loading}
                currentStep={whatIf.step}
                totalSteps={whatIf.totalSteps}
                onActivate={whatIf.activate}
                onDeactivate={whatIf.deactivate}
                onStep={whatIf.stepForward}
                chosen={levers}
                side={!!side}
              />
            )}
            {ds.selectedDataset && <RunKpis setup={kpi} res={whatIf.response} withLabel="Twin, your overrides" />}
          </>
        )}

        {!ds.data && !ds.loading && !ds.error && <div className="step__empty step__empty--grow">Loading the data…</div>}
      </div>
    </div>
  );
}
