/** Prepared variables (backend/routers/prepare.py): new columns made from the data, kept next to it (never in it). */
import { deleteJson, postJson, query } from "./http";

export interface PreparedStep {
  name: string;
  op: string;
  inputs: string[];
  params: Record<string, unknown>;
  scope?: "dc" | "heat" | "district"; // the part it is made for (none: the data center's)
}

export interface PreparedPreview {
  name: string;
  inputs: string[];
  count: number;
  missing: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  time: string[];
  values: (number | null)[];
  histogram: { edges: number[]; counts: number[] };
}

/** What changed: the step added (null when removing), the recipe now and the files written in the data folder. */
export interface PreparedChange {
  did: string;
  step: PreparedStep | null;
  recipe: PreparedStep[];
  files: string[];
}

/** Aggregate a delivered data file to a coarser step, each variable by its method; a new data file in silver. */
export interface ResampleRequest {
  step: string;
  default: string;
  methods: Record<string, string>;
  source?: string;
  name?: string;
}

export const addResampled = (datasetId: string, body: ResampleRequest) =>
  postJson<PreparedChange>(`/api/datasets/${datasetId}/resampled`, body, "Could not aggregate the data");

/** Keep one period of a delivered data file (all or some variables) as a new data file in silver; a file too big
 * to load is read in chunks for it. */
export interface WindowRequest {
  start: string; // first time kept
  end: string; // first time no longer kept
  columns?: string[]; // empty: all
  source?: string;
  name?: string;
}
export const addWindow = (datasetId: string, body: WindowRequest) =>
  postJson<PreparedChange>(`/api/datasets/${datasetId}/window`, body, "Could not keep that period");

export const removeResampled = (datasetId: string, name: string) =>
  deleteJson<PreparedChange>(`/api/datasets/${datasetId}/resampled/${encodeURIComponent(name)}`, "Could not remove the file");

export const previewPrepared = (datasetId: string, step: PreparedStep, file?: string) =>
  postJson<PreparedPreview>(`/api/datasets/${datasetId}/prepared/preview${query({ file })}`, step, "Preview failed");

export const addPrepared = (datasetId: string, step: PreparedStep) =>
  postJson<PreparedChange>(`/api/datasets/${datasetId}/prepared`, step, "Could not prepare the variable");

export const removePrepared = (datasetId: string, name: string) =>
  deleteJson<PreparedChange>(`/api/datasets/${datasetId}/prepared/${encodeURIComponent(name)}`, "Could not remove the variable");
