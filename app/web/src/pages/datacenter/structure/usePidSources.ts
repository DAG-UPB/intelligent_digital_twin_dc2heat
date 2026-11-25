/**
 * What the Physical structure page draws from, loaded once: the graph files (and which one to open), the data
 * columns and dataset.json, and which diagram to show. With a P&ID image the diagram becomes "paper" once the image
 * has loaded (its height is needed for the layout); otherwise, or when it fails, the built-in "drawn" one.
 * Also the mean of every calculated column (dataset.json "derived", the HEX heat Q), computed from its parts.
 */
import { useEffect, useState } from "react";
import { fetchCausalGraphFiles, fetchDatasets, fetchPidConstruct, fetchPidPlant, fetchTimeSeriesData, pidImageUrl, type StructureScope } from "../../../api";
import { configOf, DATASET, type DatasetConfig } from "../../../dataset";
import { errorMessage } from "../../../lib/errors";
import type { Plant } from "../../../lib/plantLinks";
import { derivedQ } from "../../../lib/sourceMap";
import { W } from "./geometry";
import type { Diagram } from "./layout";

/** The physical (modified) graph first when the data center has one, then the pcmci graph (learned lags), then the
 * default graph, then any. */
const PREFERRED = ["causal_graph_modified.json", "causal_graph_pcmci.json", "causal_graph.json"];
export const pickFile = (files: string[]) => PREFERRED.find((f) => files.includes(f)) ?? files[0] ?? "causal_graph.json";

/** `scope`: whose structure (PidPage): its graph files and its picture. */
export function usePidSources(scope: StructureScope, onError: (message: string) => void) {
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [cfg, setCfg] = useState<DatasetConfig>(configOf(undefined));
  const [imgH, setImgH] = useState<number | null>(null); // paper image height at width W, null: no image
  const [diagram, setDiagram] = useState<Diagram | null>(null); // null until the config (and image) are known
  const [plant, setPlant] = useState<Plant>({ components: [], links: [], pipes: [] }); // read from the imported drawing
  const [qMean, setQMean] = useState<Record<string, number>>({}); // derived column -> mean over the first data file

  /** The picture and the plant graph read from it; the diagram becomes "paper" once the picture has loaded. */
  const showPicture = () => {
    fetchPidPlant(DATASET, scope)
      .then((p) => p.components?.length && setPlant(p))
      .catch(() => {}); // no plant graph: the image is shown alone
    const im = new Image();
    im.onload = () => {
      setImgH((W * im.naturalHeight) / im.naturalWidth);
      setDiagram("paper");
    };
    im.onerror = () => setDiagram("drawn");
    im.src = pidImageUrl(DATASET, scope);
  };

  useEffect(() => {
    fetchCausalGraphFiles(DATASET, scope)
      .then((r) => {
        setFiles(r.files);
        setFile(pickFile(r.files));
      })
      .catch(() => setFile("causal_graph.json"));

    // one /api/datasets call gives both the columns and dataset.json
    fetchDatasets()
      .then((r) => r.datasets.find((d) => d.id === DATASET))
      .catch((e) => {
        onError(errorMessage(e));
        return undefined;
      })
      .then((d) => {
        const c = configOf(d);
        setColumns(d?.columns ?? []);
        setCfg(c);
        const derived = Object.entries(c.derived ?? {}).filter(([, x]) => [x.m, x.t_in, x.t_out].every((col) => d?.columns.includes(col)));
        if (d && derived.length)
          fetchTimeSeriesData(DATASET, d.files[0], [...new Set(derived.flatMap(([, x]) => [x.m, x.t_in, x.t_out]))])
            .then((r) => {
              // gaps (null) become NaN, so the steps with a gap in any part drop out of the mean
              const cols = Object.fromEntries(Object.entries(r.columns).map(([k, v]) => [k, (v as (number | null)[]).map((y) => y ?? NaN)]));
              const mean = (xs: number[]) => {
                const ok = xs.filter(Number.isFinite);
                return ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length);
              };
              setQMean(Object.fromEntries(derived.map(([k, x]) => [k, mean(derivedQ(x, cols))])));
            })
            .catch(() => {}); // the read-out then shows the formula only
        if (scope !== "dc")
          // another structure: its construct says whether it has a picture (dataset.json is the data center's)
          return void fetchPidConstruct(DATASET, scope)
            .then((k) => (k.picture ? showPicture() : setDiagram("drawn")))
            .catch(() => setDiagram("drawn"));
        if (!c.pid_image) return setDiagram("drawn");
        showPicture();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  return { files, setFiles, file, setFile, columns, cfg, imgH, diagram, setDiagram, plant, qMean };
}
