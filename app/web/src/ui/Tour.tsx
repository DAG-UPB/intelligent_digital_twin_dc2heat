/**
 * A tour (its steps: pages/help/tours.ts): one step after the other, the part of the page it is about lit up and the
 * rest dimmed, a card beside it says what it is and what to do there; Back / Next (or ← →), Esc or ✕ ends it. The page
 * stays usable under it (the dimming lets clicks through). A step on another page (`route`) opens it first; a part
 * hidden at first (a card the Site map shows only on its step) is shown by clicking `click`; once shown, the step does
 * what it explains (`act`: a click, a play, another mode) and undoes it when left (`undo`); a part not on the page (an
 * optional step) is passed over.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TourStep {
  target: string; // a CSS selector: the part of the page the step is about
  title: string;
  text: string;
  route?: string; // "tab/sub": the page the step is on, opened first (a tour through the app)
  click?: string; // a CSS selector clicked once when the target is not shown yet
  act?: string; // a CSS selector clicked once the target is shown: the step shows it working
  undo?: string; // a CSS selector clicked when the step is left, after its act or click: back as it was
  optional?: boolean; // not on every page that shares the tour: passed over when missing
  parts?: string; // a CSS selector: the target's parts lit one by one (each its own outline), the rest dimmed
}

/** Motion kept down where the system asks for it. */
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const WAIT_MS = 10_000; // how long a step waits for its part (a page loading, a card opening, a network planned)
const PAD = 6;
const CARD_W = 320;
const EDGE = 24; // the room kept round a part scrolled into view

/** The first shown element a selector names (a box, and not made invisible: a closed menu kept in place). */
export function shown(sel: string): HTMLElement | null {
  for (const e of document.querySelectorAll<HTMLElement>(sel)) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    if (r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0") return e;
  }
  return null;
}

/** The page's zoom (main.tsx scales the app to the window with CSS zoom): an element's rect comes in screen pixels, a
 * fixed element's left/top are taken in the page's own, so both are divided by it. */
const zoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1;
/** The element's rect in the page's own pixels. */
const rectOf = (e: Element) => {
  const r = e.getBoundingClientRect();
  const z = zoom();
  return new DOMRect(r.x / z, r.y / z, r.width / z, r.height / z);
};

/** The boxes that scroll round an element (the page, a panel), the innermost first. */
function scrollers(e: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = e.parentElement; p; p = p.parentElement)
    if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) out.push(p);
  return out;
}

/** How a box scrolls to show the part, as little as it can: its top under the box's top (a part above, or one too tall
 * to show whole), its bottom over the box's bottom (a part below), or not at all (in view). */
/** Room the part keeps above it when scrolled to (its CSS scroll-margin-top: a row that stays on top of the page). */
const marginTop = (e: Element) => parseFloat(getComputedStyle(e).scrollMarginTop) || 0;

function aim(e: Element, box: Element): "top" | "bottom" | null {
  const r = rectOf(e);
  const b = rectOf(box);
  const top = b.top + marginTop(e);
  const tall = r.height > b.height * 0.6;
  if (r.top < top || (tall && r.top > top + 2 * EDGE)) return "top";
  if (!tall && r.bottom > b.bottom) return "bottom";
  return null;
}

/**
 * The part brought into view gently: each box round it glides there, eased in and out over about a second, aimed anew
 * every frame (a page still drawing under it never makes it jump). Watched for a while after (WAIT_MS): a page still
 * loading that pushes it away has it glided back. `ahead` keeps what is still to scroll, so the light and the card go
 * straight to where the part will be. The user's own scrolling or a click stops it. Returns the stop.
 */
