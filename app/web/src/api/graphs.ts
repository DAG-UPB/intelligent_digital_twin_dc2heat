/** Causal graphs of a dataset: graph files, links and their lags. */
import { getJson, postJson, query, scoped, type StructureScope } from "./http";

export interface CausalParent {
  parent: string;
  lag: number;
}

export interface CausalLinkStrength {
  source: string;
  target: string;
  lag: number;
  value: number;
}

export interface CausalGraphResponse {
  source?: string | null;
  targets: Record<string, CausalParent[]>;
  link_strengths?: CausalLinkStrength[];
}

interface CausalGraphSaveRequest {
  file_name?: string;
  targets: Record<string, CausalParent[]>;
  link_strengths?: CausalLinkStrength[];
}

interface CausalGraphSaveResponse {
  dataset_id: string;
  file_name: string;
  file_path: string;
  edge_count: number;
}

export interface LagDiscoveryResult {
  links: { source: string; target: string; lags: number[]; p: Record<string, number> }[];
  self: Record<string, number[]>;
  skipped: { source: string; target: string }[];
  /** Strength of every significant lag (own-past too), as in a graph file; missing from older servers. */
  link_strengths?: CausalLinkStrength[];
}

/** A graph file (the default causal_graph.json when `source` is not given). */
export const fetchCausalGraph = (datasetId: string, source?: string, scope?: StructureScope) =>
  getJson<CausalGraphResponse>(`/api/datasets/${datasetId}/graph${query({ source, ...scoped(scope) })}`, "Failed to fetch graph");

export const fetchCausalGraphFiles = (datasetId: string, scope?: StructureScope) =>
  getJson<{ dataset_id: string; files: string[] }>(`/api/datasets/${datasetId}/graph/files${query(scoped(scope))}`, "Failed to fetch graph files");

export const saveCausalGraph = (datasetId: string, body: CausalGraphSaveRequest, scope?: StructureScope) =>
  postJson<CausalGraphSaveResponse>(`/api/datasets/${datasetId}/graph/save${query(scoped(scope))}`, body, "Failed to save graph");

/** Keep the drawn links; learn which lags of each are significant (PCMCI on those links only). */
export const discoverLinkLags = (
  datasetId: string,
  body: { links: { source: string; target: string }[]; method?: "pcmci" | "pc"; min_lag?: number; max_lag?: number; alpha?: number },
) => postJson<LagDiscoveryResult>(`/api/datasets/${datasetId}/graph/discover-lags`, body, "Lag discovery failed");

/** Inputs the graph suggests for training: variables that only drive others. */
export const fetchSuggestedDrivers = async (datasetId: string, graphFile: string, scope?: StructureScope): Promise<string[]> =>
  (
    await getJson<{ drivers: string[] }>(
      `/api/datasets/${datasetId}/graph/drivers${query({ source: graphFile, ...scoped(scope) })}`,
      "Failed to suggest inputs",
    )
  ).drivers;
