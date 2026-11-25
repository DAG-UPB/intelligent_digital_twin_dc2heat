import { expect, test } from "vitest";
import { translator } from "./i18n";
import DE from "./i18n.de";

const t = translator({
  "Heat sinks": "Wärmesenken",
  "Plan the heat network": "Wärmenetz planen",
  "of {0}": "von {0}",
  "{0} heat sinks not supplied": "{0} Wärmesenken nicht versorgt",
  "{0} kW at {1}": "{1}: {0} kW",
  "Data center": "Rechenzentrum",
  "{0} {1}": "never used: no fixed words",
  ": {0} points per variable ({1})": ": {0} Punkte je Variable ({1})",
  "each the mean of {0} rows": "jeweils der Mittelwert aus {0} Zeilen",
  Examples: "Beispiele",
  "air cooled": "luftgekühlt",
  "input": "Eingang",
  "no parents": "ohne Ursachen",
});

test("an exact text, its spaces around it kept", () => {
  expect(t("Heat sinks")).toBe("Wärmesenken");
  expect(t("  Plan the heat\n network ")).toBe("  Wärmenetz planen ");
});

test("a pattern takes the values, in the German order, each translated when it is an entry", () => {
  expect(t("of 150")).toBe("von 150");
  expect(t("12 heat sinks not supplied")).toBe("12 Wärmesenken nicht versorgt");
  expect(t("3.270 kW at Data center")).toBe("Rechenzentrum: 3.270 kW");
  expect(t(": 1456 points per variable (each the mean of 6 rows)")).toBe(": 1456 Punkte je Variable (jeweils der Mittelwert aus 6 Zeilen)");
});

test("a text put together at run time: its known pieces between the separators", () => {
  expect(t("Data center: Examples › Recovery · air cooled")).toBe("Rechenzentrum: Beispiele › Recovery · luftgekühlt");
  expect(t("Hour ← input (no parents)")).toBe("Hour ← Eingang (ohne Ursachen)");
  expect(t("Recovery · Hour")).toBeNull(); // no piece known
});

test("a slot may be empty; a value left in English prose rejects the pattern", () => {
  const u = translator({ "Train {0} model{1}": "Modelle trainieren ({0})", "{0} of {1}": "{0} von {1}", picture: "Bild" });
  expect(u("Train 1 model")).toBe("Modelle trainieren (1)");
  expect(u("3 of 150")).toBe("3 von 150");
  expect(u("Get the picture of a P&ID view")).toBeNull(); // English left English, not half German
});

test("a pattern before the pieces: a known value with a › in it stays whole; tr.whole takes no pieces", () => {
  const u = translator({ "Model: {0}.": "Modell: {0}.", "no model yet, under Heat › Modelling": "noch kein Modell, unter Wärme › Modellierung", Model: "Modell" });
  expect(u("Model: no model yet, under Heat › Modelling.")).toBe("Modell: noch kein Modell, unter Wärme › Modellierung.");
  expect(u("Model › Heat")).toBe("Modell › Heat"); // pieces: what is known
  expect(u.whole("Model › Heat")).toBeNull();
});

test("a value of three lowercase words left in English, or half translated, rejects the pattern", () => {
  const u = translator({ "{0} of the {1}": "{0} im {1}", day: "Tag", "Hour of the day (from the clock)": "Tageszeit (aus der Uhrzeit)", Hour: "Stunde" });
  expect(u("3 of the 12")).toBe("3 im 12");
  expect(u("mean absolute value of the variable")).toBeNull();
  expect(u("Hour · Hour of the day (from the clock)")).toBe("Stunde · Tageszeit (aus der Uhrzeit)"); // not "{0} im Tag (from the clock)"
  expect(u("(the cheapest of the scenarios)")).toBeNull(); // "(the": English after a bracket too
  expect(translator({ "{0} of {1}": "{0} von {1}" })("12 MWh/a of 30")).toBe("12 MWh/a von 30"); // a unit's "a" is no word
});

test("nothing known, or no words: null (it stays as it is)", () => {
  expect(t("ITE_Ener")).toBeNull();
  expect(t("3.270")).toBeNull();
  expect(t("a b")).toBeNull(); // "{0} {1}" is not a pattern
});

test("the app's dictionary: a station fed directly (no heat pump) reads in German too, not as COP 0", () => {
  const de = translator(DE);
  expect(de("direct, no heat pump · 100 % of the heat · peak boiler 50 kW")).toBe("direkt, ohne Wärmepumpe · 100 % der Wärme · Spitzenlastkessel 50 kW");
  expect(de("(hour by hour on a heating curve: 70 °C at -12 °C outside and below, 55 °C at 15 °C and above, Heat Matching's defaults; seasonal COP 4,0, the year's heat ÷ its electricity)")).toBe(
    "(Stunde für Stunde auf einer Heizkurve: 70 °C bei -12 °C Außentemperatur und darunter, 55 °C bei 15 °C und darüber, die Standardwerte des Wärmeabgleichs; Jahresarbeitszahl 4,0, die Wärme des Jahres ÷ ihren Strom)",
  );
  expect(de("(hour by hour on a heating curve: 70 °C at -12 °C outside and below, 55 °C at 15 °C and above, Heat Matching's defaults; direct, no heat pump)")).toContain("; direkt, ohne Wärmepumpe)");
});

test("the app's dictionary: Operation's note when the MPC ran heat-led reads in German (audit P7)", () => {
  const de = translator(DE);
  expect(de("MPC ran heat-led in As set above: its plan does not know the heat pump's time constant τ and cost more there (a slow heat pump, or a short look-ahead).")).toBe(
    "MPC lief wärmegeführt in Wie oben eingestellt: Sein Plan kennt die Zeitkonstante τ der Wärmepumpe nicht und war dort teurer (eine träge Wärmepumpe oder eine kurze Vorausschau).",
  );
});

test("the app's dictionary: the scenarios' note says the price rule often costs more than heat-led, in German (audit P11)", () => {
  const de = translator(DE);
  const note =
    "Empty fields take the value set above. Click a scenario (row or bars) for its months, years and hours below. −: cheaper (or less CO₂) than heat-led. The price rule is a simple rule: it charges in every cheap hour whatever the tank will need, so it often costs a little more than heat-led.";
  expect(de(note)).toMatch(/Die Preisregel ist eine einfache Regel: .* kostet daher oft etwas mehr als wärmegeführt\.$/);
});

test("the app's dictionary: no German left for the removed \"burned for this heat\" forest (audit 1b-1)", () => {
  expect(Object.keys(DE).filter((k) => /burned/i.test(k))).toEqual([]);
});
