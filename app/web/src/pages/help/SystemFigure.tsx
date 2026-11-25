/**
 * The DC2HEAT system figure the app is built on: the data center, the heat distribution and the district, inside the
 * whole Intelligent Digital Twin. Time and weather act on all three; each takes electricity and emits CO2; the AI badges
 * mark what the twin optimises. Each part (and the frame, the whole twin) links to its first page. Colours are theme
 * tokens (help.css); the icons are line drawings in currentColor.
 */
import type { ReactNode } from "react";
import { hrefOf, TABS } from "../../app/routes";
import { SUB_ICONS } from "../../app/SubIcon";
import { MaskIcon } from "../../ui/MaskIcon";
import { PAGE_TEXT } from "./home";

const first = (id: string) => {
  const tab = TABS.find((t) => t.id === id)!;
  return { href: hrefOf(tab.id, tab.subs[0].id), label: tab.label, icon: tab.icon };
};

/** The three parts, one size and in one row: box, colour tone and the x of their arrows from above (influences,
 * emissions) and below (electricity). */
const BOX = { y: 138, w: 334, h: 334 };
const PARTS = [
  { id: "dc", title: "Data center", x: 20, tone: "dc" },
  { id: "heat", title: "Heat distribution", x: 433, tone: "hd" },
  { id: "district", title: "District", x: 846, tone: "dist" },
].map((p) => ({ ...p, ...BOX, drop: p.x + Math.round(BOX.w * 0.28), out: p.x + Math.round(BOX.w * 0.72), ...first(p.id) }));

/** The whole twin's three activities (its pages): bands across all three parts, behind them, their names on the left
 * (LEFT: the figure's room for them, left of x 0). */
const LEFT = 200;
const TWIN = TABS.find((t) => t.whole)!;
const BANDS = TWIN.subs.map((s, i) => ({ ...s, href: hrefOf(TWIN.id, s.id), key: `${TWIN.id}/${s.id}`, y: BOX.y + 2 + i * 112, h: 104 }));

const BUS = 72;
const ELECTRICITY_FROM = 548;

const at = (x: number, y: number, children: ReactNode, tone = "") => (
  <g transform={`translate(${x} ${y})`} className={`sys__icon${tone && ` sys__icon--${tone}`}`}>
    {children}
  </g>
);

const CLOUD = "M-13 13H12A7 7 0 0 0 11-1 9 9 0 0 0-5-2 8 8 0 0 0-13 13Z";

const clock = (
  <>
    <circle r={14} />
    <path d="M0-8V0L6 4" />
  </>
);
const calendar = (
  <>
    <rect x={-14} y={-11} width={28} height={25} rx={4} />
    <path d="M-14-3H14M-7-15v7M7-15v7" />
    {[-7, 0, 7].flatMap((x) => [4, 10].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.4} className="sys__fill" />))}
  </>
);
const sunRays = (r1: number, r2: number, angles: number[]) =>
  angles
    .map((a) => {
      const c = Math.cos((a * Math.PI) / 180);
      const s = Math.sin((a * Math.PI) / 180);
      return `M${(r1 * c).toFixed(1)} ${(r1 * s).toFixed(1)}L${(r2 * c).toFixed(1)} ${(r2 * s).toFixed(1)}`;
    })
    .join("");
