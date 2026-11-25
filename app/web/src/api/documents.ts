/** The user's documents about a data center's physical structure, kept as they are (backend routers/documents.py). */
import { deleteJson, getJson, postFile, putJson, query } from "./http";

export interface DataCenterDocument {
  name: string;
  path: string; // where the file is on this machine (an assistant reads it from there)
  bytes: number;
  modified: string;
  note: string; // what it holds
  view: string; // the id of the P&ID view it is about; "" the whole data center
}

const base = (datasetId: string) => `/api/datasets/${datasetId}/documents`;
/** URL of a document's file, to open it in the browser. */
export const documentUrl = (datasetId: string, name: string) => `${base(datasetId)}/${encodeURIComponent(name)}`;

export const fetchDocuments = (datasetId: string) =>
  getJson<{ documents: DataCenterDocument[]; about: string }>(base(datasetId), "Failed to list the documents");
/** Keep any file under its name, as it is (one of the same name is backed up first). */
export const uploadDocument = (datasetId: string, file: File, note: string, view: string) =>
  postFile<{ name: string; path: string; bytes: number; backup: string | null }>(
    `${documentUrl(datasetId, file.name)}${query({ note: note || undefined, view: view || undefined })}`,
    file,
    "Could not keep the document",
  );
export const setDocumentInfo = (datasetId: string, name: string, note: string, view: string) =>
  putJson<{ name: string; note: string; view: string }>(`${documentUrl(datasetId, name)}/info`, { note, view }, "Could not save the note");
/** Remove a document (backed up in the data center's .backup folder first). */
export const removeDocument = (datasetId: string, name: string) =>
  deleteJson<{ removed: boolean; backup: string | null }>(documentUrl(datasetId, name), "Could not remove the document");
