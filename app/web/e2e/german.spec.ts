/**
 * The pages in German (the language button, lib/i18n.ts): German words are longer, so no text may run out of its box
 * (cut off, or over the text beside it) and no English may be left in a sentence (one React writes in pieces among
 * them: "16 Wärmesenkes", "100 % im installed capacity"). Read-only (readonly.ts).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/german.spec.ts --project=app`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

const ROUTES = [
  "twin/map",
  "dc/pid",
  "dc/dashboard",
  "heat/structure",
  "heat/dashboard",
  "district/structure",
  "district/dashboard",
  "twin/matching",
  "twin/planning",
  "help/guide",
  "help/about",
  "help/assistant",
  "home/start",
];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("lang", "de");
    localStorage.setItem("dataset", "sim_recovery_air");
    for (const k of ["source", "sink", "network", "quick"]) localStorage.setItem(`site-card-${k}`, "1"); // every Site card open
  });
  await readOnly(context);
});

/** What reads wrong on the page: words outside their own box or cut off by a box around it, English left in a sentence. */
const problems = () => {
  const out: string[] = [];
  const words = (n: Node) => n.nodeType === Node.TEXT_NODE && /\p{L}{2}/u.test(n.nodeValue ?? "");
  // a letter may reach a little above and below a tight line (line-height 1.1): a fraction of the font size is fine
  const outside = (q: DOMRect, b: DOMRect, dy: number) => q.right > b.right + 2 || q.left < b.left - 2 || q.bottom > b.bottom + dy || q.top < b.top - dy;
  for (const e of document.querySelectorAll<HTMLElement>("body *")) {
    if (
      e.closest("svg, select, option, textarea, pre, code, [translate=no], .sr-only, .leaflet-pane, .leaflet-control-attribution") ||
      ![...e.childNodes].some(words)
    )
      continue;
    const s = getComputedStyle(e);
    if (!e.offsetParent && s.position !== "fixed") continue; // not shown
    if (s.visibility === "hidden" || s.opacity === "0" || s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") continue; // hidden, or cut on purpose
    // the boxes that hold it: its own (a block), and every one around it that cuts off what sticks out
    const boxes: Element[] = s.display.startsWith("inline") && !/block|flex|grid/.test(s.display) ? [] : [e];
    let screenReader = false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const sa = getComputedStyle(a);
      if (sa.clipPath !== "none") screenReader = true;
      if (/hidden|clip/.test(sa.overflowX + sa.overflowY) && sa.webkitLineClamp === "none") boxes.push(a); // a clamp: cut on purpose, whole in its title
    }
    if (screenReader || s.clipPath !== "none") continue;
    for (const n of e.childNodes) {
      if (!words(n)) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const box = boxes.find((b) =>
        [...r.getClientRects()].some((q) => q.width > 0 && outside(q, b.getBoundingClientRect(), Math.max(2, parseFloat(s.fontSize) * 0.3))),
      );
      if (box) out.push(`does not fit (${box.className || box.tagName}): ${(n.nodeValue ?? "").trim().slice(0, 70)}`);
    }
  }
  // English left in a sentence (React writes one in pieces, a text node each: they are read together)
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.previousSibling?.nodeType === Node.TEXT_NODE || n.parentElement?.closest("code, pre, [translate=no], script, style")) continue;
    let joined = "";
    for (let x: Node | null = n; x?.nodeType === Node.TEXT_NODE; x = x.nextSibling) joined += x.nodeValue ?? "";
    if (/\b(the|and|of|with|from|not|as|is|off)\b/.test(joined)) out.push(`English left: ${joined.trim().slice(0, 400)}`);
  }
  return out;
};

for (const route of ROUTES)
  test(`#/${route} in German: every text fits, no English left`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500); // the last cards settle
    expect(await page.evaluate(problems)).toEqual([]);
  });

// the "?" box and the tours in German: the box on every page, every step of every tour (each card read on screen)
const TOURED = [
  "twin/map",
  "twin/matching",
  "twin/planning",
  "dc/dashboard",
  "heat/dashboard",
  "district/dashboard",
  "dc/pid",
  "heat/structure",
  "district/structure",
];

for (const route of ROUTES)
  test(`#/${route} in German: the ? box and the page's tour read in German`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.locator(".topbar__help").click();
    const box = page.locator(".help-pop__box");
    await expect(box).toBeVisible();
    expect(await box.locator(".help-pop__text").innerText(), "the page's line").not.toBe("");
    expect(await page.evaluate(problems)).toEqual([]);
    if (!TOURED.includes(route)) return expect(box.locator(".help-pop__buttons .btn--primary")).toHaveCount(0); // no tour of its own
    await box.locator(".help-pop__buttons .btn--primary").click(); // Explain this page
    const card = page.locator(".tour__card");
    for (let k = 0; k < 40; k++) {
      await expect(card).not.toHaveAttribute("data-found", "looking", { timeout: 15_000 });
      const at = (await card.getAttribute("data-step"))!;
      expect(await card.getAttribute("data-found"), `step ${at}: its part found in German too`).toBe("true");
      await page.waitForTimeout(300);
      expect(await page.evaluate(problems), `step ${at}`).toEqual([]);
      const last = at === (await card.locator(".tour__count").innerText()).split("/")[1].trim();
      await card.locator(".tour__buttons .btn--primary").click();
      if (last) break;
      await expect(card).not.toHaveAttribute("data-step", at);
    }
    await expect(card).toHaveCount(0);
  });

test("the app's tour in German: every step reads in German", async ({ page }) => {
  await page.goto("/#/home/start");
  await page.locator(".topbar__help").click();
  await page.locator(".help-pop__buttons .btn").last().click(); // How to get around the app
  const card = page.locator(".tour__card");
  await expect(card).toContainText("Das System");
  for (let k = 0; k < 40; k++) {
    await expect(card).not.toHaveAttribute("data-found", "looking", { timeout: 15_000 });
    const at = (await card.getAttribute("data-step"))!;
    expect(await card.getAttribute("data-found"), `step ${at}: its part found in German too`).toBe("true");
    await page.waitForTimeout(300);
    expect(await page.evaluate(problems), `step ${at}`).toEqual([]);
    const last = at === (await card.locator(".tour__count").innerText()).split("/")[1].trim();
    await card.locator(".tour__buttons .btn--primary").click();
    if (last) break;
    await expect(card).not.toHaveAttribute("data-step", at);
  }
  await expect(card).toHaveCount(0);
});
