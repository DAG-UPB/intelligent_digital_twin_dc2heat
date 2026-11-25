/** Data folders: the version folders of the user's data root and the examples (backend/routers/data_versions.py). */
import { getJson, postJson, putJson, query } from "./http";

/** A data center of a data folder, from its folder name and dataset.json. */
export interface DataFolderEntry {
  id: string;
  name: string;
  kind: string;
  example?: boolean; // one of the examples (app/data), listed in every project
}

export interface DataVersions {
  /** "local" (the examples, app/data) or the name of a version folder */
  current: string;
  versions: string[];
  /** a version's own name (its project.json "name"), by folder; the others show as "Version N" */
  names?: Record<string, string>;
  /** app/data_versions is linked on this machine */
  linked: boolean;
  /** the folder app/data_versions points at; null if not linked */
  root: string | null;
  /** the data centers of every version and of "local" */
  folders: Record<string, DataFolderEntry[]>;
}

/** One folder of this computer for the folder picker: its sub-folders (names only, never files). */
export interface FolderListing {
  path: string;
  parent: string | null;
  folders: string[];
  /** its sub-folders named like version_1: non-empty for a data folder */
  versions: string[];
}

/** The sub-folders of `path`; without one, of the current data folder (else the home folder). */
export const browseFolders = (path?: string) => getJson<FolderListing>(`/api/data-versions/browse${query({ path })}`, "Failed to open the folder");

/** Open this computer's own folder dialog (Finder on macOS) and wait; null when cancelled. */
export const pickFolder = () => postJson<{ path: string | null }>("/api/data-versions/pick", {}, "Could not open the folder dialog");

export const fetchDataVersions = () => getJson<DataVersions>("/api/data-versions", "Failed to fetch the data folders");

export const putDataVersion = (version: string) =>
  putJson<DataVersions>("/api/data-versions/current", { version }, "Failed to switch the data version");

export const putDataRoot = (path: string) => putJson<DataVersions>("/api/data-versions/root", { path }, "Failed to change the data folder");

/** What a folder would bring as a new data center (names relative to it); nothing is read or copied yet. */
export interface FolderScan {
  id: string;
  name: string;
  kind: string;
  data: string[];
  drawing: string | null;
  graphs: string[];
  settings: string | null;
}
export const scanFolder = (path: string) => getJson<FolderScan>(`/api/data-versions/scan${query({ path })}`, "Could not read the folder");

export interface ImportedDataCenter {
  id: string;
  data: string[];
  variables: number;
  graphs: string[];
  pid: { components: number; error?: string } | null;
}
/** Add the folder as a new data center of the data version open (the folder itself is not changed). */
export const importDataCenter = (body: { path: string; id: string; name: string; kind: string; read_pid: boolean }) =>
  postJson<ImportedDataCenter>("/api/data-versions/import", body, "Could not add the data center");
