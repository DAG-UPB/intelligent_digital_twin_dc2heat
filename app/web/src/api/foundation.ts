/** The pretrained forecaster's demand over a period (backend routers/foundation.py, core/foundation.py). */
import { postJson } from "./http";

export type FoundationMode = "rolling" | "weather";

export interface FoundationRequest {
  column: string;
  start_time: number; // unix seconds
  steps: number; // hours
  mode: FoundationMode; // rolling: day-ahead on the measurement; weather: a year from out_temp
  out_temp?: number[];
}

export interface FoundationResponse {
  model: string;
  mode: FoundationMode;
  history: string; // what each day is forecast from
  time: number[];
  p10: number[];
  p50: number[];
  p90: number[];
}

export const foundationDemand = (datasetId: string, body: FoundationRequest) =>
  postJson<FoundationResponse>(`/api/datasets/${datasetId}/foundation/demand`, body, "The foundation model failed");
