/**
 * Profile generator (lib/profile.ts), in each structure's Modelling (a variable made by a profile): a total over a period, of any quantity (heat demand, a data
 * center's waste heat, ...; for everything, or per unit times the units), becomes a curve shaped by the hour of day,
 * the weekday, the month and the outdoor temperature, so the period holds exactly the total. Start from a standard
 * profile (lib/profilePresets.ts), change it, and look at a day, a week or a year of it, with the year per month.
 * The outdoor temperature is the typical Frankfurt year. Kept in this browser only (`storageKey`): a first version
 * to try; the models and the twin do not use it yet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DATASET } from "../../../dataset";
import { syntheticOutdoor } from "../../../lib/demand";
import { fmt } from "../../../lib/format";
import {
  averageDay,
  generate,
  monthsFor,
  perMonth,
  rateUnit,
  withAverageDay,
  type Driver,
  type Per,
  type ProfilePart,
  type ProfileSpec,
} from "../../../lib/profile";
import { AALBORG_RESIDENTIAL, loadProfile, PROFILE_PRESETS, type ProfilePreset, type SavedProfile } from "../../../lib/profilePresets";
import { Card } from "../../../ui/Card";
import { Field } from "../../../ui/Field";
import { Kpi, KpiRow } from "../../../ui/Kpi";
import LineChart from "../../../ui/LineChart";
import { NumberField } from "../../../ui/NumberField";
import { Segmented } from "../../../ui/Segmented";
import { CurveEditor } from "../../../ui/CurveEditor";
import { ShapeBars } from "../../../ui/ShapeBars";
import { useCommand, useSnapshotDetail } from "../../../lib/live";
import { pickByName, shapeValues } from "./profileShape";
import "./profileGenerator.css";

// the generators on screen by title (one per profile variable may be open): the assistant's set_profile_shape picks one
const open = new Map<string, (args: Record<string, unknown>) => string>();

type Span = "day" | "week" | "year";
const SPANS: { id: Span; label: string; days: number; step: number }[] = [
  { id: "day", label: "Day", days: 1, step: 0.25 },
  { id: "week", label: "Week", days: 7, step: 0.25 },
  { id: "year", label: "Year", days: 365, step: 1 },
];
const PERS: Per[] = ["day", "week", "month", "year"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
// the canvas reads no CSS variables: fixed colours, as on this page's period charts (the total in its heat orange)
const TOTAL = "#f97316";
const COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#e11d48"];

const keep = (key: string, s: SavedProfile) => {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* not remembered */
  }
};

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// every BDEW sigmoid of the presets, for any part
const SIGMOIDS = PROFILE_PRESETS.flatMap((p) => p.spec.parts.map((x) => x.driver)).filter((d): d is Extract<Driver, { kind: "slp" }> => d.kind === "slp");
const RULES: Record<string, Driver> = {
  none: { kind: "none" },
  below: { kind: "below", limit: 15 },
  above: { kind: "above", limit: 18 },
  linear: { kind: "linear", ref: 10, slope: 0.02 },
  "aalborg-residential": { kind: "learned", model: "aalborg-residential" },
  "helsinki-public": { kind: "learned", model: "helsinki-public" },
  ...Object.fromEntries(SIGMOIDS.map((d) => [d.code, d])),
};

