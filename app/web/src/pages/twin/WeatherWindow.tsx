/**
 * Heat Matching's weather window (a click on the weather band, or Weather… under What if…): the outdoor temperature
 * every part runs on, from the data, from another dataset, generated from three numbers or read from a file, and
 * shifted. The data center's Model takes it too (useExternalInputs drivers), so each part reacts to it.
 */
import { useState } from "react";
import { datasetOf, DATASET } from "../../dataset";
import { fmt } from "../../lib/format";
import { generateWeather, parseWeatherCsv } from "../../lib/weatherGen";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import type { useExternalInputs } from "../heat/useExternalInputs";

type Source = "data" | "generated" | "file";
const SOURCES: { id: Source; label: string }[] = [
  { id: "data", label: "From a system" },
  { id: "generated", label: "Generated" },
  { id: "file", label: "From a file" },
];

export function WeatherWindow({
  ext,
  dT,
  setDT,
  onClose,
}: {
  ext: ReturnType<typeof useExternalInputs>;
  dT: number;
  setDT: (v: number) => void;
  onClose: () => void;
}) {
  const custom = ext.custom;
  const [source, setSource] = useState<Source>(custom ? (custom.label.startsWith("file") ? "file" : "generated") : "data");
  // the case's three systems first (the data center's own weather: ""), then any other dataset with a weather
  const systems = [
    { label: "Data center", id: "" },
    { label: "Heat distribution", id: datasetOf("heat/dashboard") },
    { label: "District", id: datasetOf("district/dashboard") },
  ].map((x) => ({ ...x, id: x.id === DATASET ? "" : x.id }));
  const ofSystem = (id: string) => !id || ext.options.weather.some((o) => o.id === id); // its data has a weather column
  const others = ext.options.weather.filter((o) => !systems.some((x) => x.id === o.id));
  const nameOf = (id: string) => ext.options.weather.find((o) => o.id === id)?.name ?? id;
  const [gen, setGen] = useState({ mean: 10, season: 9, day: 4 });
  const [error, setError] = useState<string | null>(null);
  const times = ext.times ?? [];
  const values = ext.outTemp;
  const choose = (s: Source) => {
    setSource(s);
    setError(null);
    if (s === "data") ext.setCustom(null);
  };
  const generate = () => {
    ext.setWeatherFrom("");
    ext.setCustom({
      label: `generated: ${fmt(gen.mean, 1)} °C ± ${fmt(gen.season, 1)} K a year, ± ${fmt(gen.day, 1)} K a day`,
      values: generateWeather(times, gen.mean, gen.season, gen.day),
    });
  };
  const read = (file: File) =>
    file.text().then((text) => {
      const v = parseWeatherCsv(text, times.length);
      if (!v) return setError("No temperatures in this file: one value per hour, the last number on each line.");
      setError(null);
      ext.setWeatherFrom("");
      ext.setCustom({ label: `file: ${file.name}`, values: v });
    });
  const stats = values?.length ? { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, x) => a + x, 0) / values.length } : null;
  return (
    <Dialog label="Weather" onClose={onClose} className="weather-window">
      <h2>Weather</h2>
      <p className="muted">The outdoor temperature every part runs on: the district's demand, the data center's calculation and its Model.</p>
      <Segmented<Source> label="Weather source" value={source} onChange={choose} options={SOURCES} />
      {source === "data" && (
        <Field label="Weather from">
          <select className="field field--sm" value={ext.weatherFrom} onChange={(e) => ext.setWeatherFrom(e.target.value)}>
            <optgroup label="The case's systems">
              {systems.map((x) => (
                <option key={x.label} value={x.id} disabled={!ofSystem(x.id)}>
                  {x.label}
                  {x.id ? ` · ${nameOf(x.id)}` : x.label === "Data center" ? " · its own" : " · the same data as the data center"}
                  {ofSystem(x.id) ? "" : " (no weather in its data)"}
                </option>
              ))}
            </optgroup>
            {others.length > 0 && (
              <optgroup label="Other datasets">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.column}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      )}
      {source === "generated" && (
        <div className="weather-window__gen">
          <Field label="Mean, °C">
            <input className="field field--sm" type="number" step={0.5} value={gen.mean} onChange={(e) => setGen({ ...gen, mean: Number(e.target.value) })} />
          </Field>
          <Field label="Over the year, ± K">
            <input
              className="field field--sm"
              type="number"
              step={0.5}
              min={0}
              value={gen.season}
              onChange={(e) => setGen({ ...gen, season: Number(e.target.value) })}
            />
          </Field>
          <Field label="Over the day, ± K">
            <input
              className="field field--sm"
              type="number"
              step={0.5}
              min={0}
              value={gen.day}
              onChange={(e) => setGen({ ...gen, day: Number(e.target.value) })}
            />
          </Field>
          <button type="button" className="btn btn--primary" onClick={generate} disabled={!times.length}>
            Use it
          </button>
        </div>
      )}
      {source === "file" && (
        <label className="weather-window__file">
          <span>A CSV with one temperature (°C) per hour from the period's start: the last number on each line counts.</span>
          <input type="file" accept=".csv,.txt" aria-label="Weather file" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
        </label>
      )}
      {error && <p className="weather-window__error">{error}</p>}
      <label className="twin-whatif__weather">
        <span className="caps">Shifted</span>
        <input type="range" min={-10} max={10} step={1} value={dT} onChange={(e) => setDT(Number(e.target.value))} aria-label="Outdoor temperature shift, °C" />
        <span className="heat-meta">
          {dT > 0 ? "+" : ""}
          {dT} °C
        </span>
      </label>
      <p className="muted weather-window__now">
        Now:{" "}
        {custom
          ? custom.label
          : ext.weatherFrom
            ? `from ${ext.options.weather.find((o) => o.id === ext.weatherFrom)?.name ?? ext.weatherFrom}`
            : "the data center's own"}
        {stats && ` · ${fmt(stats.min + dT, 1)} … ${fmt(stats.max + dT, 1)} °C, mean ${fmt(stats.mean + dT, 1)} °C`}
      </p>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