const weather = (
  <>
    <g transform="translate(-6 -7)" className="sys__icon--heat">
      <circle r={6} />
      <path d={sunRays(9, 12, [135, 180, 225, 270, 315, 0])} />
    </g>
    <path d={CLOUD} transform="translate(4 3)" className="sys__solid" />
  </>
);
const co2 = (
  <>
    <path d={CLOUD} transform="scale(1.2 1.1) translate(0 -5)" />
    <text y={4} className="sys__glyph">
      CO₂
    </text>
  </>
);
const meter = (
  <>
    <rect x={-12} y={-13} width={24} height={26} rx={4} />
    <path d="M-7 1A7 7 0 0 1 7 1M0 1l4-5M-5 8H5" />
  </>
);
const coin = (
  <>
    <circle r={11} />
    <text y={5} className="sys__glyph sys__glyph--big">
      €
    </text>
  </>
);
const rack = (
  <>
    <rect x={-11} y={-16} width={22} height={32} rx={3} />
    <path d="M-11-5.3H11M-11 5.3H11M0-10.6H6M0 0H6M0 10.6H6" />
    {[-10.6, 0, 10.6].map((y) => (
      <circle key={y} cx={-5} cy={y} r={1.4} className="sys__fill" />
    ))}
  </>
);
const database = (
  <>
    <ellipse cy={-11} rx={11} ry={4} />
    <path d="M-11-11V11A11 4 0 0 0 11 11V-11M-11 0A11 4 0 0 0 11 0" />
  </>
);
const fan = (
  <>
    <circle r={20} />
    {[0, 120, 240].map((a) => (
      <path key={a} d="M0 0C-2.5-6.5 1.5-14 7.5-13.5 10-8.5 6-2.5 0 0Z" transform={`rotate(${a})`} />
    ))}
    <circle r={3} className="sys__fill" />
  </>
);
const bulb = (
  <>
    <path d="M-5 7C-5 3-10 1-10-5A10 10 0 0 1 10-5C10 1 5 3 5 7Z" />
    <path d="M-4 11H4M-2.5 14.5H2.5M-3 2 0-2 3 2" />
  </>
);
const door = (
  <>
    <rect x={-9} y={-15} width={18} height={30} rx={2} />
    <path d="M-14 15H14" />
    <circle cx={4.5} cy={1} r={1.5} className="sys__fill" />
  </>
);
const tank = (
  <>
    <ellipse cy={-15} rx={12} ry={3.5} />
    <path d="M-12-15V15A12 3.5 0 0 0 12 15V-15" />
    <path d="M-12 2Q-6-1.5 0 2T12 2" className="sys__icon--heat" />
  </>
);
const heatPump = (
  <>
    <circle r={30} className="sys__hp" />
    <path d="M0-18V18" className="sys__thin" />
    <g transform="translate(-12 0)" className="sys__icon--heat">
      <circle r={4.5} />
      <path d={sunRays(7, 9.5, [0, 45, 90, 135, 180, 225, 270, 315])} />
    </g>
    <g transform="translate(12 0)" className="sys__icon--cold">
      <path d="M0-10V10M-8.7-5 8.7 5M-8.7 5 8.7-5M-2.5-7.5 0-5 2.5-7.5M-2.5 7.5 0 5 2.5 7.5" />
    </g>
  </>
);
const network = (
  <>
    <path d="M-62-6H-15M-62 6H-15M15-6H62M15 6H62M-62-6V6M62-6V6" />
    <path d="M-15-10 15 10V-10L-15 10Z" className="sys__solid" />
    <path d="M0 0V-18M-8-18H8" />
  </>
);
const house = <path d="M-22 0 0-18 22 0M-17-4V18H17V-4" />;
const heating = (
  <>
    {house}
    <path d="M-7 15c-3-3 3-4 0-6.5s3-4 0-6.5M0 15c-3-3 3-4 0-6.5s3-4 0-6.5M7 15c-3-3 3-4 0-6.5s3-4 0-6.5" className="sys__icon--heat" />
  </>
);
const decentral = (
  <>
    <path d="M-34 0-12-20 10 0M-29-4V18H5V-4M-38 18H38" />
    <rect x={-22} y={0} width={10} height={16} rx={3} className="sys__icon--heat" />
    <rect x={13} y={2} width={22} height={16} rx={2} />
    <circle cx={24} cy={10} r={5} />
    <path d="M20.5 10H27.5M24 6.5V13.5" className="sys__thin" />
  </>
);
const tap = (
  <>
    <path d="M-16-10V-2M-16-6H2A5 5 0 0 1 7-1V3M-6-6V-13M-10-13H-2" />
    <path d="M7 9C5 12 4 14 4 15.5A3 3 0 0 0 10 15.5C10 14 9 12 7 9Z" className="sys__icon--heat" />
  </>
);
const thermometer = (
  <>
    <path d="M-3 7.5V-14A3 3 0 0 1 3-14V7.5A5.5 5.5 0 1 1-3 7.5Z" />
    <path d="M0 12V-6" className="sys__icon--heat" />
  </>
);

