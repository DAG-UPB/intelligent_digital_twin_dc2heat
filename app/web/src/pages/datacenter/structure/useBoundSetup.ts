/** A structure's setup bound to the page's data center (bindSetup): null until its columns are known. */
import { useEffect, useState } from "react";
import { fetchDatasets, fetchSite } from "../../../api";
import { configOf, DATASET } from "../../../dataset";
import { bindSetup, renameFor } from "./bindSetup";
import type { StructureSetup } from "./structureSetup";

export function useBoundSetup(setup: StructureSetup): StructureSetup | null {
  const [bound, setBound] = useState<StructureSetup | null>(null);
  useEffect(() => {
    let live = true;
    // the heat exchanger the data center uses (its site.json hex_option) is the one the heat distribution starts on
    Promise.all([
      fetchDatasets(),
      fetchSite(DATASET).then(
        (s) => s.hex_option ?? undefined,
        () => undefined,
      ),
    ]).then(
      ([r, hex]) => {
        const d = r.datasets.find((x) => x.id === DATASET);
        if (live) setBound(bindSetup(setup, renameFor(d?.columns ?? [], configOf(d), hex)));
      },
      () => live && setBound(setup), // the list failed: the generic names, as before
    );
    return () => {
      live = false;
    };
  }, [setup]);
  return bound;
}
