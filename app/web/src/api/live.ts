/** Live link with the backend (routers/live.py): this page's event stream, its screen-state reports, connection info. */
import { CLIENT_ID, deleteJson, getJson, postJson, putJson } from "./http";

/** A write to the API (by anyone: `client` is the page that made it, null for the assistant), or the assistant's
 * request for one page (`target`) to act or describe itself; the page answers with answerRequest; or an agent
 * connected (Connect AI) or disconnected. */
export type LiveEvent =
  | { type: "changed"; method: string; path: string; client: string | null }
  | { type: "agent"; connected: boolean }
  | { type: "request"; id: string; target: string | null; action: string; args: Record<string, unknown> };

/** The page's answer: ok with what it did, or the error the assistant reads. */
export interface RequestAnswer {
  ok: boolean;
  error?: string;
  did?: string;
  route?: string;
  details?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}

/** What the user is looking at: the assistant reads it (MCP tool ui_state). */
export interface UiReport {
  client?: string;
  focused?: boolean;
  route: string;
  dataset: string;
  data_version?: string | null;
  page: Record<string, unknown>;
}

/** How to start the MCP server on this computer. */
export interface ConnectInfo {
  command: string;
  args: string[];
  cwd: string;
  url: string;
  /** pages of the app listening right now */
  pages: number;
  /** an agent is connected (Connect AI) */
  agent?: boolean;
}

/** The secret this page's event stream gave it in its first message (`hello`, a new one at each reconnect): Connect AI
 * sends it to ask for a code, so only a page that listens gets one (backend core/live.py). */
let secret: string | null = null;
const waiting: ((s: string) => void)[] = [];
const pageSecret = (): Promise<string> =>
  secret
    ? Promise.resolve(secret)
    : new Promise((ok, no) => {
        waiting.push(ok);
        setTimeout(() => no(new Error("The page is not connected to the app yet: try again in a moment")), 10_000);
      });

/** Listen to the backend's live events; the browser reconnects by itself after a restart. `onListening` runs each time
 * the stream is (re)opened: the backend counts a page's reports only while it listens. Returns the close function. */
export function openLiveEvents(onEvent: (e: LiveEvent) => void, onListening?: () => void): () => void {
  const source = new EventSource(`/api/live/events?client=${encodeURIComponent(CLIENT_ID)}`);
  source.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as LiveEvent | { type: "hello"; secret: string };
      if (e.type !== "hello") return onEvent(e);
      secret = e.secret;
      waiting.splice(0).forEach((ok) => ok(e.secret));
      onListening?.();
    } catch {
      // not an event of this app: ignore
    }
  };
  return () => source.close();
}

export const answerRequest = (id: string, answer: RequestAnswer) => putJson<{ taken: boolean }>(`/api/live/answer/${id}`, answer, "Failed to answer the assistant");

export const reportUi = (state: UiReport) => putJson<{ ok: boolean }>("/api/live/ui", state, "Failed to report the screen");

/** Connect AI: a one-time code for the agent (this page asks with its stream's secret: it must be listening), valid for `seconds`. */
export const newPairCode = async () =>
  postJson<{ code: string; seconds: number }>("/api/live/pair-code", { secret: await pageSecret() }, "Failed to get a code");

/** Disconnect the agent: its page tools are refused again. */
export const disconnectAgent = () => deleteJson<{ connected: boolean }>("/api/live/pair", "Failed to disconnect the agent");

export const fetchConnectInfo = () => getJson<ConnectInfo>("/api/live/connect", "Failed to read the connection info");

/** The app's OpenAPI schema: one MCP tool per operation (named after its route function). */
export interface OpenApiSpec {
  paths: Record<string, Record<string, { operationId: string; summary?: string }>>;
}
export const fetchOpenApi = () => getJson<OpenApiSpec>("/api/openapi.json", "Failed to read the API");
