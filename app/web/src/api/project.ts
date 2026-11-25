/** Project files: everything built on a dataset (site, graphs, P&ID plant, equations, models) as one JSON. */
import { postJson } from "./http";
import type { Site } from "./site";

/** Save the project state into the data folder (status/<dc>/<dc>-project-<time>.json); every save is a new file.
 * `site`: the Site map's unsaved edits, into the file as its site.json (the data center's own is not changed). */
export const saveProject = (datasetId: string, site?: Site) =>
  postJson<{ path: string; files: number }>(`/api/datasets/${datasetId}/project/save`, site ? { site } : {}, "Failed to save the project");

/** Replace the dataset's project files with a saved project; the current ones are backed up. */
export const openProject = (datasetId: string, project: unknown) =>
  postJson<{ files: number; backup: string }>(`/api/datasets/${datasetId}/project`, project, "Failed to open the project");
