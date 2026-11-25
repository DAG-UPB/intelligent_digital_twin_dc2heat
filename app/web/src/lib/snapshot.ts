/**
 * The page as the assistant sees and touches it (lib/live.ts): every visible control with its name and value, the
 * visible text, images of the drawings and charts, and acting on a control by its name, as a click or an entry
 * would. Works on the rendered page, so every page and every control added later is covered without page code;
 * pages add only what a picture cannot say (useSnapshotDetail) and gestures on drawings (useCommand).
 */

import { getBlob } from "../api";

export interface Control {
  ref: string;
  kind: string;
  name: string;
  value?: string | number | boolean;
  options?: string[];
  on?: boolean; // a pressed / selected / current toggle, tab or link; an open disclosure ("More options", "What if…")
  disabled?: boolean;
  in?: string; // the card or section it is in, for a name the page has more than once (use the ref then)
}

export interface Picture {
  label: string;
  png: string; // base64
  width: number;
  height: number;
  grid?: boolean; // a 0..1 grid over the drawing (x right, y down)
}

// summary: the folded panels (<details>: "More options", "Settings", "What if…"), opened and closed by a click
const SELECTOR =
  'button, a[href], input, select, textarea, summary, [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="menuitem"]';
const REF = "data-live-ref";

const isField = (el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;

function visible(el: HTMLElement): boolean {
  if (el.closest("[hidden], [aria-hidden='true']") || (el instanceof HTMLInputElement && el.type === "hidden")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The name a person (or a screen reader) would use for the control. */
export function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return squash(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by)
    return squash(
      by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    );
  if (isField(el)) {
    const label = el.labels?.[0];
    const own = el instanceof HTMLSelectElement ? el.textContent : "";
    const text = label ? squash(label.textContent).replace(squash(own), "").trim() : "";
    return text || squash(el.getAttribute("placeholder") || el.getAttribute("title") || el.name || el.id);
  }
  return squash(el.textContent) || squash(el.getAttribute("title"));
}

function kindOf(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el instanceof HTMLInputElement) return el.type === "range" ? "slider" : el.type || "text";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el.tagName === "SUMMARY") return "disclosure";
  return el.tagName === "A" ? "link" : "button";
}

function describe(el: HTMLElement, ref: string): Control {
  const c: Control = { ref, kind: kindOf(el), name: nameOf(el) };
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) c.value = el.checked;
  else if (el instanceof HTMLSelectElement) {
    c.value = squash(el.selectedOptions[0]?.textContent);
    c.options = [...el.options].slice(0, 60).map((o) => squash(o.textContent));
  } else if (isField(el)) c.value = el instanceof HTMLInputElement && (el.type === "range" || el.type === "number") ? Number(el.value) : el.value;
  else if (el.hasAttribute("aria-valuenow")) c.value = el.getAttribute("aria-valuetext") ?? Number(el.getAttribute("aria-valuenow")); // a drawn slider
  const on =
    (el.tagName === "SUMMARY" && !!el.parentElement?.hasAttribute("open")) ||
    ["aria-pressed", "aria-selected", "aria-checked", "aria-current", "aria-expanded"].some((a) => {
      const v = el.getAttribute(a);
      return v !== null && v !== "false";
    });
  if (on) c.on = true;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") c.disabled = true;
  return c;
}

