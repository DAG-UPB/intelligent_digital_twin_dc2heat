/**
 * The heat network's time on the Site map, at the map's top right: two dials to turn and to play, the day's (its hour,
 * midnight at the top, round the clock from night to noon) and the year's (its day, January at the top, the seasons
 * round the ring), beside them that hour's figures (outdoor temperature, the buildings' demand, the heat pump, the
 * boiler, the data center's heat left), three presets, and the water's flow on the map switched on or off (off at
 * first when the system asks for reduced motion; the switch overrides it, and turning or playing a dial switches it
 * on). Rendered into the map's container: clicks
 * and wheel turns on it do not reach the map.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { fmt } from "../../lib/format";
import type { NetworkHour, NetworkHours } from "./networkCost";
import { atHour, dayLabel, dayOf, hourOf, presetsOf } from "./networkView";

const STEP_MS = { year: 140, day: 380 }; // the year two days a step, the day an hour a step
const TAU = 2 * Math.PI;
const R = 25; // the ring's radius in its 64 × 64 box
const mw = (kw: number) => `${fmt(kw / 1000, 1)} MW`;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A point on the ring at `f` of a turn (0 at the top, clockwise). */
const onRing = (f: number, r = R): [number, number] => [32 + r * Math.sin(f * TAU), 32 - r * Math.cos(f * TAU)];

/** A ring of `n` steps to turn: dragging on it (or the arrow keys) sets the step under the pointer; its middle plays. */
function Dial({
  kind,
  label,
  n,
  value,
  ticks,
  show,
  playing,
  onValue,
  onPlay,
}: {
  kind: "day" | "year";
  label: string;
  n: number;
  value: number;
  ticks: number[]; // steps with a long tick
  show: string;
  playing: boolean;
  onValue: (v: number) => void;
  onPlay: () => void;
}) {
  const box = useRef<SVGSVGElement>(null);
  const f = value / n;
  const [hx, hy] = onRing(f);
  const set = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const turn = (Math.atan2(e.clientX - (r.left + r.width / 2), r.top + r.height / 2 - e.clientY) / TAU + 1) % 1;
    onValue(Math.round(turn * n) % n);
  };
  const [ax, ay] = onRing(0);
  return (
    <div className={`maptime__dial maptime__dial--${kind}`}>
      <div className="maptime__ring" aria-hidden="true" />
      <svg
        ref={box}
        viewBox="0 0 64 64"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={value}
        aria-valuetext={show}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => e.buttons && set(e)}
        onKeyDown={(e) => {
          const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          onValue((value + step + n) % n);
        }}
      >
        {ticks.map((t) => {
          const [x1, y1] = onRing(t / n, R - 4);
          const [x2, y2] = onRing(t / n, R + 4);
          return <line key={t} className="maptime__tick" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        <path className="maptime__arc" d={`M${ax} ${ay} A${R} ${R} 0 ${f > 0.5 ? 1 : 0} 1 ${hx} ${hy}`} />
        <circle className="maptime__handle" cx={hx} cy={hy} r={5} />
      </svg>
      <button type="button" className="maptime__play" aria-label={playing ? `Pause the ${kind}` : `Play the ${kind}`} aria-pressed={playing} onClick={onPlay}>
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="maptime__show">{show}</span>
    </div>
  );
}

export default function MapTime({
  map,
  hours,
  h,
  now,
  onHour,
}: {
  map: { current: L.Map | null };
  hours: NetworkHours;
  h: number;
  now: NetworkHour;
  onHour: (h: number) => void;
}) {
  // the box on the map: made once, its events kept from the map
  const [el] = useState(() => {
    const d = document.createElement("div");
    d.className = "maptime";
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  });
  useEffect(() => {
    const c = map.current?.getContainer();
    if (!c) return;
    c.append(el);
    return () => el.remove();
  }, [map, el]);

  // the water's flow: the map's container says whether it moves (district.css .net-moving / .net-still)
  const [flow, setFlow] = useState(() => !reduced());
  useEffect(() => {
    const c = map.current?.getContainer();
    if (!c) return;
    c.classList.toggle("net-moving", flow);
    c.classList.toggle("net-still", !flow);
    return () => c.classList.remove("net-moving", "net-still");
  }, [map, flow]);

  const [play, setPlayState] = useState<"year" | "day" | null>(null);
  /** A dial played (or turned): the water moves with it. */
  const setPlay = (p: "year" | "day" | null) => {
    setPlayState(p);
    if (p) setFlow(true);
  };
  const turn = (to: number) => {
    setFlow(true);
    onHour(to);
  };
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
  const hr = hourOf(h);
  return createPortal(
    <section className="maptime__box" aria-label="The hour on the map">
      <div className="maptime__dials">
        <Dial
          kind="day"
          label="Hour of the day"
          n={24}
          value={hr}
          ticks={[0, 6, 12, 18]}
          show={`${String(hr).padStart(2, "0")}:00`}
          playing={play === "day"}
          onValue={(v) => turn(atHour(dayOf(h), v))}
          onPlay={() => setPlay(play === "day" ? null : "day")}
        />
        <Dial
          kind="year"
          label="Day of the year"
          n={365}
          value={dayOf(h)}
          ticks={[0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]}
          show={dayLabel(dayOf(h))}
          playing={play === "year"}
          onValue={(v) => turn(atHour(v, hr))}
          onPlay={() => setPlay(play === "year" ? null : "year")}
        />
      </div>
      <div className="maptime__now" aria-live="off">
        <b>{fmt(now.outdoorC, 1)} °C outside</b>
        <span>
          Demand <b>{mw(now.demandKw)}</b>
        </span>
        <span>
          <i className="nf-dc" /> Heat pump <b>{mw(now.hpKw)}</b>
        </span>
        <span>
          <i className="nf-boiler" /> Alternative heat supply <b>{now.boilerKw > 1 ? mw(now.boilerKw) : "off"}</b>
        </span>
        <span>
          <i className="nf-spare" /> Data center left <b>{mw(now.spareKw)}</b>
        </span>
      </div>
      <div className="maptime__chips">
        {presets.map((x) => (
          <button key={x.name} type="button" className="btn btn--xs" aria-pressed={h === x.h} onClick={() => onHour(x.h)}>
            {x.name}
          </button>
        ))}
        <button type="button" className="btn btn--xs" aria-pressed={flow} onClick={() => setFlow(!flow)} title="The water's flow in the pipes, moving or still">
          {flow ? "❚❚ Flow" : "▶ Flow"}
        </button>
      </div>
    </section>,
    el,
  );
}
