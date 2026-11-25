/**
 * German for the whole app, translated by hand (i18n.de.ts: every English text the page shows → its German, with the
 * project's terms; a text with values in it as a pattern, "{0} heat sinks not supplied" → "{0} Wärmesenken nicht
 * versorgt"). The page stays written in English; in German (the language button, this browser's "lang" key) the text
 * on screen is swapped as it appears: every text node and the attributes people read (title, aria-label, placeholder,
 * alt) under document.body, kept up to date while React and Leaflet change them (a MutationObserver). What is not in
 * the dictionary stays English; values typed into fields are no text nodes and stay as typed; an element marked
 * translate="no" (and code) is skipped.
 */
export type Lang = "en" | "de";

const KEY = "lang";
export const LANG: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === "de" ? "de" : "en";
  } catch {
    return "en";
  }
})();

/** Another language: kept in this browser, the page loaded again in it. */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* only for this page */
  }
  location.reload();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The dictionary's lookup, pure: a text's German (its own spaces kept around it), or null when the dictionary has
 * none. In this order: an exact entry; a pattern whose fixed text spans the parts of a text put together at run time
 * (" · ", " › ", " ← ", " → "); any other pattern; the text's parts between those joins, each translated as a text of
 * its own ("Data center: Examples › Recovery · air cooled"); its pieces between ": ", ", " and brackets. A pattern's
 * {0}, {1}… take the text's values, each translated as a text of its own too (a value left in English prose rejects
 * the pattern); the pattern with the longest fixed text wins. `tr.whole`: an entry or a pattern only, no pieces. */
export function translator(dict: Record<string, string>) {
  const exact = new Map<string, string>();
  const spanning: Pattern[] = [];
  const plain: Pattern[] = [];
  for (const [en, de] of Object.entries(dict)) {
    if (!/\{\d+\}/.test(en)) {
      exact.set(en, de);
      continue;
    }
    const parts = en.split(/\{(\d+)\}/); // fixed text, slot, fixed text, …
    const fixed = parts.filter((_, i) => i % 2 === 0);
    if (!/[A-Za-z]{2}/.test(fixed.join(""))) continue; // "{0} {1}" would match any text
    const hint = fixed.reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "");
    const src = parts.map((p, i) => (i % 2 ? "(.*?)" : escape(p))).join(""); // a slot may be empty: "model{1}", 1 model
    const p = { re: new RegExp(`^${src}$`, "s"), to: de, slots: parts.filter((_, i) => i % 2).map(Number), hint };
    (fixed.some((f) => COARSE.test(f)) ? spanning : plain).push(p);
  }
  for (const ps of [spanning, plain]) ps.sort((a, b) => b.hint.length - a.hint.length);
  const byPattern = (core: string, ps: Pattern[]) => {
    for (const p of ps) {
      if (!core.includes(p.hint)) continue;
      const m = p.re.exec(core);
      if (!m) continue;
      const vals: string[] = [];
      p.slots.forEach((slot, i) => (vals[slot] = (tr(m[i + 1])?.trim() ?? m[i + 1])));
      // a value left in English prose ("Get the picture" in "{0} of {1}"), or half translated with English words left:
      // not this pattern's text (a name would have none)
      if (vals.some((v, i) => (v === m[p.slots.indexOf(i) + 1] ? PROSE : ENGLISH_LEFT).test(v))) continue;
      return p.to.replace(/\{(\d+)\}/g, (_, n) => vals[Number(n)] ?? "");
    }
    return null;
  };
  /** The text's pieces between the separators `sep` (kept), each translated; null when none is known. */
  const byPieces = (core: string, sep: RegExp) => {
    const pieces = core.split(sep);
    if (pieces.length < 2) return null;
    let known = false;
    const de = pieces.map((x, i) => {
      if (i % 2 || !x.trim()) return x;
      const t = tr(x);
      if (t == null) return x;
      known = true;
      return t;
    });
    return known ? de.join("") : null;
  };
  const tr = (text: string): string | null => {
    const core = text.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]/.test(core)) return null;
    const lead = text.match(/^\s*/)![0];
    const trail = text.slice(lead.length + text.trim().length);
    const de = whole(core) ?? byPieces(core, COARSE_SPLIT) ?? byPieces(core, FINE_SPLIT);
    return de == null ? null : lead + de + trail;
  };
  const whole = (core: string) => exact.get(core) ?? byPattern(core, spanning) ?? byPattern(core, plain);
  return Object.assign(tr, {
    whole: (text: string) => {
      const core = text.replace(/\s+/g, " ").trim();
      const de = whole(core);
      return de == null ? null : text.match(/^\s*/)![0] + de + text.slice(text.match(/^\s*/)![0].length + text.trim().length);
    },
  });
}