/** Every visible control of the page (top bar, page, open dialogs), each tagged with a ref for this snapshot. */
export function controls(root: ParentNode = document.body): Control[] {
  const els = [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter(visible);
  const all = els.map((el, i) => {
    el.setAttribute(REF, `c${i}`);
    return describe(el, `c${i}`);
  });
  // a name the page has more than once (three cards' "More options", "Model"): which card each is in
  const seen = new Map<string, number>();
  for (const c of all) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  all.forEach((c, i) => {
    if ((seen.get(c.name) ?? 0) > 1) {
      const where = containerOf(els[i]);
      if (where) c.in = where;
    }
  });
  return all;
}

/** The name of the card, section or group a control sits in: its aria-label or its heading. */
function containerOf(el: Element): string {
  const box = el.parentElement?.closest("[role=group], [role=radiogroup], section, .card, [role=dialog]");
  if (!box) return "";
  const own = box.getAttribute("aria-label");
  const head = squash(box.querySelector("h1, h2, h3, .card__title, .caps")?.textContent);
  const outer = box.matches("[role=group], [role=radiogroup]") ? containerOf(box) : "";
  return [outer, own || head].filter(Boolean).join(" › ");
}

/** The control a name (or a ref from the last snapshot) means: exact name first, then a unique partial match.
 * "Data center › More options" picks the one in that card (the `in` of a snapshot's control, then its name). */
export function findControl(query: string, root: ParentNode = document.body): HTMLElement {
  const byRef = root.querySelector<HTMLElement>(`[${REF}="${CSS.escape(query)}"]`);
  if (byRef && visible(byRef)) return byRef;
  const at = query.lastIndexOf("›");
  const where = at < 0 ? "" : squash(query.slice(0, at)).toLowerCase();
  const all = [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => visible(el) && (!where || containerOf(el).toLowerCase().includes(where)));
  const q = squash(at < 0 ? query : query.slice(at + 1)).toLowerCase();
  const exact = all.filter((el) => nameOf(el).toLowerCase() === q);
  const partial = exact.length ? exact : all.filter((el) => nameOf(el).toLowerCase().includes(q));
  if (partial.length === 1 || (partial.length > 1 && exact.length > 0)) return partial[0];
  const names = (els: HTMLElement[]) => [...new Set(els.map(nameOf).filter(Boolean))].slice(0, 25).join(" | ");
  if (!partial.length) throw new Error(`No control named "${query}" on this page. Controls: ${names(all)}`);
  throw new Error(`"${query}" matches several controls: ${names(partial)}. Use the exact name or the ref from ui_snapshot.`);
}

/** Press it, as a click would (the control's own handler runs). */
export function press(el: HTMLElement) {
  if ((el as HTMLButtonElement).disabled) throw new Error(`"${nameOf(el)}" is disabled right now`);
  el.click();
}

/** Type a value, set a slider or choose a menu option (by its text or value), as the user would. */
export function fill(el: HTMLElement, value: unknown) {
  if (!isField(el) && el.hasAttribute("aria-valuenow"))
    throw new Error(
      `"${nameOf(el)}" is drawn, not a field: use the page's command for it (ui_snapshot commands lists them, e.g. set_window, set_profile_shape)`,
    );
  if (!isField(el)) throw new Error(`"${nameOf(el)}" is not a field: click it instead`);
  if (el.disabled) throw new Error(`"${nameOf(el)}" is disabled right now`);
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    if (el.checked !== Boolean(value)) el.click();
    return;
  }
  let v = String(value);
  if (el instanceof HTMLSelectElement) {
    const want = squash(v).toLowerCase();
    const opt = [...el.options].find((o) => squash(o.textContent).toLowerCase() === want || o.value === v);
    if (!opt) throw new Error(`"${nameOf(el)}" has no option "${v}". Options: ${[...el.options].map((o) => squash(o.textContent)).join(" | ")}`);
    v = opt.value;
  }
  // React tracks the value it set: go through the element's own setter so it sees the change
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** What is written on the page and in open dialogs (numbers, status messages), shortened. */
export function visibleText(max = 8000): string {
  const parts = [
    document.querySelector<HTMLElement>("main")?.innerText,
    ...[...document.querySelectorAll<HTMLElement>("[role=dialog], [role=status], [role=alert]")].map((d) => d.innerText),
  ];
  const text = parts
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// --- images ---------------------------------------------------------------------------------------------------
const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "display",
  "visibility",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "color",
  "stroke-linecap",
  "stroke-linejoin",
];
const MAX_PX = 1600;

async function dataUrl(href: string): Promise<string | null> {
  try {
    const blob = await getBlob(href, "Image not loaded");
    return await new Promise((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => ok(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** The SVG as a PNG, styles inlined (classes do not survive outside the page) and its images embedded. */
async function svgPicture(svg: SVGSVGElement, grid: boolean): Promise<Omit<Picture, "label"> | null> {
  // a zoomable drawing names its whole extent (data-live-whole): the picture shows all of it, not the zoomed window
  const whole = svg.getAttribute("data-live-whole")?.split(" ").map(Number);
  const vb = whole?.length === 4 ? { width: whole[2], height: whole[3] } : svg.viewBox.baseVal;
  const box = svg.getBoundingClientRect();
  const [vw, vh] = vb && vb.width > 0 ? [vb.width, vb.height] : [box.width, box.height];
  const width = Math.round(Math.min(MAX_PX, Math.max(box.width, vw)));
  const height = Math.round((width * vh) / vw);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (dst[i] as SVGElement).setAttribute("style", STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  });
  for (const img of clone.querySelectorAll("image")) {
    const href = img.getAttribute("href") ?? img.getAttribute("xlink:href");
    const data = href && !href.startsWith("data:") ? await dataUrl(href) : null;
    if (data) img.setAttribute("href", data);
  }
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (whole?.length === 4) clone.setAttribute("viewBox", whole.join(" "));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("preserveAspectRatio", "none"); // the image is the viewBox: x / width is the drawing's 0..1
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((ok, fail) => {
      image.onload = () => ok();
      image.onerror = () => fail(new Error("svg"));
      image.src = url;
    });
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const g = canvas.getContext("2d")!;
    g.fillStyle = getComputedStyle(document.body).backgroundColor || "#fff";
    g.fillRect(0, 0, width, height);
    g.drawImage(image, 0, 0, width, height);
    // the grid's 1.0 down is where the drawing says (data-live-grid-h: a P&ID picture with a tray under it), else the bottom
    const unit = Number(svg.getAttribute("data-live-grid-h")) || vh;
    if (grid) drawGrid(g, width, height, (height * unit) / vh);
    return { png: canvas.toDataURL("image/png").split(",")[1], width, height, grid };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A 0..1 grid every 0.1, labelled, so positions can be read off the picture; `unitH` px is 1.0 down (beyond it, the
 * grid goes on: 1.1, 1.2, ...). */
function drawGrid(g: CanvasRenderingContext2D, w: number, h: number, unitH = h) {
  g.save();
  g.strokeStyle = "rgba(220, 38, 38, 0.35)";
  g.fillStyle = "rgba(185, 28, 28, 0.9)";
  g.font = "12px sans-serif";
  g.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const f = i / 10;
    g.beginPath();
    g.moveTo(f * w, 0);
    g.lineTo(f * w, h);
    g.stroke();
    g.fillText(f.toFixed(1), f * w + 2, 12);
  }
  for (let i = 1; (i / 10) * unitH < h - 1; i++) {
    const y = (i / 10) * unitH;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
    g.fillText((i / 10).toFixed(1), 2, y - 2);
  }
  g.restore();
}

function labelOf(el: Element): string {
  const own = el.getAttribute("aria-label");
  if (own) return own;
  const card = el.closest("section, .card, figure");
  return squash(card?.querySelector("h1, h2, h3, figcaption, .caps")?.textContent) || el.tagName.toLowerCase();
}

/** Images of the page's drawings (SVG) and charts (canvas), largest first; maps (web tiles) cannot be pictured. */
export async function pictures(max = 6): Promise<Picture[]> {
  const main = document.querySelector("main") ?? document.body;
  const big = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width >= 240 && r.height >= 120 && !el.closest("button, .leaflet-container");
  };
  const svgs = [...main.querySelectorAll<SVGSVGElement>("svg")].filter((s) => big(s) && !s.parentElement?.closest("svg"));
  const canvases = [...main.querySelectorAll("canvas")].filter(big);
  const area = (el: Element) => el.getBoundingClientRect().width * el.getBoundingClientRect().height;
  const out: Picture[] = [];
  for (const el of [...svgs, ...canvases].sort((a, b) => area(b) - area(a)).slice(0, max)) {
    if (el instanceof HTMLCanvasElement) {
      try {
        out.push({ label: labelOf(el), png: el.toDataURL("image/png").split(",")[1], width: el.width, height: el.height });
      } catch {
        // a canvas with images from another site cannot be read
      }
    } else {
      const p = await svgPicture(el, el.hasAttribute("data-live-grid"));
      if (p) out.push({ label: labelOf(el), ...p });
    }
  }
  return out;
}