function glide(find: () => Element | null, ahead: { current: number }): () => void {
  let id = 0;
  let wait = 0;
  const start = performance.now();
  const run = () => {
    if (performance.now() - start > WAIT_MS) return void (ahead.current = 0);
    const e0 = find();
    const boxes = (e0 ? scrollers(e0) : []).flatMap((box) => {
      const how = aim(e0!, box);
      return how ? [{ box, how, from: box.scrollTop }] : [];
    });
    if (!e0 || !boxes.length) {
      ahead.current = 0;
      wait = window.setTimeout(run, 200);
      return;
    }
    // the scroll that shows the part (in the page's pixels, as scrollTop: rectOf took the zoom out)
    const goal = (b: (typeof boxes)[number], e: Element) => {
      const r = rectOf(e);
      const o = rectOf(b.box);
      const by = b.how === "top" ? r.top - o.top - EDGE - marginTop(e) : r.bottom - o.bottom + EDGE;
      return Math.min(Math.max(0, b.box.scrollTop + by), b.box.scrollHeight - b.box.clientHeight);
    };
    const far = Math.max(...boxes.map((b) => Math.abs(goal(b, e0) - b.from)));
    const ms = calm() ? 0 : Math.min(1600, 600 + far * 0.7);
    const t0 = performance.now();
    const frame = () => {
      const e = find();
      if (!e) return void (ahead.current = 0);
      const t = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
      const k = (1 - Math.cos(Math.PI * t)) / 2; // eased in and out
      let left = 0;
      for (const b of boxes) {
        const to = goal(b, e);
        b.box.scrollTop = b.from + (to - b.from) * k;
        left += to - b.box.scrollTop;
      }
      ahead.current = left;
      if (t < 1) id = requestAnimationFrame(frame);
      else run();
    };
    frame();
  };
  const USER = ["wheel", "touchstart", "pointerdown"];
  const stop = () => {
    cancelAnimationFrame(id);
    window.clearTimeout(wait);
    ahead.current = 0;
    USER.forEach((u) => removeEventListener(u, stop));
  };
  USER.forEach((u) => addEventListener(u, stop, { passive: true }));
  run();
  return stop;
}

/** Where the card goes: beside a part at the left (a panel: the rest of it stays in view), else under the part if there
 * is room, else over it, else beside it; always on screen. */
function placeCard(r: DOMRect | null, h: number): { left: number; top: number } {
  const vw = window.innerWidth / zoom();
  const vh = window.innerHeight / zoom();
  if (!r) return { left: (vw - CARD_W) / 2, top: vh / 3 };
  if (r.height > vh * 0.6) return { left: vw - CARD_W - 24, top: vh - h - 24 }; // a part as tall as the screen: the card in its corner
  const clampX = (x: number) => Math.min(Math.max(12, x), vw - CARD_W - 12);
  const clampY = (y: number) => Math.min(Math.max(12, y), vh - h - 12);
  // clamped in every case: a part off the screen (the page moved it) never takes the card with it
  if (r.left < vw / 3 && r.width < vw / 3 && r.right + PAD + 10 + CARD_W < vw) return { left: clampX(r.right + PAD + 10), top: clampY(r.top) };
  if (r.bottom + PAD + 10 + h < vh) return { left: clampX(r.left), top: clampY(r.bottom + PAD + 10) };
  if (r.top - PAD - 10 - h > 0) return { left: clampX(r.left), top: clampY(r.top - PAD - 10 - h) };
  if (r.right + PAD + 10 + CARD_W < vw) return { left: clampX(r.right + PAD + 10), top: clampY(r.top) };
  return { left: clampX(r.left - CARD_W - PAD - 10), top: clampY(r.top) };
}