/** The AI badge: the twin optimises the part next to it. */
const ai = (x: number, y: number, what: string) => (
  <g transform={`translate(${x} ${y})`} className="sys__ai">
    <title>{`AI optimises ${what}`}</title>
    <rect x={-34} y={-15} width={68} height={30} rx={15} />
    <g className="sys__icon sys__icon--ai">
      <path d="M-20 9V5C-24 3-24-7-16-8-10-8-7-4-8-1L-6 2H-8V5H-11V9" />
      <path d="M-3-5H5M-3 0H5M-3 5H5" className="sys__thin" />
      <circle cx={-1} cy={-5} r={1.8} className="sys__fill" />
      <circle cx={3} cy={0} r={1.8} className="sys__fill" />
      <circle cx={0} cy={5} r={1.8} className="sys__fill" />
    </g>
    <text x={19} y={5} className="sys__ai-text">
      AI
    </text>
  </g>
);

/** A hollow (block) arrow pointing up from y0 to y1; open at the base when it comes out of a box. */
const hollowUp = (x: number, y0: number, y1: number, open = false) => (
  <path d={`M${x - 7} ${y0}V${y1 + 18}H${x - 15}L${x} ${y1}L${x + 15} ${y1 + 18}H${x + 7}V${y0}${open ? "" : "Z"}`} className="sys__hollow" />
);

const line = (d: string, kind: "warm" | "cold" | "feed") => <path d={d} className={`sys__${kind}`} markerEnd={`url(#sys-${kind})`} />;

/** A bold name with an optional note after it on the same line. */
const label = (x: number, y: number, title: string, sub?: string) => (
  <text x={x} y={y} className="sys__label">
    {title}
    {sub && (
      <tspan dx={6} className="sys__sub">
        {sub}
      </tspan>
    )}
  </text>
);

/** The inside of each part, in the figure's coordinates. */
const INSIDE: Record<string, ReactNode> = {
  dc: (
    <>
      {at(179, 206, rack)}
      {at(231, 206, database)}
      {label(205, 242, "IT")}
      {line("M183 284V254", "cold")}
      {line("M227 254V284", "warm")}
      {/* a size smaller and close to their arrows: the German ("Luft/Wasser") stays inside the box */}
      <text x={175} y={273} className="sys__sub sys__sub--tight sys__end">
        Air/water <tspan className="sys__cold-text">(cold)</tspan>
      </text>
      <text x={235} y={273} className="sys__sub sys__sub--tight sys__start">
        Air/water <tspan className="sys__warm-text">(warm)</tspan>
      </text>
      {at(205, 312, fan)}
      {ai(70, 312, "the cooling")}
      {label(205, 350, "Cooling")}
      {line("M183 360V388", "cold")}
      {line("M227 388V360", "warm")}
      {at(181, 412, bulb)}
      {at(229, 412, door)}
      {label(205, 452, "Infrastructure")}
    </>
  ),
  heat: (
    <>
      {at(600, 228, tank)}
      {ai(682, 228, "the heat distribution")}
      <text x={578} y={233} className="sys__label sys__end">
        Thermal storage
      </text>
      <path d="M600 252V278" className="sys__pipe" />
      {at(600, 312, heatPump)}
      {label(600, 362, "Central heat pump")}
      {at(600, 406, network)}
      {label(600, 448, "Network")}
    </>
  ),
  district: (
    <>
      {at(1013, 210, heating)}
      {label(1013, 250, "Space heating")}
      {line("M1013 288V262", "warm")}
      {at(1011, 312, decentral)}
      {ai(1131, 312, "the houses' heat pumps and storage")}
      {label(1013, 352, "Decentral heat pumps and storage")}
      {line("M1013 362V388", "warm")}
      {at(991, 414, tap)}
      {at(1035, 412, thermometer)}
      {label(1013, 452, "Hot water")}
    </>
  ),
};

const DESC =
  "The Intelligent Digital Twin made of three parts. The data center: its IT (servers, network) is cooled by the cooling with cold air or water, which comes back warm; the infrastructure (lighting, building) is cooled too, and AI optimises the cooling. Its warm water goes to the heat distribution's central heat pump and comes back cold; there are a thermal storage, a network and AI. The heat goes on to the district: decentral heat pumps and storage, with AI, heat the houses and their hot water. Time (time of day, weekday, season) and weather (outdoor temperature, humidity, wind speed) act on all three parts; each part takes electricity, which costs energy and money, and emits CO2.";

