/**
 * The Site panel's steps: what to do first. ① Data center (its building, the heat source) → ② District (the heat
 * sinks) → ③ Heat distribution (the pipe network, which needs the buildings) → the Quick analysis as the result. A
 * step is done (a tick), the current one (the first not done: highlighted, one line says what to do) or still to do;
 * a click on a step shows its card under the steps, alone (SitePage; a second click hides it): the open one stands out.
 */
import type { Site } from "../../api";
import { useSnapshotDetail } from "../../lib/live";
import { InfoMark } from "../../ui/InfoMark";

/** The panel's cards, in the order of the steps (SitePage's `site-card-<kind>` keys). */
export type StepKind = "source" | "sink" | "network" | "quick";
export type StepState = "done" | "current" | "todo";

const STEPS: { kind: StepKind; name: string; todo: string }[] = [
  { kind: "source", name: "Data center", todo: "Pick the data center: “Pick a building” in ① Data center, then click its building on the map." },
  {
    kind: "sink",
    name: "District",
    todo: "Add the heat sinks in ② District: “+ Buildings” and click them on the map, “+ Area (district)”, or “Load heat demand in view” and add the Wärmeatlas buildings.",
  },
  { kind: "network", name: "Heat distribution", todo: "Plan the pipes: “Plan the heat network” in ③ Heat distribution." },
  {
    kind: "quick",
    name: "Quick analysis",
    todo: "The Quick analysis says what the heat gives the district over a year; “Costs and assumptions…” in ③ what the network costs and earns.",
  },
];

/** Each step's state from what the site has (a network planned: HeatNetwork's onPlanned). The first one not done is
 * the current one, the Quick analysis (never done: the result) once the three are; none before the site has loaded. */
export function stepsOf(site: Site | null, planned: boolean) {
  const done: Record<StepKind, boolean> = { source: !!(site?.source || site?.building), sink: !!site?.sinks.length, network: planned, quick: false };
  const current = site ? STEPS.find((s) => !done[s.kind])!.kind : null;
  return STEPS.map((s, i) => ({ ...s, n: i + 1, state: (done[s.kind] ? "done" : s.kind === current ? "current" : "todo") as StepState }));
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export default function SiteSteps({
  site,
  planned,
  open,
  onOpen,
}: {
  site: Site | null;
  planned: boolean;
  open: Record<StepKind, boolean>;
  onOpen: (kind: StepKind) => void;
}) {
  const steps = stepsOf(site, planned);
  const now = steps.find((s) => s.state === "current");
  useSnapshotDetail(() => ({
    site_steps: steps.map((s) => ({ step: s.kind === "quick" ? "result" : s.n, name: s.name, state: s.state })),
    next_step: now?.todo ?? null,
  }));
  return (
    <nav className="site__steps" aria-label="Site steps">
      <ol>
        {steps.map((s) => (
          <li key={s.kind} className={`site__step site__step--${s.state} site__tone--${s.kind}${open[s.kind] ? " site__step--open" : ""}`}>
            <button
              type="button"
              onClick={() => onOpen(s.kind)}
              aria-current={s.state === "current" ? "step" : undefined}
              aria-expanded={open[s.kind]}
              aria-label={`${s.kind === "quick" ? "Result" : `Step ${s.n}`}: ${s.name} (${s.state === "todo" ? "to do" : s.state})`}
              title={open[s.kind] ? `Hide ${s.name}` : s.state === "current" ? s.todo : `Open ${s.name}`}
            >
              <span className="site__step-dot" aria-hidden>
                {s.state === "done" ? (
                  <svg viewBox="0 0 16 16" width="13" height="13" {...ICON}>
                    <path className="site__tick" d="M3.5 8.5l3 3 6-7" pathLength={1} />
                  </svg>
                ) : s.kind === "quick" ? (
                  <svg viewBox="0 0 16 16" width="13" height="13" {...ICON}>
                    <path d="M3.5 13V9M8 13V3.5M12.5 13V6.5" />
                  </svg>
                ) : (
                  s.n
                )}
              </span>
              <span className="site__step-name">{s.name}</span>
            </button>
          </li>
        ))}
      </ol>
      {now && (
        <span className="site__step-q">
          <InfoMark term="the next step" mark="?" hover text={`${now.kind === "quick" ? "Done" : `Step ${now.n}`}: ${now.todo}`} />
        </span>
      )}
    </nav>
  );
}
