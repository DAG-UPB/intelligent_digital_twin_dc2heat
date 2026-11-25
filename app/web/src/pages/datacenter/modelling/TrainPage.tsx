/**
 * Modelling, under each structure (Structure and Modelling: #/dc/pid, #/heat/structure): each variable is made one way
 * (approaches.ts: data-driven, physical and semi-physical, profile), moved between them under Variables; train the
 * surrogate models (5 model kinds x 2 structures, saved under fixed names), edit the equations and the profiles, and
 * compare the models on the test period. The selected graph
 * file is drawn as a causal mini map on the left, like on Scenarios, with the structural equations, the connection
 * points and the KPI variables under it. Nothing is computed by itself: Train trains, Evaluate evaluates the saved
 * models (and stores the answer: the stored evaluation shows when the page opens). Under a structure (`link`,
 * PidPage) it models that structure: the data center's or the heat distribution's, its graph as drawn there.
 * The results come first; the modelling (the Variables card, its columns' settings) opens above them on "Model…", by
 * itself when there is nothing to show yet or while training. The variable picked (here, in the results table or on
 * the drawing above) shows its results and its equation; a column's settings show the results of its variables.
 * State lives in useTrainSetup / useEquations; each card renders one part.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useKept } from "../../../lib/kept";
import { DATASET, configOf, otherPartsPrepared } from "../../../dataset";
import { KINDS, STRUCTS, STRUCTURES } from "../../../lib/modelCatalog";
import { ErrorBanner } from "../../../ui/ErrorBanner";
import { CausalMiniMap } from "../shared/CausalMiniMap";
import { GraphSidebar } from "../shared/GraphSidebar";
import { fileMap } from "../shared/causalGraph";
import { useHexView } from "../shared/useHexView";
import { linksFromTargets, withDataColumns } from "../structure/links";
import { renameFor } from "../structure/bindSetup";
import { WEATHER } from "../../heat/ports";
import { peekBuilding } from "../../../lib/buildingHandoff";
import { approachesOf, choicesOf, kindIn, shownApproaches, readChosen, chosenKeyOf, type Approach } from "./approaches";
import { demandOf, leversOf, modelColumns } from "./inputs";
import { candidatesOf, rankVariables } from "./ranking";
import { PhysicsEquationsCard } from "./PhysicsEquationsCard";
import { KpiCard } from "./KpiCard";
import { PortsCard } from "./PortsCard";
import { ProfilesCard } from "./ProfilesCard";
import { ResultsCard } from "./ResultsCard";
import { RollingCard } from "./RollingCard";
import type { TrainingEstimate } from "./estimate";
import { SetpointEventCard } from "./SetpointEventCard";
import { StructuralEquationsCard } from "./StructuralEquationsCard";
import { TrainSettingsCard } from "./TrainSettingsCard";
import { useEquations } from "./useEquations";
import { useTrainSetup } from "./useTrainSetup";
import type { StructureLink } from "../structure/structureLink";
import { VariablesCard } from "./VariablesCard";
import { ApproachResults, PickedResults, type ResultsData } from "./VariableResults";
import { useSnapshotDetail } from "../../../lib/live";
import "./modelling.css";

// the data-driven column's models: every kind but the equations (the physical column's)
const DATA_KINDS = KINDS.map((k) => k.id).filter((k) => k !== "physics");
const WINDOW_KEY = "modelling-window-open"; // the modelling window above the results: "1" open, "0" closed

export default function TrainPage({ link }: { link: StructureLink }) {
  const s = useTrainSetup(link);
  const eq = useEquations(s.dataset?.id, link.scope);
  const [kinds, setKinds] = useKept<string[]>(`${link.scope}-train-kinds`, KINDS.map((k) => k.id));
  const [structures, setStructures] = useKept<string[]>(`${link.scope}-train-structures`, STRUCTS.map((st) => st.id));
  const { dataset, models, evalRes, graph } = s;
  const [picked, setPicked] = useKept<string | null>(`${link.scope}-train-picked`, null);
  /** A variable picked (on the map, in the columns or the results table): there, in the equations and on the drawing above. */
  const pick = (v: string) => {
    setPicked(v);
    link.onSelect?.(v);
  };
  // and the other way: a variable selected on the drawing above is picked here too (its results under Variables)
  useEffect(() => {
    if (link.selected) setPicked(link.selected);
  }, [link.selected, setPicked]);
  const view = useHexView(dataset); // the map shows the selected HEX's variables only, like Physical structure
  const map = useMemo(() => (graph ? fileMap(graph.targets, view?.hidden) : null), [graph, view]);
  const graphVars = useMemo(() => (graph ? linksFromTargets(graph.targets).vars : []), [graph]);
  const modelled = useMemo(() => modelColumns(dataset), [dataset]);
  // the data center's lists every data column too; the heat distribution and the district their graph's (they read
  // the data center's data, whose other columns are not theirs) and the weather's, which all three parts share
  const variables = useMemo(() => {
    const cols = dataset?.columns ?? [];
    if (link.scope === "dc") {
      const others = otherPartsPrepared(configOf(dataset ?? undefined), "dc"); // another part's prepared variables
      return withDataColumns(graphVars, cols.filter((c) => !others.has(c)));
    }
    const rename = renameFor(cols, configOf(dataset ?? undefined));
    return withDataColumns(
      graphVars,
      WEATHER.map((w) => rename[w.v] ?? w.v).filter((c) => cols.includes(c)),
    );
  }, [graphVars, dataset, link.scope]);
  const chosenKey = chosenKeyOf(DATASET, link.scope);
  const [chosen, setChosen] = useState(() => readChosen(chosenKey));
  const choose = (v: string, to: Approach | undefined) =>
    setChosen((c) => {
      const next = { ...c };
      if (to) next[v] = to;
      else delete next[v];
      try {
        localStorage.setItem(chosenKey, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  const columns = useMemo(() => dataset?.columns ?? [], [dataset]);
  const demand = demandOf(link.scope, dataset);
  const data = useMemo(
    () => ({ columns, modelled, inputs: s.inputs, used: s.used, chosen, scope: link.scope, demand }),
    [columns, modelled, s.inputs, s.used, chosen, link.scope, demand],
  );
  const choices = useMemo(() => Object.fromEntries(variables.map((v) => [v, choicesOf(kindIn(data, v))])), [variables, data]);
  const approach = useMemo(() => approachesOf(data, variables), [data, variables]);
  const { onApproach } = link;
  useEffect(() => onApproach?.(shownApproaches(data, variables)), [onApproach, data, variables]); // the structure above colours and filters by it
  /** Move a variable: a data column's "not modelled" is its Use (left out of the training), the rest its choice. */
  const put = (v: string, to: Approach) => {
    if (modelled.includes(v)) s.setUsed((u) => (to === "off" ? u.filter((x) => x !== v) : u.includes(v) ? u : [...u, v]));
    choose(v, to);
  };
  /** Select all: every variable to its first approach (an input from the data); None: every one not modelled. */
  const all = (on: boolean) =>
    variables.forEach((v) => {
      const to = on ? choices[v].find((a) => a !== "off") : choices[v].includes("off") ? "off" : undefined;
      if (to) put(v, to);
    });
  // what Train fits: the variables shown and not in Not modelled (a data column outside this structure's list is not its)
  const kept = useMemo(() => variables.filter((v) => approach[v] && approach[v] !== "off"), [variables, approach]);
  // the equations card shows and trains the physical column's equations only; an equation added there moves its variable
  // there, a removed one moves it back to its default
  const physical = {
    ...eq,
    rows: eq.rows.filter((r) => approach[r.target] === "physics"),
    setTarget: (id: number, t: string) => {
      eq.setTarget(id, t);
      put(t, "physics");
    },
    add: (t: string) => {
      if (!eq.rows.some((r) => r.target === t)) eq.add(t); // else its equation, kept while it was elsewhere, comes back
      put(t, "physics");
    },
    place: (t: string, expr: string) => {
      eq.place(t, expr);
      put(t, "physics");
    },
    remove: (id: number) => {
      const row = eq.rows.find((r) => r.id === id);
      eq.remove(id);
      if (row) choose(row.target, undefined);
    },
    // ponytail: an equation of a variable without data is kept but not trained (the backend fits data columns only)
    equations: () => Object.fromEntries(Object.entries(eq.equations()).filter(([t]) => approach[t] === "physics" && modelled.includes(t))),
  };
  const move = (v: string, to: Approach) => {
    if (to === "physics" && !eq.rows.some((r) => r.target === v)) eq.add(v); // a row to write it in
    put(v, to);
  };
  const addable = useMemo(() => (graph ? modelled.filter((c) => !graphVars.includes(c) && !view?.hidden.has(c)) : []), [graph, modelled, graphVars, view]);

  const toTrain = STRUCTURES.filter((x) => structures.includes(x.structure) && kinds.includes(x.kind));

  // how long Train would take, before it is clicked: asked again shortly after a setting changes
  const [estimate, setEstimate] = useState<TrainingEstimate | null>(null);
  const plan = JSON.stringify([dataset?.id, s.graphFile, s.maxLag, s.split, s.used, kept, toTrain.map((d) => d.name), s.needsSave]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      s.estimate(toTrain, physical.equations(), kept)
        .then((e) => live && setEstimate(e))
        .catch(() => live && setEstimate(null));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plan` stands for every input of the estimate
  }, [plan]);
  const levers = useMemo(() => leversOf(dataset), [dataset]);
  const stepSec = dataset?.resolution_seconds || 3600;
  const shown = useMemo(() => STRUCTURES.filter((d) => models[d.name]), [models]);
  const predicted = useMemo(() => [...new Set(shown.flatMap((d) => models[d.name].order))], [shown, models]);
  const ranking = useMemo(() => rankVariables(shown, models, evalRes, predicted), [shown, models, evalRes, predicted]);
  const events = evalRes?.events ?? [];
  const first = shown[0] && models[shown[0].name];
  // what the results of a variable and of a column read (their tables memo on its parts)
  const results: ResultsData | null = dataset && {
    dataset,
    scope: link.scope,
    shown,
    models,
    evalRes,
    evaluating: s.evaluating,
    checking: s.stored === null,
    onEvaluate: s.evaluateSaved,
  };

  // the modelling window: as left in this browser, open when nothing is shown without it (no saved models, none
  // evaluated nor stored), while training, or with a building handed over for its profile; it then stays open
  const handover = !!peekBuilding() && link.scope === "district";
  const [windowOpen, setWindowOpen] = useState(() => {
    try {
      return handover || localStorage.getItem(WINDOW_KEY) === "1";
    } catch {
      return handover;
    }
  });
  const nothing = s.stored !== null && !evalRes && !s.evaluating;
  useEffect(() => {
    if (nothing || s.busy) setWindowOpen(true);
  }, [nothing, s.busy]);
  const toggleWindow = () => {
    setWindowOpen(!windowOpen);
    try {
      localStorage.setItem(WINDOW_KEY, windowOpen ? "0" : "1");
    } catch {
      /* not remembered */
    }
  };
  // picked in the results table: its results card, above the table, comes into view
  const pickedBox = useRef<HTMLDivElement>(null);
  const pickInTable = (v: string) => {
    pick(v);
    requestAnimationFrame(() => pickedBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  // the Modelling under the structure, for the assistant (lib/live.ts): how each variable is made, what Train would
  // fit and how long, the saved models and, once evaluated, the best model per variable (nMAE on the test period)
  useSnapshotDetail(() => ({
    modelling: {
      scope: link.scope,
      graph_file: s.graphFile,
      approaches: Object.fromEntries(variables.map((v) => [v, approach[v] ?? "calculated"])),
      // the Variables card, Train, the equations and the profiles sit in the modelling window above the results
      modelling_window: windowOpen ? "open" : 'closed: click "Model…" to open it',
      approach_choices: 'in the modelling window: fill the select "Approach of <variable>" (data, physics, profile, off) or drag; Select all / None',
      train: {
        kinds,
        structures,
        models_to_train: toTrain.map((d) => d.name),
        max_lag: s.maxLag,
        split: s.split,
        variables_fitted: kept.length,
        estimate_s: estimate
          ? { about: Math.round(estimate.seconds), low: Math.round(estimate.low), high: Math.round(estimate.high), problems: estimate.problems }
          : null,
        busy: s.busy,
        needs_save_first: s.needsSave,
      },
      equations: physical.rows.map((r) => ({ target: r.target, expr: r.expr })),
      saved_models: shown.map((d) => d.name),
      evaluating: s.evaluating,
      evaluated: !!evalRes,
      // loaded: the stored evaluation (models/evaluation.json) shown as the page opened; saved: evaluated now and
      // stored; none: no stored one fits the saved models (Evaluate on the test period)
      stored_evaluation: s.stored,
      // the variable picked and its results (its card above the results table), every saved model of it, the best first
      picked: picked
        ? {
            variable: picked,
            approach: picked in approach ? (approach[picked] ?? "calculated") : null,
            input: s.inputs.includes(picked),
            models: candidatesOf(shown, models, evalRes, picked).map((c) => ({
              model: c.def.name,
              free_r2: c.r2,
              free_mae: c.mae,
              free_wape: c.wape,
              free_mase: c.mase,
              free_nmae: c.free,
              one_step_nmae: c.one,
            })),
          }
        : null,
      best_per_variable: evalRes
        ? Object.fromEntries(
            Object.entries(ranking).map(([v, rk]) => [
              v,
              rk.winner ? { model: rk.winner.def.name, free_nmae: rk.winner.free, one_step_nmae: rk.winner.one } : null,
            ]),
          )
        : null,
    },
  }));

  const rolling = dataset && Object.keys(models).length > 0 && <RollingCard dataset={dataset.id} scope={link.scope} models={models} />;
  return (
    <div className="train">
      <div className="train-layout">
        {/* the side column, scrolling on its own: the graph, the equations (picked here or in the results), the
            connection points, the KPI variables (folded) */}
        <GraphSidebar title={<>Causal graph · {s.graphFile ?? "…"}</>}>
          <CausalMiniMap
            graph={map}
            config={view?.config ?? null}
            selected={picked}
            onSelect={pick}
            hint="Click a variable for its results and its equation."
            empty="No causal graph loaded."
          />
          {first && evalRes && <StructuralEquationsCard predicted={predicted} ranking={ranking} models={models} evalRes={evalRes} selected={picked} />}
          {/* what this part delivers to the twin: under the graph, closed with it */}
          {dataset && (
            <PortsCard scope={link.scope} dataset={dataset} variables={variables} approach={approach} inputs={s.inputs} demand={demand} onPick={pick} />
          )}
          {/* the data center's KPI variables, set while building it: PUE, ERF and ERE are computed from them */}
          {dataset && link.scope === "dc" && <KpiCard dataset={dataset} />}
        </GraphSidebar>
        <div className="page">
          {/* the modelling window's button and where the results stand: evaluated, stored, being evaluated */}
          <div className="card train-bar">
            <button
              type="button"
              className={`btn btn--sm${windowOpen ? "" : " btn--primary"}`}
              aria-expanded={windowOpen}
              aria-controls="train-window"
              onClick={toggleWindow}
            >
              Model…{" "}
              <span className="train-bar__chevron" aria-hidden="true">
                {windowOpen ? "▴" : "▾"}
              </span>
            </button>
            <span className="muted train-bar__about">how each variable is made, Train, the equations, the profiles</span>
            <span className="train-bar__status">
              {s.evaluating > 0 ? (
                <span role="status" className="train-progress">
                  <span className="train-spinner" aria-hidden="true" />
                  Evaluating {s.evaluating} model{s.evaluating === 1 ? "" : "s"} on the test period… TabPFN can take about a minute the first time.
                </span>
              ) : shown.length > 0 && evalRes ? (
                // loaded when the page opened, or evaluated here (and stored): either way the bar says where they stand
                <>
                  {s.stored === "loaded"
                    ? `The stored evaluation of the ${shown.length} saved model${shown.length === 1 ? "" : "s"} (unchanged since).`
                    : `Evaluated on the test period: the ${shown.length} saved model${shown.length === 1 ? "" : "s"}.`}
                  <button type="button" className="btn btn--sm" onClick={s.evaluateSaved}>
                    Evaluate again
                  </button>
                </>
              ) : shown.length > 0 && !evalRes && s.stored !== null ? (
                <>
                  {shown.length} saved model{shown.length === 1 ? "" : "s"}, not evaluated yet.
                  <button type="button" className="btn btn--primary btn--sm" onClick={s.evaluateSaved}>
                    Evaluate on the test period
                  </button>
                </>
              ) : (
                !shown.length && s.stored !== null && !s.busy && <span className="muted">No saved models yet: train them in the modelling window.</span>
              )}
            </span>
          </div>
          {/* the modelling window, above the results: hidden, not unmounted, so the open column stays open */}
          <div id="train-window" className="train-window" hidden={!windowOpen}>
            {/* how each variable is made, each column's settings under the columns */}
            {dataset && (
              <VariablesCard
                variables={variables}
                columns={dataset.columns}
                modelled={modelled}
                inputs={s.inputs}
                approach={approach}
                choices={choices}
                onMove={move}
                onAll={all}
                addable={addable}
                onAdd={s.addVariable}
                selected={picked}
                onPick={pick}
                onShow={(v) => {
                  pick(v);
                  document.querySelector(".pid-page")?.scrollIntoView({ block: "start", behavior: "smooth" }); // up to the drawing, where it is selected
                }}
                initialOpen={handover ? "profile" : null}
                panels={{
                  data: {
                    label: "Train the models",
                    node: (
                      <>
                        <TrainSettingsCard
                          dataset={dataset}
                          kinds={kinds}
                          onKinds={setKinds}
                          structures={structures}
                          onStructures={setStructures}
                          graphFiles={s.graphFiles}
                          graphFile={s.graphFile ?? ""}
                          onGraphFile={s.setGraphFile}
                          maxLag={s.maxLag}
                          onMaxLag={s.setMaxLag}
                          split={s.split}
                          onSplit={s.setSplit}
                          count={toTrain.length}
                          estimate={estimate}
                          busy={s.busy}
                          onTrain={() => s.train(toTrain, physical.equations(), kept)}
                        />
                        {results && (
                          <ApproachResults
                            r={results}
                            column="Data-driven"
                            title="Results · best data-driven model per variable"
                            variables={variables.filter((v) => approach[v] === "data" && !s.inputs.includes(v))}
                            kinds={DATA_KINDS}
                            onPick={pick}
                          />
                        )}
                      </>
                    ),
                  },
                  physics: {
                    label: "Equations",
                    node: (
                      <>
                        <PhysicsEquationsCard
                          columns={modelled}
                          inputs={s.inputs}
                          levers={levers}
                          stepSec={stepSec}
                          eq={physical}
                          library={link.library}
                          trained={kinds.includes("physics")}
                        />
                        {results && (
                          <ApproachResults
                            r={results}
                            column="Physical"
                            title="Results · the physics model per variable"
                            variables={variables.filter((v) => approach[v] === "physics")}
                            kinds={["physics"]}
                            onPick={pick}
                          />
                        )}
                      </>
                    ),
                  },
                  profile: {
                    label: "Profiles",
                    node: <ProfilesCard variables={variables.filter((v) => approach[v] === "profile")} scope={link.scope} demand={demand} />,
                  },
                }}
              />
            )}
            {s.needsSave && (
              <p role="status" className="card train-progress">
                Save the structure above first: the models are trained on its saved graph.
              </p>
            )}
          </div>
          <ErrorBanner error={s.error} />
          {/* the results of the variable picked, first */}
          {results && picked && (
            <div ref={pickedBox}>
              <PickedResults r={results} variable={picked} approach={approach[picked]} input={s.inputs.includes(picked)} modelled={modelled} />
            </div>
          )}
          {/* the results table, the saved models rolled over the last year and the setpoint events after it */}
          <div className={`train-results${s.evaluating ? " train-results--stale" : ""}`} aria-busy={s.evaluating > 0}>
            {first && evalRes && (
              <ResultsCard
                predicted={predicted}
                ranking={ranking}
                levers={levers}
                eventCount={events.length}
                stepSec={stepSec}
                splitTime={first.split_time}
                drivers={first.drivers}
                window_={s.window_}
                onWindow={s.changeWindow}
                dataset={dataset}
                scope={link.scope}
                models={models}
                evalRes={evalRes}
                picked={picked}
                onPick={pickInTable}
              />
            )}
            {rolling}
            {first && evalRes && events.length > 0 && <SetpointEventCard events={events} predicted={predicted} ranking={ranking} />}
          </div>
        </div>
      </div>
    </div>
  );
}
