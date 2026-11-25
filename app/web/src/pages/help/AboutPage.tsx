/**
 * Help > "What is this?": what the app is for, in plain language for energy engineers and planners
 * (no machine-learning background needed): the problem, the digital twin, the three sections, the data, privacy.
 */
import { useEffect, useState } from "react";
import { fetchDatasets } from "../../api";
import { hrefOf, TABS } from "../../app/routes";
import { configOf } from "../../dataset";
import { MaskIcon } from "../../ui/MaskIcon";
import { DocsCard } from "./DocsCard";
import { HeatFlowSketch } from "./HeatFlowSketch";
import "./help.css";

/** What each section tab is about, in the order the heat flows (data center first). */
const SECTIONS: { id: string; text: string }[] = [
  {
    id: "dc",
    text: "The source. A dashboard of its measurements (how much data, statistics, correlations and KPIs such as PUE), its physical structure (the P&ID with its instruments and the causal links between them), the AI models learned from its measurements, and scenarios that change it.",
  },
  {
    id: "heat",
    text: "The link. The waste heat is taken at an extraction point in the data center, raised by a heat pump when it is not hot enough, buffered in a storage tank and delivered to the district network, hour by hour.",
  },
  {
    id: "district",
    text: "The demand. The buildings and areas on the map that take heat, and how much heat they need each hour, from the number of houses, the weather and daily habits.",
  },
];

const DATA_CENTERS: [string, string][] = [
  ["Simulations", "Simulated data centers with hourly data and known behaviour: the best place to learn the app. “Simulation 1 · with heat exchangers” also has two heat-recovery points."],
  ["MiniDC testbed", "A small experimental data center. Each experiment is one measured run; the Demonstrator is based on experiment 1."],
];

export default function AboutPage() {
  // Real data centers are machine-local: named from this computer's dataset list, never from text in the repository.
  const [real, setReal] = useState<string[]>([]);
  useEffect(() => {
    fetchDatasets()
      .then((r) => setReal(r.datasets.filter((d) => configOf(d).kind === "real").map((d) => configOf(d).name ?? d.name)))
      .catch(() => undefined);
  }, []);
  const dataCenters = real.length ? [...DATA_CENTERS, ["Real data centers", `Measured data of real sites, kept on this computer only: ${real.join(", ")}.`]] : DATA_CENTERS;
  return (
    <div className="page help">
      <header className="help__hero">
        <h1 className="page__title help__title">What is this?</h1>
        <p className="help__lead">
          The Intelligent Digital Twin is a planning tool of the DC2HEAT project. It shows how much of a data center's waste heat could heat a district, and how changes inside the data
          center would change that heat.
        </p>
      </header>

      <div className="help__grid help__grid--2">
        <section className="card card--lg">
          <h2 className="help__h2">The problem</h2>
          <p>
            A data center turns almost all the electricity it uses into heat. Today most of that heat is blown into the air by chillers and cooling towers, while the town next door
            burns fuel to heat its houses.
          </p>
          <p>
            District heating can carry the waste heat to the houses, but the heat is only lukewarm, it comes when the servers work and not when the houses need it, and every data
            center is built differently. Before anyone builds a connection, planners need to know: how much heat is there, how hot, when, and how much of the demand would it cover?
          </p>
        </section>
        <section className="card card--lg">
          <h2 className="help__h2">The digital twin</h2>
          <p>
            A digital twin is a model of the real data center that you can ask “what if?”. This one is learned from the data center's own measurements (temperatures, power,
            setpoints, weather) together with what is known about its physics.
          </p>
          <p>
            It is a causal model: it knows which quantity drives which, and how many hours later. For example, the IT load drives the power use, which drives the heat at the
            condenser. Change a cause, such as a cooling setpoint, and you see the effects follow hour by hour. You can look at every link and equation, and change them.
          </p>
        </section>
      </div>

      <section className="card card--lg">
        <h2 className="help__h2">How the heat gets to the houses</h2>
        <HeatFlowSketch />
        <p className="muted">The app follows this path. Each part has its own section in the top bar.</p>
      </section>

      <section aria-labelledby="sections-title">
        <h2 id="sections-title" className="help__h2">
          The three sections
        </h2>
        <div className="help__grid help__grid--3">
          {SECTIONS.map(({ id, text }) => {
            const tab = TABS.find((t) => t.id === id)!;
            return (
              <div key={id} className="card card--lg help-section">
                <h3 className="help-section__title">
                  <MaskIcon src={tab.icon} className="help-section__icon" />
                  {tab.label}
                </h3>
                <p>{text}</p>
                <div className="help-section__links">
                  {tab.subs.map((s) => (
                    <a key={s.id} className="btn btn--pill" href={hrefOf(tab.id, s.id)}>
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="help__grid help__grid--2">
        <section className="card card--lg">
          <h2 className="help__h2">The data centers in the app</h2>
          <dl className="help__dl">
            {dataCenters.map(([name, text]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">Choose one in the menu at the top right. The whole app then works on it.</p>
        </section>
        <section className="card card--lg">
          <h2 className="help__h2">Your data stays here</h2>
          <p>
            The app runs on this computer: its server, the measurements and the trained models all stay on this machine. The data of the real data centers is never sent anywhere
            and is not part of the code repository.
          </p>
          <p>
            What does go over the network: the Site map's tiles and look-ups (map tiles from OpenStreetMap, dark map and satellite images from Esri, address search from Nominatim,
            buildings from Overpass), the typeface from Google Fonts, and the TabPFN model weights, which the tabpfn package may download once, the first time a TabPFN model is
            trained. No measurements are sent.
          </p>
          <p>
            A saved project file (Save project) contains the trained models, and a TabPFN model includes a sample of the training measurements (up to 1000 rows per variable).
            Treat project files of real data centers as confidential.
          </p>
          <p>
            New here? Read <a href={hrefOf("help", "guide")}>How to use</a> for a step-by-step walkthrough.
          </p>
        </section>
      </div>

      <DocsCard />
    </div>
  );
}