export function SystemFigure() {
  return (
    <div className="sys-scroll">
      <svg className="sys" viewBox={`${-LEFT} -14 ${1200 + LEFT} 570`} role="group" aria-labelledby="sys-title" aria-describedby="sys-desc">
        <title id="sys-title">How the twin sees the system: data center, heat distribution and district</title>
        <desc id="sys-desc">{DESC}</desc>
        <defs>
          {(["warm", "cold", "feed"] as const).map((k) => (
            <marker key={k} id={`sys-${k}`} viewBox="0 0 10 10" refX="7" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto">
              <path d="M0 0.5 9 5 0 9.5Z" className={`sys__head--${k}`} />
            </marker>
          ))}
        </defs>

        {/* time and weather, shared by all three parts */}
        {[
          {
            x: 380,
            icons: (
              <>
                {at(-100, 0, clock)}
                {at(-62, 0, calendar)}
              </>
            ),
            text: -34,
            title: "Time",
            sub: "e.g. time of day, weekday, season",
          },
          { x: 820, icons: at(-90, 0, weather), text: -56, title: "Weather", sub: "e.g. outdoor temperature, humidity, wind speed" },
        ].map((f) => (
          <g key={f.title}>
            <g transform={`translate(${f.x} 30)`}>{f.icons}</g>
            <text x={f.x + f.text} y={25} className="sys__label sys__start">
              {f.title}
            </text>
            <text x={f.x + f.text} y={43} className="sys__sub sys__start">
              {f.sub}
            </text>
            <path d={`M${f.x} 52V${BUS}`} className="sys__bus" />
          </g>
        ))}
        <path d={`M${PARTS[0].drop} ${BUS}H${PARTS[2].drop}`} className="sys__bus" />
        {PARTS.map((p) => (
          <g key={p.id}>{line(`M${p.drop} ${BUS}V${p.y - 4}`, "feed")}</g>
        ))}

        {/* the twin's activities across the three parts, each a link to its page */}
        {BANDS.map((b) => (
          <a key={b.id} href={b.href} className="sys__band" aria-label={`Go to ${b.label}`}>
            <title>{PAGE_TEXT[b.key]}</title>
            <rect x={8 - LEFT} y={b.y} width={1184 + LEFT} height={b.h} rx={b.h / 2} />
            <foreignObject x={18 - LEFT} y={b.y} width={LEFT - 30} height={b.h}>
              <div className="sys__band-name">
                {SUB_ICONS[b.key]}
                {b.label} <span aria-hidden>→</span>
              </div>
            </foreignObject>
          </a>
        ))}

        {/* the three parts, each a link to its pages */}
        {PARTS.map((p) => (
          <a key={p.id} href={p.href} className="sys__link" aria-label={`${p.label}: open its pages`}>
            <title>{`Open the ${p.label}`}</title>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={18} className={`sys__box sys__box--${p.tone}`} />
            <foreignObject x={p.x} y={p.y + 8} width={p.w} height={38}>
              <div className={`sys__head sys__box--${p.tone}`}>
                <MaskIcon src={p.icon} />
                {p.title}
              </div>
            </foreignObject>
            {INSIDE[p.id]}
          </a>
        ))}

        {/* heat between the parts: warm from the cooling to the central heat pump, cold back; warm on to the district */}
        <g className="sys__flows">
          {line("M230 302H564", "warm")}
          {line("M569 322H236", "cold")}
          {line("M634 312H966", "warm")}
        </g>

        {/* out of the top: emissions; into the bottom: electricity (energy and cost) */}
        {PARTS.map((p) => (
          <g key={p.id}>
            {hollowUp(p.out, p.y, 88, true)}
            <text x={p.out - 24} y={114} className="sys__sub sys__end">
              Emissions
            </text>
            {at(p.out + 38, 108, co2)}
            {hollowUp(p.out, ELECTRICITY_FROM, p.y + p.h)}
            <text x={p.out - 24} y={ELECTRICITY_FROM - 20} className="sys__sub sys__end">
              Electricity
            </text>
            {at(p.out + 36, ELECTRICITY_FROM - 24, meter)}
            {at(p.out + 66, ELECTRICITY_FROM - 24, coin)}
          </g>
        ))}
      </svg>
    </div>
  );
}
