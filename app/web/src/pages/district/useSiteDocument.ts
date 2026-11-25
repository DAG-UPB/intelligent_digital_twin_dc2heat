/**
 * The Site map's document: the site (site.json) as loaded, or as this browser kept its unsaved edits (siteDraft.ts),
 * whether it has unsaved edits, an edit, Save and Discard. Unsaved edits are kept in this browser as they are made.
 * The Blank example is never overwritten (the server refuses it): Save keeps its edits as a project file instead.
 * `setStatus` takes what each says (the page's toast).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSite, saveProject, saveSite, type Site } from "../../api";
import { DATASET } from "../../dataset";
import { errorMessage } from "../../lib/errors";
import { draftOf, dropDraft, keepDraft } from "./siteDraft";

export function useSiteDocument(setStatus: (s: string | null) => void) {
  const [site, setSite] = useState<Site | null>(null);
  const [dirty, setDirty] = useState(false);

  // the same function every render: the map's drawing effect lists it and must not redraw for it
  const update = useCallback((fn: (s: Site) => Site) => {
    setSite((s) => (s ? fn(s) : s));
    setDirty(true);
  }, []);

  useEffect(() => {
    fetchSite(DATASET)
      .then((saved) => {
        const kept = draftOf(DATASET);
        setSite(kept ?? saved);
        if (kept) {
          setDirty(true);
          setStatus("Your unsaved edits, kept in this browser: Save keeps them in the site");
        }
      })
      .catch((e) => setStatus(errorMessage(e)));
  }, [setStatus]); // once: the page's state setter does not change

  const blank = DATASET === "sim_blank"; // the Blank case: it stays blank, a project file takes its edits
  /** Save the site; whether it worked (the status says why not). Saved, this browser's draft of it goes. */
  const siteNow = useRef(site);
  siteNow.current = site;
  const save = async () => {
    const sent = site;
    if (!sent) return false;
    try {
      let back: Site;
      if (blank) {
        const r = await saveProject(DATASET, sent);
        back = await fetchSite(DATASET); // Blank as it is: empty
        setStatus(`Blank stays blank; kept as a project file: ${r.path} (Open project loads it again)`);
      } else {
        back = await saveSite(DATASET, sent);
        setStatus("Saved");
      }
      // an edit made while the request was out stays (and stays unsaved, its draft kept): only the sent site is replaced
      setSite((cur) => (cur === sent ? back : cur));
      if (siteNow.current === sent) {
        setDirty(false);
        dropDraft(DATASET);
      }
      return true;
    } catch (e) {
      setStatus(errorMessage(e));
      return false;
    }
  };

  /** The bin: the unsaved edits go, the saved site comes back. */
  const discard = async () => {
    dropDraft(DATASET);
    try {
      setSite(await fetchSite(DATASET));
      setDirty(false);
      setStatus("Discarded: the saved site");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };
  // unsaved edits are kept in this browser (siteDraft.ts): leaving the page or reloading and coming back finds them
  useEffect(() => {
    if (dirty && site) keepDraft(DATASET, site);
  }, [dirty, site]);

  return { site, dirty, update, save, discard, blank };
}