function DriverField({ driver, onChange }: { driver: Driver; onChange: (d: Driver) => void }) {
  return (
    <div className="profile-gen__row">
      <Field label="Outdoor temperature">
        <select className="field field--sm" value={driver.kind === "slp" ? driver.code : driver.kind === "learned" ? driver.model : driver.kind} onChange={(e) => onChange(RULES[e.target.value])}>
          <option value="none">No effect: the same every day</option>
          <option value="below">More below a limit (heating degree-days)</option>
          <option value="above">More above a limit (cooling degree-days)</option>
          <option value="linear">A straight line: more or less per °C</option>
          <option value="aalborg-residential">Learned from measured homes: Aalborg model (AI)</option>
          <option value="helsinki-public">Learned from measured offices, schools, day care: Helsinki model (AI)</option>
          {SIGMOIDS.map((d) => (
            <option key={d.code} value={d.code}>
              BDEW sigmoid {d.code}
            </option>
          ))}
        </select>
      </Field>
      {(driver.kind === "below" || driver.kind === "above") && (
        <NumberField
          label={driver.kind === "below" ? "Heating limit" : "Cooling limit"}
          value={driver.limit}
          onChange={(limit) => onChange({ ...driver, limit })}
          min={-10}
          max={35}
          unit="°C"
        />
      )}
      {driver.kind === "linear" && (
        <>
          <NumberField label="Reference" value={driver.ref} onChange={(ref) => onChange({ ...driver, ref })} min={-20} max={40} unit="°C" />
          <NumberField
            label="Change per °C warmer"
            value={Math.round(driver.slope * 1000) / 10}
            onChange={(v) => onChange({ ...driver, slope: v / 100 })}
            min={-20}
            max={20}
            step={0.5}
            unit="%"
          />
          <p className="muted profile-gen__note">× 1 at the reference; negative: less when warmer (heating), positive: more (cooling, a data center's heat).</p>
        </>
      )}
      {driver.kind === "learned" && (
        <p className="muted profile-gen__note">
          A regression learned from measured buildings: the hour of the week, the outdoor temperature smoothed over hours to days, and the season&apos;s
          sun. It brings its own day shape; leave the hour shape flat.
        </p>
      )}
      {driver.kind === "slp" && (
        <p className="muted profile-gen__note">
          h(T) = A / (1 + (B / (T − 40))^C) + D on the allocation temperature, A {driver.A}, B {driver.B}, C {driver.C}, D {driver.D}.
        </p>
      )}
    </div>
  );
}

/** `storageKey`: where this browser keeps it (one per place and variable); `title`: the card's title; `initial`: the
 * preset a new one starts from; `presets`: more to start from, listed first under `presetsLabel` (e.g. the site's heat
 * sinks: its buildings with their annual demand). */
export default function ProfileGenerator({
  storageKey = `profile-generator:${DATASET}`,
  title = "Profile generator · a total becomes a curve",
  initial = AALBORG_RESIDENTIAL,
  presets = [],
  presetsLabel = "More",
}: {
  storageKey?: string;
  title?: string;
  initial?: string;
  presets?: ProfilePreset[];
  presetsLabel?: string;
}) {
  const all = useMemo(() => [...presets, ...PROFILE_PRESETS], [presets]);
  const [saved, setSaved] = useState<SavedProfile>(() => loadProfile(storageKey, initial, all));
  const { spec } = saved;
  const [partIndex, setPartIndex] = useState(0);
  const [span, setSpan] = useState<Span>("week");
  const [start, setStart] = useState("2025-01-13"); // a winter Monday
  const update = (s: SavedProfile) => {
    setSaved(s);
    keep(storageKey, s);
  };
  const patch = (p: Partial<ProfileSpec>) => update({ ...saved, spec: { ...spec, ...p } });
  const part = spec.parts[Math.min(partIndex, spec.parts.length - 1)];
  const patchPart = (p: Partial<ProfilePart>) => patch({ parts: spec.parts.map((x) => (x === part ? { ...x, ...p } : x)) });
  const preset = all.find((p) => p.id === saved.preset);

  const s = SPANS.find((x) => x.id === span)!;
  const g = useMemo(() => {
    const from = span === "year" ? Date.UTC(+start.slice(0, 4), 0, 1) / 1000 : day(start);
    return generate(spec, from, from + s.days * 86400, s.step, syntheticOutdoor);
  }, [spec, span, start, s]);
  const shownKwh = g.kw.reduce((a, b) => a + b, 0) * s.step;
  // the year per month, whatever is shown: the seasons (mostly from the weather) are what the month bars show
  const months = useMemo(() => {
    const from = Date.UTC(+start.slice(0, 4), 0, 1) / 1000;
    const y = generate(spec, from, Date.UTC(+start.slice(0, 4) + 1, 0, 1) / 1000, 1, syntheticOutdoor);
    return perMonth(y.times, y.kw, 1); // all parts: the hot water in summer too
  }, [spec, start]);
  const rate = rateUnit(spec.unit);
  // the assistant draws the shapes a drag draws (lib/live.ts): the same edits as the curve and bar editors below
  const draw = useRef<(args: Record<string, unknown>) => string>(() => "");
  draw.current = (args) => {
    const at = args.part === undefined ? Math.min(partIndex, spec.parts.length - 1) : spec.parts.findIndex((p, i) => p.label === args.part || i === args.part);
    if (at < 0) throw new Error(`No part "${String(args.part)}": ${spec.parts.map((p) => p.label).join(" | ")}`);
    let next = spec;
    if (args.day !== undefined) next = withAverageDay(next, at, shapeValues(args.day, [24, 48], "day"));
    if (args.weekday !== undefined) {
      const weekday = shapeValues(args.weekday, [7], "weekday");
      next = { ...next, parts: next.parts.map((p, i) => (i === at ? { ...p, weekday } : p)) };
    }
    if (args.month !== undefined) {
      const wanted = shapeValues(args.month, [12], "month");
      next = { ...next, parts: next.parts.map((p) => ({ ...p, month: monthsFor(p.month, months, wanted) })) };
    }
    if (next === spec) throw new Error("set_profile_shape needs day (24 values), weekday (7) or month (12)");
    update({ ...saved, spec: next });
    return `drew the ${[args.day && "day", args.weekday && "weekdays", args.month && "months"].filter(Boolean).join(", ")} of ${title}`;
  };
  useEffect(() => {
    const run = (args: Record<string, unknown>) => draw.current(args);
    open.set(title, run);
    return () => void (open.get(title) === run && open.delete(title));
  }, [title]);
  useCommand("set_profile_shape", (args) => open.get(pickByName([...open.keys()], args.profile))!(args));
  useSnapshotDetail(() => ({
    [`profile: ${title}`]: {
      preset: saved.preset,
      total: spec.total,
      unit: spec.unit,
      per: spec.per,
      per_unit: spec.perUnit ? spec.units : null,
      parts: spec.parts.map((p, i) => ({
        label: p.label,
        share: p.share,
        driver: p.driver,
        weekday: p.weekday,
        average_day: averageDay(spec, i).map((x) => +x.toPrecision(4)),
      })),
      months_in_the_year: months.map((x) => +x.toPrecision(4)),
      shown: { span, start, total: +shownKwh.toPrecision(4) },
      draw: "set_profile_shape {profile, part?, day?: 24 values (its rate unit), weekday?: 7 factors, month?: 12 (the unit per month)}",
    },
  }));

  const lines = [
    { label: "Total", values: g.kw, color: TOTAL, fill: true },
    ...(spec.parts.length > 1 ? spec.parts.map((p, i) => ({ label: p.label, values: g.parts[i], color: COLORS[i % COLORS.length] })) : []),
  ];

  return (
    <Card title={title}>
      <div className="profile-gen">
        <div className="profile-gen__row">
          <Field label="Start from">
            <select
              className="field field--sm"
              value={saved.preset}
              onChange={(e) => {
                const p = all.find((x) => x.id === e.target.value)!;
                setPartIndex(0);
                update({ preset: p.id, spec: p.spec });
              }}
              aria-label="Standard profile"
            >
              {presets.length > 0 && (
                <optgroup label={presetsLabel}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Standard profiles">
                {PROFILE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>

          {spec.perUnit && <NumberField label="Units" value={spec.units} onChange={(units) => patch({ units })} min={0} grouped />}
          <NumberField label={spec.perUnit ? "Total per unit" : "Total"} value={spec.total} onChange={(total) => patch({ total })} min={0} step={0.1} grouped />
          <Field label="in">
            <input
              className="field field--sm profile-gen__unit"
              list="profile-units"
              value={spec.unit}
              onChange={(e) => patch({ unit: e.target.value || "kWh" })}
              aria-label="Unit of the total"
            />
          </Field>
          <datalist id="profile-units">
            {["kWh", "MWh", "Wh", "GWh", "m³", "kg", "t"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <Field label="per">
            <select className="field field--sm" value={spec.per} onChange={(e) => patch({ per: e.target.value as Per })} aria-label="Period of the total">
              {PERS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        {preset && (
          <p className="muted profile-gen__note">
            {preset.about} Source: {preset.source}.
          </p>
        )}

        <div className="profile-gen__row">
          <Segmented label="Show" value={span} onChange={setSpan} options={SPANS.map(({ id, label }) => ({ id, label }))} />
          <Field label={span === "year" ? "Year" : "From"}>
            <input
              className="field field--sm"
              type="date"
              value={start}
              onChange={(e) => e.target.value && setStart(e.target.value)}
              aria-label="Start of the shown span"
            />
          </Field>
        </div>
        <KpiRow className="profile-gen__kpis">
          <Kpi label="Shown" value={fmt(shownKwh)} unit={spec.unit} sub={`${iso(g.times[0] ?? 0)}, ${s.label.toLowerCase()}`} />
          <Kpi label="Peak" value={fmt(Math.max(0, ...g.kw), 2)} unit={rate} />
          <Kpi
            label={`Over the ${spec.per}`}
            value={fmt(g.periodKwh)}
            unit={spec.unit}
            sub={
              g.matched
                ? `${spec.perUnit ? `= ${fmt(spec.units)} × ${fmt(spec.total)} ${spec.unit}` : `= the total`}, from ${iso(g.period.from)}`
                : "not met: a part has nothing to spread over here (e.g. heating on a warm day)"
            }
            tone={g.matched ? "var(--ok)" : "var(--danger)"}
            edge
          />
          <Kpi label="Mean" value={fmt(g.kw.length ? shownKwh / (g.kw.length * s.step) : 0, 2)} unit={rate} />
        </KpiRow>
        <LineChart xs={g.times} lines={lines} height={240} unit={rate} />
        {/* the standard view stays simple: a profile and its total; shaping it is there when wanted */}
        <details className="profile-gen__more">
          <summary>Shape it yourself: per unit, parts, weather, the day, weekdays, months</summary>
          <div className="profile-gen">
            <div className="profile-gen__row">
              <Segmented
                label="Total"
                value={spec.perUnit ? "unit" : "all"}
                onChange={(v) => patch({ perUnit: v === "unit" })}
                options={[
                  { id: "all", label: "One total" },
                  { id: "unit", label: "Per unit × units" },
                ]}
              />
            </div>
            {spec.parts.length > 1 && (
              <Segmented
                label="Part"
                value={String(partIndex)}
                onChange={(v) => setPartIndex(Number(v))}
                options={spec.parts.map((p, i) => ({ id: String(i), label: p.label }))}
              />
            )}
            <div className="profile-gen__row">
              {spec.parts.length > 1 && (
                <NumberField
                  label={`${part.label}: share`}
                  value={Math.round(part.share * 100)}
                  onChange={(v) => patchPart({ share: v / 100 })}
                  min={0}
                  max={100}
                  unit="%"
                />
              )}
            </div>
            <DriverField driver={part.driver} onChange={(driver) => patchPart({ driver })} />
            <CurveEditor
              label={`Average day, ${rate}: drag a point to reshape, a line to move it (the total follows its height)`}
              curves={spec.parts.map((p, i) => ({
                name: p.label,
                values: averageDay(spec, i),
                color: spec.parts.length > 1 ? COLORS[i % COLORS.length] : TOTAL,
              }))}
              unit={rate}
              onChange={(i, day) => update({ ...saved, spec: withAverageDay(spec, i, day) })}
            />
            <div className="profile-gen__shapes">
              <ShapeBars label="Day of week" values={part.weekday} ticks={WEEKDAYS} onChange={(weekday) => patchPart({ weekday })} />
              <ShapeBars
                label={`Month: ${spec.unit} in ${start.slice(0, 4)}${spec.parts.length > 1 ? ", all parts" : ""}`}
                values={months}
                ticks={MONTHS}
                // a month drawn higher or lower: every part's month by the same ratio (summer: through its hot water)
                onChange={(wanted) => patch({ parts: spec.parts.map((p) => ({ ...p, month: monthsFor(p.month, months, wanted) })) })}
              />
            </div>

            <p className="muted profile-gen__note">
              Outdoor temperature: the typical Frankfurt year (synthetic). The month bars are what each month holds (mostly the weather's doing): drag one to
              give that month more or less, the other months make up the rest of the total. The total is met over the {spec.per} that contains the start; a
              shorter span shows its part of it.
            </p>
          </div>
        </details>
      </div>
    </Card>
  );
}
