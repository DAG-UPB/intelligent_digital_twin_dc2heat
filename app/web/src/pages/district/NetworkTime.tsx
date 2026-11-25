/**
 * The Heat distribution card's time: the hour of the typical year that the map and the figures show. A day of the
 * year (its date shown) and an hour of the day to move, three presets (the year's coldest hour, the coldest day's
 * evening, the warmest day's noon) and play through the year (two days a step, at this hour) or through the day (an
 * hour a step), paused by a second click and never started by itself. Under them that hour's figures: the outdoor
 * temperature, the buildings' demand and the pipes' loss, the heat pump's heat and electricity, the peak boiler, the
 * data center's heat taken and left, the fastest water in the pipes.
 */
import { useEffect, useRef, useState } from "react";
import { fmt } from "../../lib/format";
import { Slider } from "../../ui/Slider";
import type { NetworkHour, NetworkHours } from "./networkCost";
import { atHour, dayLabel, dayOf, hourLabel, hourOf, presetsOf } from "./networkView";

const STEP_MS = { year: 140, day: 380 };
const mw = (kw: number) => `${fmt(kw / 1000, 2)} MW`;

export default function NetworkTime({ hours, h, now, onHour }: { hours: NetworkHours; h: number; now: NetworkHour; onHour: (h: number) => void }) {
  const [play, setPlay] = useState<"year" | "day" | null>(null);
  const at = useRef(h);
  at.current = h;
  const go = useRef(onHour);
  go.current = onHour;
  useEffect(() => {
    if (!play) return;
    const t = window.setInterval(() => {
      const [d, hr] = [dayOf(at.current), hourOf(at.current)];
      go.current(play === "year" ? atHour(d + 2, hr) : atHour(d, (hr + 1) % 24));
    }, STEP_MS[play]);
    return () => window.clearInterval(t);
  }, [play]);
  const p = presetsOf(hours);
  const presets = [
    { name: "Winter evening", h: p.winterEvening },
    { name: "Summer noon", h: p.summerNoon },
  ];
  const playBtn = (mode: "year" | "day", name: string) => (
    <button type="button" className="btn btn--sm net__play" aria-pressed={play === mode} onClick={() => setPlay(play === mode ? null : mode)}>
      {play === mode ? "❚❚ Pause" : `▶ ${name}`}
    </button>
  );

  const made = now.hpKw + now.boilerKw;
  const usable = now.takenKw + now.spareKw;
  const fastest = Math.max(0, ...now.pipes.map((x) => x.velocity));
  const share = (a: number, b: number) => `${b > 0 ? (100 * a) / b : 0}%`;
  return (
    <div className="net__time" aria-label="The hour shown">
      <div className="net__presets">
        {presets.map((x) => (
          <button key={x.name} type="button" className="btn btn--sm" aria-pressed={h === x.h} onClick={() => onHour(x.h)}>
            {x.name}
          </button>
        ))}
      </div>
      <Slider label="Day of the year" value={dayOf(h)} show={dayLabel(dayOf(h))} min={0} max={364} onChange={(d) => onHour(atHour(d, hourOf(h)))} />
      <Slider
        label="Hour of the day"
        value={hourOf(h)}
        show={`${String(hourOf(h)).padStart(2, "0")}:00`}
        min={0}
        max={23}
        onChange={(hr) => onHour(atHour(dayOf(h), hr))}
      />
      <div className="net__presets">
        {playBtn("year", "Play the year")}
        {playBtn("day", "Play the day")}
      </div>
      <div className="net__hour" aria-live="off">
        <div className="net__hour-head">
          <b>{hourLabel(h)}</b>
          <span>{fmt(now.outdoorC, 1)} °C outside</span>
        </div>
        <dl className="net__hour-grid">
          <div>
            <dt>Demand</dt>
            <dd>{mw(now.demandKw)}</dd>
            <dd className="muted">+ {mw(now.lossKw)} lost by the pipes</dd>
          </div>
          <div>
            <dt>
              <i className="nf-dc" /> Heat pump
            </dt>
            <dd>{mw(now.hpKw)}</dd>
            <dd className="muted">
              <i className="nf-elec" /> {mw(now.hpElecKw)} electricity
            </dd>
          </div>
          <div>
            <dt>
              <i className="nf-boiler" /> Peak boiler
            </dt>
            <dd>{now.boilerKw > 1 ? mw(now.boilerKw) : "off"}</dd>
            <dd className="muted">{made > 0 ? `${fmt((100 * now.boilerKw) / made)} % of the heat now` : "no heat needed"}</dd>
          </div>
          <div>
            <dt>Data center&apos;s heat</dt>
            <dd>{mw(now.takenKw)} taken</dd>
            <dd className="muted">
              <i className="nf-spare" /> {mw(now.spareKw)} left
            </dd>
          </div>
        </dl>
        {/* the hour's heat by where it comes from, and the data center's heat by what is done with it */}
        <div className="net__split" title="The heat made now: the heat pump (the data center's heat and its electricity) and the peak boiler">
          <i className="nf-dc" style={{ width: share(now.takenKw, made) }} />
          <i className="nf-elec" style={{ width: share(Math.max(0, now.hpKw - now.takenKw), made) }} />
          <i className="nf-boiler" style={{ width: share(now.boilerKw, made) }} />
        </div>
        <div className="net__split" title="The data center's heat now: taken by the heat pump, and left">
          <i className="nf-dc" style={{ width: share(now.takenKw, usable) }} />
          <i className="nf-spare" style={{ width: share(now.spareKw, usable) }} />
        </div>
        <div className="site__hint">The water runs at up to {fmt(fastest, 2)} m/s in the pipes now (the dots on the map: faster where it is faster).</div>
      </div>
    </div>
  );
}