export function Tour({ name, steps, start = 0, onClose }: { name: string; steps: TourStep[]; start?: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [dir, setDir] = useState(1); // the way a missing optional step is passed over
  // the part found for step `i` (none yet while `done` is false): another step's is never shown on this one
  const [found, setFound] = useState<{ i: number; el: HTMLElement | null; done: boolean }>({ i: start, el: null, done: false });
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const ahead = useRef(0); // what the page still scrolls to bring the part into view (glide)
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const el = found.i === i ? found.el : null;
  const looking = found.i !== i || !found.done;
  const last = i === steps.length - 1;
  const close = useRef(onClose); // the caller's, without restarting the step when it is a new function
  close.current = onClose;

  // the step's part: waited for (clicked open once), brought into view; an optional one missing is passed over
  useEffect(() => {
    let clicked = false;
    let acted = false;
    let stop = false;
    let stopGlide = () => {};
    const t0 = performance.now();
    setFound({ i, el: null, done: false });
    if (step.route && window.location.hash !== `#/${step.route}`) window.location.hash = `/${step.route}`;
    // the step's own doing, once its part is shown and the page has scrolled to it: waited for too (a part loaded once in view)
    const act = (sel: string, t1 = performance.now()) => {
      if (stop) return;
      const b = shown(sel);
      if (b && Math.abs(ahead.current) < 1) {
        acted = true;
        return b.click();
      }
      if (performance.now() - t1 < WAIT_MS) window.setTimeout(() => act(sel, t1), 150);
    };
    const look = () => {
      if (stop) return;
      const e = shown(step.target);
      if (e) {
        stopGlide = glide(() => (e.isConnected ? e : shown(step.target)), ahead);
        setFound({ i, el: e, done: true });
        if (step.act) window.setTimeout(() => act(step.act!), 1100); // first seen as it is (the light arrived), then doing
        return;
      }
      if (step.click && !clicked) {
        clicked = true;
        shown(step.click)?.click();
      }
      if (performance.now() - t0 < WAIT_MS) return void window.setTimeout(look, 120);
      if (!step.optional) return setFound({ i, el: null, done: true }); // shown without a part: the text still says it
      const to = i + dir;
      if (to >= 0 && to < steps.length) setI(to);
      else close.current();
    };
    look();
    return () => {
      stop = true;
      stopGlide();
      if ((acted || clicked) && step.undo) shown(step.undo)?.click(); // what it did or opened, back as it was
    };
  }, [i, step, dir, steps.length]);

  // the part's place, followed while it moves (a map flying, a panel scrolling, a card opening); a part the page drew
  // anew (its data come in) is found again. While the next part is looked for the light stays where it was, so it
  // glides on to it (no dark flash between steps); a part not found takes it away.
  useEffect(() => {
    if (!el) return void (found.i === i && found.done && setRect(null));
    let id = 0;
    let cur = el;
    const follow = () => {
      if (!cur.isConnected || !cur.matches(step.target)) cur = shown(step.target) ?? cur; // drawn anew, or no longer it (the old page's tab)
      setRect((was) => {
        const r = rectOf(cur);
        r.y -= ahead.current; // where it will be once the page has scrolled to it
        return was && was.x === r.x && was.y === r.y && was.width === r.width && was.height === r.height ? was : r;
      });
      id = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(id);
  }, [el, step.target, found, i]);

  useEffect(() => next.current?.focus(), [i]);
  const go = (d: number) => {
    if (i + d < 0) return;
    if (i + d >= steps.length) return close.current();
    setDir(d);
    setI(i + d);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return; // the arrows move in a field
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const at = placeCard(rect, card.current?.offsetHeight ?? 180);
  // the target's parts lit apart (step.parts): one dimmed screen with a hole round each; read anew as the target moves
  const holes = rect && step.parts && el ? [...el.querySelectorAll(step.parts)].map(rectOf).filter((r) => r.width && r.height) : [];
  const box = (r: DOMRect) => ({ left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD });
  return createPortal(
    <div className="tour">
      {holes.length ? (
        <>
          <svg className="tour__holes" aria-hidden="true">
            <path
              fillRule="evenodd"
              d={`M-9999,-9999H99999V99999H-9999Z ${holes.map((r) => ((b) => `M${b.left},${b.top}h${b.width}v${b.height}h${-b.width}Z`)(box(r))).join(" ")}`}
            />
          </svg>
          {holes.map((r, k) => (
            <div key={k} className="tour__spot tour__spot--part" style={box(r)} aria-hidden="true" />
          ))}
        </>
      ) : rect ? (
        <div
          className="tour__spot"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }}
          aria-hidden="true"
        />
      ) : (
        !looking && <div className="tour__dim" aria-hidden="true" />
      )}
      <div
        ref={card}
        className="tour__card"
        role="dialog"
        aria-label={`Tour: ${name}`}
        data-step={i + 1}
        data-found={el ? "true" : looking ? "looking" : "false"}
        style={{ left: at.left, top: at.top, width: CARD_W }}
      >
        <div className="tour__head">
          <span className="tour__count">
            {i + 1} / {steps.length}
          </span>
          <button type="button" className="btn btn--xs btn--ghost" onClick={onClose} aria-label="End the tour">
            ✕
          </button>
        </div>
        <div key={i} className="tour__body">
          <b className="tour__title">{step.title}</b>
          <p className="tour__text">{step.text}</p>
        </div>
        <div className="tour__buttons">
          <button type="button" className="btn btn--sm" onClick={() => go(-1)} disabled={i === 0}>
            Back
          </button>
          <button ref={next} type="button" className="btn btn--sm btn--primary" onClick={() => go(1)}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
