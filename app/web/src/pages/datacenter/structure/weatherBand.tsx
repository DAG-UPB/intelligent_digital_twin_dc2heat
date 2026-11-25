/**
 * The weather, the same on every structure: the exogenous variables every part follows (outdoor temperature,
 * humidity, solar radiation: the minimal set that moves the three parts; wind is a second-order effect, left out) and
 * the hour of the day, to be loaded from the weather and the clock. They sit in the weather's box above the
 * neighbour's box (connection.ts weatherBox, drawn by ConnectionPoints.tsx WeatherBox), at the same slots as the
 * data center's own weather columns. A structure's setup adds WEATHER_DEFAULTS and WEATHER_NOTES to its own.
 */
import { weatherSpots } from "./connection";
import type { Pos } from "./layout";
import type { Notes } from "./notes";

// the heat distribution's and the district's: both have the weather above the box their heat comes in from, on the left
export const WEATHER_DEFAULTS: Pos = weatherSpots("heat", true, [
  ["T_outdoor", "TT"],
  ["humidity", "MT"],
  ["solar_radiation", "RT"],
  ["hour", "KI"],
]);

export const WEATHER_VARS = Object.keys(WEATHER_DEFAULTS);

/** None taps onto a part: they come from outside the plant. */
export const WEATHER_MEASURES: Record<string, null> = Object.fromEntries(WEATHER_VARS.map((v) => [v, null]));

export const WEATHER_NOTES: Notes = {
  T_outdoor: { kind: "weather", note: "Outdoor temperature (exogenous, from the weather)" },
  humidity: { kind: "weather", note: "Relative humidity (exogenous, from the weather)" },
  solar_radiation: { kind: "weather", note: "Solar radiation (exogenous, from the weather)" },
  hour: { kind: "time", note: "Hour of the day (exogenous, from the clock): daily habits and schedules" },
};
