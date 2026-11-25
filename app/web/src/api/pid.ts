/** P&ID drawings: read one (preview + extraction), use it as a dataset's P&ID, and its plant graph. */
import type { Plant } from "../lib/plantLinks";
import { deleteJson, getJson, postBlob, postFile, putJson, query, scoped, type StructureScope } from "./http";

/** What /api/pid/extract returns (the parts the app shows), in the drawing's screen coordinates. */
export interface Extracted {
  viewBox: string;
  colorRuns: { color: string; points: [number, number][] }[];
  colorNodes: { id: string; kind: string; x: number; y: number; label?: string; name?: string }[];
  colorConnections: unknown[];
  edges: { route: [number, number][] }[];
  stats: { components: number; connections: number; pipeSegments: number; colorRuns: number; nodes: number; edges: number; instruments?: number; elapsedSeconds: number };
  /** instrument bubbles (a circle with an ISA code): where the plant is measured */
  instruments?: { tag: string; x: number; y: number; d: number }[];
  warnings: string[];
  // one plant graph from either extractor path (backend components_of): named equipment and pipe links
  components: { id: string; label: string; x: number; y: number }[];
  links: [string, string][];
  /** the drawing as it is: every stroked line and every text (DEXPI files: none) */
  lines?: { points: [number, number][]; color: string; width: number }[];
  texts?: { text: string; x: number; y: number }[];
}

/** URL of the dataset's P&ID image (404 when it has none); used directly as an <img>/<image> source. */
export const pidImageUrl = (datasetId: string, scope?: StructureScope) => `/api/datasets/${datasetId}/pid.png${query(scoped(scope))}`;

/** The plant graph read from the dataset's P&ID (empty when there is none). */
export const fetchPidPlant = (datasetId: string, scope?: StructureScope) =>
  getJson<Plant>(`/api/datasets/${datasetId}/pid/plant${query(scoped(scope))}`, "Failed to load the P&ID plant");

/** A PDF/SVG drawing rendered as a PNG, for showing under the extraction. */
export const previewPid = (file: File) => postBlob("/api/pid/preview", file, "Preview failed");

/** An area of the page, fractions (x0, y0, x1, y1; y down): only it is read and kept (backend pid/crop.py). */
export type PidArea = [number, number, number, number];
const cropQuery = (area?: PidArea | null, scope?: StructureScope) => query({ crop: area ? area.map((v) => v.toFixed(4)).join(",") : undefined, ...scoped(scope) });

/** Pipes, components and their connections read from a PDF/SVG/DEXPI drawing, or one area of it (nothing is stored). */
export const extractPid = (file: File, area?: PidArea | null) => postFile<Extracted>(`/api/pid/extract${cropQuery(area)}`, file, "Extraction failed");

/** Store a drawing (PDF, SVG, DEXPI or PNG), or one area of it, as the dataset's P&ID, with its plant graph when it can be read. */
export const setPidDrawing = (datasetId: string, file: File, area?: PidArea | null, scope?: StructureScope) =>
  postFile<unknown>(`/api/datasets/${datasetId}/pid${cropQuery(area, scope)}`, file, "Could not save");

/** Remove the P&ID picture, its plant graph and construct (backed up in the data center's .backup folder first). */
export const removePidDrawing = (datasetId: string, scope?: StructureScope) =>
  deleteJson<{ removed: boolean; backup: string | null }>(`/api/datasets/${datasetId}/pid${query(scoped(scope))}`, "Could not remove the P&ID");

/** URL of a view's own picture (`v` changes it after an upload, so the new one is fetched). */
export const pidViewImageUrl = (datasetId: string, view: string, v = 0, scope?: StructureScope) =>
  `/api/datasets/${datasetId}/pid/views/${view}.png${query({ v: v ? String(v) : undefined, ...scoped(scope) })}`;
/** Store a drawing (PDF: its first page, SVG or PNG) as the picture of one view; its size in pixels comes back. */
export const setPidViewPicture = (datasetId: string, view: string, file: Blob, scope?: StructureScope) =>
  postFile<{ view: string; width: number; height: number; bytes: number; backup: string | null; area: unknown; shapes: number; note: string | null }>(`/api/datasets/${datasetId}/pid/views/${view}${query(scoped(scope))}`, file, "Could not save the view's picture");
/** The construct read from a view's picture (fractions of that picture; empty for a PNG). */
export const fetchPidViewConstruct = (datasetId: string, view: string, scope?: StructureScope) =>
  getJson<{ shapes: PidShape[] }>(`/api/datasets/${datasetId}/pid/views/${view}/construct${query(scoped(scope))}`, "Failed to load the view's construct");
/** Remove a view's picture and its construct (backed up first); the view's area stays. */
export const removePidViewPicture = (datasetId: string, view: string, scope?: StructureScope) =>
  deleteJson<{ removed: boolean; backup: string | null }>(`/api/datasets/${datasetId}/pid/views/${view}${query(scoped(scope))}`, "Could not remove the view's picture");

export type ShapeKind = "rect" | "circle" | "line" | "text";
export type ShapeRole = "component" | "instrument" | "pipe" | "note" | "drawing" | ""; // drawing: a line or text of the sheet itself
/** One shape of the P&ID's digital construct; positions are fractions of the drawing (backend/pid/construct.py). */
export interface PidShape {
  id: string;
  kind: ShapeKind;
  x?: number; // rect / circle: centre; text: anchor
  y?: number;
  w?: number; // rect / circle: size
  h?: number;
  points?: [number, number][]; // line
  label: string;
  role: ShapeRole;
  props?: Record<string, string | number>; // the component's values (design data: "capacity_kW": 50, "type": "chiller")
  color?: string; // a drawing shape's own colour (#rrggbb), as on the sheet
}
export interface PidConstruct {
  shapes: PidShape[];
  saved: boolean; // false: a first guess from the drawing, not saved yet
  picture?: boolean; // the structure has a picture (pid.png), on a GET
}

/** The drawing as editable shapes (components, instruments, pipes, notes). */
export const fetchPidConstruct = (datasetId: string, scope?: StructureScope) =>
  getJson<PidConstruct>(`/api/datasets/${datasetId}/pid/construct${query(scoped(scope))}`, "Failed to load the P&ID construct");

/** Replace the construct with these shapes. */
export const savePidConstruct = (datasetId: string, shapes: PidShape[], scope?: StructureScope) =>
  putJson<PidConstruct>(`/api/datasets/${datasetId}/pid/construct${query(scoped(scope))}`, { shapes }, "Could not save the P&ID construct");
