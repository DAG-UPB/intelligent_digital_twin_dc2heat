/**
 * Modelling › Profile: the variables made by a profile (moved to the Profile column in Variables), each with its
 * generator (shared/ProfileGenerator: a total over a period, shaped by the clock and the weather), e.g. one without
 * data such as the number of units or a demand known only by its yearly total. The district's can also start from
 * a heat sink of its site map (a building with its annual demand, e.g. from the Wärmeatlas), when the user picks it;
 * a building handed over from the Site map (lib/buildingHandoff.ts) is shown first, with the way back. Each profile is
 * kept in this browser per data center and structure; the models and the twin do not use them yet. Each is folded
 * until clicked: a generator is only built while it is open.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchSite, type StructureScope } from "../../../api";
import { DATASET } from "../../../dataset";
import { dropBuilding, peekBuilding, type HandedBuilding } from "../../../lib/buildingHandoff";
import { demandEntries } from "../../../lib/demand";
import { AALBORG_RESIDENTIAL, sinkPreset, sinkPresets, type ProfilePreset } from "../../../lib/profilePresets";
import ProfileGenerator from "../shared/ProfileGenerator";

/** One variable's profile, folded: its generator mounts when opened. */
function Folded({ name, children }: { name: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="profiles__one" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{name}</summary>
      {open && children}
    </details>
  );
}

/** The district's heat sinks (site.json) as presets (none elsewhere). */
function useSinkPresets(scope: StructureScope) {
  const [got, setGot] = useState<ProfilePreset[] | null>(scope === "district" ? null : []);
  useEffect(() => {
    if (scope !== "district") return;
    let live = true;
    fetchSite(DATASET)
      .then((site) => sinkPresets(demandEntries(site)))
      .catch(() => [])
      .then((presets) => live && setGot(presets));
    return () => {
      live = false;
    };
  }, [scope]);
  return got;
}

/** `demand`: the district's heat-demand variable, which starts residential (the rest constant); a building of the
 * site map is chosen by the user, never applied by itself. */
export function ProfilesCard({ variables, scope, demand }: { variables: string[]; scope: StructureScope; demand?: string }) {
  const key = `profiles:${DATASET}:${scope}`;
  const sinks = useSinkPresets(scope);
  const [building, setBuilding] = useState<HandedBuilding | null>(() => (scope === "district" ? peekBuilding() : null));
  const done = () => {
    dropBuilding();
    setBuilding(null);
  };
  const here = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (building) here.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [building]);
  return (
    <div className="profiles" ref={here}>
      {building && (
        <div className="profiles__building">
          <div className="profiles__building-head">
            <a className="btn btn--sm" href="#/twin/map" onClick={dropBuilding}>
              ← Back to the site map
            </a>
            <span className="muted">From the site map, for a look: its profile is kept with the building, not given to a variable.</span>
            <button type="button" className="btn btn--sm btn--ghost" onClick={done}>
              Close
            </button>
          </div>
          <ProfileGenerator
            storageKey={`${key}:building:${building.id}`}
            title={`${building.name} · building profile`}
            initial={`heat-demand:${building.id}`}
            presets={[sinkPreset(building)]}
            presetsLabel="This building"
          />
        </div>
      )}
      <p className="muted profiles__about">
        A total over a period, shaped by the clock and the weather, e.g. for a variable without data. Click a variable to open its profile. Kept in this browser
        for now: the models and the twin do not use it yet.
      </p>
      {scope === "district" && (
        <p className="muted profiles__about">
          A building's profile: on the Intelligent Digital Twin's Site map, add the building as a heat sink (Wärmeatlas buildings come with their annual demand)
          and press its ∿ button to see its profile here; or pick it under Start from, with its annual demand as the total.
        </p>
      )}
      {!variables.length && <p className="muted profiles__about">No variable is made by a profile: move one to Profile under Variables above.</p>}
      {/* a generator starts from its preset once: wait for the heat sinks, so they can be picked */}
      {sinks &&
        variables.map((v) => (
          <Folded
            key={v}
            name={
              <>
                {v} <span className="muted">· profile</span>
              </>
            }
          >
            <ProfileGenerator
              storageKey={`${key}:${v}`}
              title={`${v} · profile`}
              initial={v === demand ? AALBORG_RESIDENTIAL : "constant"}
              presets={sinks}
              presetsLabel="Buildings and areas of the site map"
            />
          </Folded>
        ))}
    </div>
  );
}