interface Pattern {
  re: RegExp;
  to: string;
  slots: number[];
  hint: string;
}
/** Where a text put together at run time joins its parts, and the finer joins inside a part. */
/** What a name hardly has: an English little word, or three lowercase words in a row. A pattern's value with it,
 * untranslated, is a sentence the pattern only seems to fit. ponytail: a word list, a name with "of" in it ("Bank of …")
 * is left in English. */
const PROSE = /(^|[\s(])(the|a|an|of|to|and|with|from|for|in|on|as|is)(?=[\s).,;:]|$)|\b[a-z]{2,} [a-z]{2,} [a-z]{2,}\b/; // "(the", not "MWh/a"
/** English words German has not: a value translated in part that still has one is half English. */
const ENGLISH_LEFT = /\b(the|of|and|with|from|is|for|this|that|on|against|below|above)\b/;
const COARSE = / · | › | ← | → /;
const COARSE_SPLIT = /( · | › | ← | → )/;
const FINE_SPLIT = /(: |, | \(|\)$)/;

const ATTRS = ["title", "aria-label", "placeholder", "alt", "aria-valuetext"];
const SKIP = '[translate="no"], code, pre, script, style, textarea';

/** The page in German from now on: what is there and everything that comes (see the file's comment). */
export function startGerman(dict: Record<string, string>) {
  const t = translator(dict);
  const ours = new WeakMap<Node, string>(); // the German written into a text node: our own change, not React's
  const en = new WeakMap<Node, string>(); // and the English it stands for
  const oursAttr = new WeakMap<Element, Map<string, string>>();
  const english = (n: Node) => (ours.has(n) && ours.get(n) === n.nodeValue ? en.get(n)! : (n.nodeValue ?? ""));
  const put = (n: Node, de: string, e: string) => {
    if (de === e) ours.delete(n);
    else (ours.set(n, de), en.set(n, e));
    if (n.nodeValue !== de) n.nodeValue = de;
  };
  /** A text node, with the text nodes beside it: React writes `{n} heat sink{s} not supplied` as one node per piece.
   * Piece by piece while each piece with letters has its German (each was written as an entry); else ("s", a name) the
   * run as one text (its German in the first node, the others emptied), when the dictionary has it as an entry or a
   * pattern (pieced together it would read worse than the pieces). */
  const text = (n: Node) => {
    if (n.parentElement?.closest(SKIP)) return;
    let first = n;
    while (first.previousSibling?.nodeType === Node.TEXT_NODE) first = first.previousSibling;
    const run: Node[] = [];
    for (let x: Node | null = first; x?.nodeType === Node.TEXT_NODE; x = x.nextSibling) run.push(x);
    const parts = run.map(english);
    const de = parts.map((p) => t(p));
    const whole = run.length > 1 && parts.some((p, i) => de[i] == null && /[A-Za-z]/.test(p)) ? t.whole(parts.join("")) : null;
    run.forEach((x, i) => put(x, whole != null ? (i ? "" : whole) : (de[i] ?? parts[i]), parts[i]));
  };
  const attr = (el: Element, a: string) => {
    const v = el.getAttribute(a);
    const mine = oursAttr.get(el);
    if (!v || mine?.get(a) === v || el.closest(SKIP)) return;
    const de = t(v);
    if (de != null && de !== v) {
      (mine ?? oursAttr.set(el, new Map()).get(el)!).set(a, de);
      el.setAttribute(a, de);
    }
  };
  const attrs = (el: Element) => ATTRS.forEach((a) => el.hasAttribute(a) && attr(el, a));
  const walk = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return text(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    attrs(root as Element);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      if (n.nodeType !== Node.TEXT_NODE) attrs(n as Element);
      else if (n.previousSibling?.nodeType !== Node.TEXT_NODE) text(n); // a run once, from its first node
  };
  walk(document.body);
  const seen = new MutationObserver((changes) => {
    // React wrote these: their English, even one the same as the German put there (first, before any is rewritten)
    for (const c of changes) if (c.type === "characterData") ours.delete(c.target);
    for (const c of changes)
      if (c.type === "characterData") text(c.target);
      else if (c.type === "attributes") attr(c.target as Element, c.attributeName!);
      else {
        c.addedNodes.forEach(walk);
        const left = [...c.target.childNodes].find((x) => x.nodeType === Node.TEXT_NODE);
        if (c.removedNodes.length && left) text(left); // a piece gone from a run: the rest again
      }
    seen.takeRecords(); // the changes just made here
  });
  seen.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.documentElement.lang = "de";
}
