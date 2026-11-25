/**
 * The assistant's requests to this tab (lib/live.ts): describe the page (ui_snapshot), press or fill a control by
 * its name, open a page or a data center, show a note, or a page's own gesture (useCommand). Controls are pressed
 * and filled on the rendered page, so the page's own handlers run: the assistant and the user do the same thing.
 */
import type { RequestAnswer } from "../api";
import { DATASET, switchDataset } from "../dataset";
import { pageCommands, runCommand, screenState, snapshotDetail } from "../lib/live";
import { controls, fill, findControl, nameOf, pictures, press, visibleText } from "../lib/snapshot";

/** An answer, plus what to do once it is sent (opening a data center reloads the page). */
export type Handled = RequestAnswer & { after?: () => void };

const route = () => window.location.hash.replace(/^#\/?/, "") || "home/start";
/** Time for React to re-render and a lazy page to load after an action. */
const settle = () => new Promise((ok) => setTimeout(ok, 300));

export async function handleRequest(action: string, args: Record<string, unknown>, note: (text: string) => void): Promise<Handled> {
  switch (action) {
    case "snapshot":
      return {
        ok: true,
        snapshot: {
          ...screenState(),
          route: route(),
          dataset: DATASET,
          controls: controls(),
          text: visibleText(),
          detail: snapshotDetail(),
          commands: pageCommands(), // the page's own gestures (ui_do), besides click, fill, navigate, open_dataset, message
          images: args.images === false ? [] : await pictures(),
        },
      };
    case "click": {
      const el = findControl(String(args.control));
      const name = nameOf(el);
      press(el);
      await settle();
      return { ok: true, did: `pressed "${name}"`, route: route(), details: { control: name } };
    }
    case "fill": {
      const el = findControl(String(args.control));
      const name = nameOf(el);
      fill(el, args.value);
      await settle();
      return { ok: true, did: `set "${name}" to ${JSON.stringify(args.value)}`, route: route(), details: { control: name, value: args.value } };
    }
    case "navigate":
      window.location.hash = `#/${String(args.route).replace(/^#?\/?/, "")}`;
      await settle();
      return { ok: true, did: `opened ${route()}`, route: route() };
    case "open_dataset":
      return { ok: true, did: `opening ${String(args.dataset)}: the page reloads`, route: route(), after: () => switchDataset(String(args.dataset)) };
    case "scroll": {
      // a part loaded only once it is scrolled near (Modelling under a structure), or one the user should see
      const to = String(args.to);
      const main = document.querySelector("main") ?? document.body;
      const parts = [...main.querySelectorAll<HTMLElement>("section[aria-label], [role=region][aria-label], h1, h2, h3, .card__title")];
      const nameOf = (e: HTMLElement) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().toLowerCase();
      const want = to.toLowerCase();
      const el =
        to === "top"
          ? main.firstElementChild
          : to === "bottom"
            ? main.lastElementChild
            : (parts.find((e) => nameOf(e) === want) ?? parts.find((e) => nameOf(e).includes(want)));
      if (!el) throw new Error(`No section "${to}" on this page: give top, bottom, or a section's name (a card title or heading)`);
      el.scrollIntoView({ block: to === "bottom" ? "end" : "start" });
      await settle();
      return { ok: true, did: `scrolled to ${to}`, route: route() };
    }
    case "message":
      note(String(args.text));
      return { ok: true, did: "showed the note", route: route() };
    default: {
      const did = await runCommand(action, args);
      await settle();
      return { ok: true, did: typeof did === "string" ? did : action, route: route() };
    }
  }
}
