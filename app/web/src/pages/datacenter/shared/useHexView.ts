/**
 * Which variables the Scenarios lists and the causal mini maps show, like the Physical structure page: the
 * heat-recovery option of site.json hex_option keeps its T_in, T_out and m; the other option's columns and every
 * calculated column (dataset.json "derived", the HEX heat Q) are hidden. The selected option's Q can still be plotted: simulate computes it.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchSite, type DatasetInfo } from "../../../api";
import { DATASET, configOf, datasetConfig, type DatasetConfig } from "../../../dataset";
import { hiddenColumns, otherOptionColumns } from "../../../lib/sourceMap";

export interface HexView {
  config: DatasetConfig | null;
  hidden: Set<string>; // not a graph node, not a signal, not an intervention
  calculated: string[]; // the selected option's calculated columns (plottable from a model that predicts their parts)
}

/**
 * null until dataset.json and site.json are loaded (a failed load hides nothing). `dataset`: the one picked on the
 * page (AI modelling has its own picker); left out, the app's data center.
 */
export function useHexView(dataset?: DatasetInfo | null): HexView | null {
  const [loaded, setLoaded] = useState<{ config: DatasetConfig | null; hex: string } | null>(null);
  useEffect(() => {
    setLoaded(null); // another dataset: nothing of the previous one's option stays hidden or shown meanwhile
    if (dataset === null) return;
    let live = true;
    const config = dataset ? Promise.resolve(configOf(dataset)) : datasetConfig().catch(() => null);
    const hex = fetchSite(dataset?.id ?? DATASET).then((s) => s.hex_option ?? "condenser", () => "condenser");
    Promise.all([config, hex]).then(([config, hex]) => live && setLoaded({ config, hex }));
    return () => {
      live = false;
    };
  }, [dataset]);
  return useMemo(() => {
    if (!loaded) return null;
    const { config, hex } = loaded;
    const other = otherOptionColumns(config?.heat_source, hex);
    return { config, hidden: hiddenColumns(config, hex), calculated: Object.keys(config?.derived ?? {}).filter((c) => !other.has(c)) };
  }, [loaded]);
}
