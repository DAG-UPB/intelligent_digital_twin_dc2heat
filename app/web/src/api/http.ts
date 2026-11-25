/**
 * The one place the app talks HTTP to its backend. Every call is same-origin (FastAPI serves the page
 * and the API; Vite proxies /api in dev). A failed call throws `Error("<what>: <reason>")`, where the
 * reason is FastAPI's `detail` when the response has one, so pages can show it as is (lib/errors.ts errorMessage).
 */

/** Readable reason of a failed response: FastAPI `detail` (string, or the messages of a 422), else the body text. */
async function reasonOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg ?? JSON.stringify(d)).join("; ");
    if (detail !== undefined) return JSON.stringify(detail);
  } catch {
    // not JSON: use the text as it is
  }
  return text || `${res.status} ${res.statusText}`.trim();
}

/** This page's id, sent with every request: the backend tags its change events with it, so the page ignores its own
 * saves and refreshes only for someone else's (the assistant's, over MCP). See lib/live.ts. */
export const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? `page-${Math.random().toString(36).slice(2)}`;

async function send(url: string, what: string, init?: RequestInit): Promise<Response> {
  if (init?.method && init.method !== "GET" && !COMPUTE_ONLY.test(url) && !LIVE.test(url)) clearCache(); // a save: what was read may have changed
  const res = await fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "X-Client-Id": CLIENT_ID } });
  if (!res.ok) throw new Error(`${what}: ${await reasonOf(res)}`);
  return res;
}

/**
 * The datasets' reads, kept in memory: a page opened again, or a second part of a page asking for the same (the time
 * series is asked for by several), gets them at once; the same read under way is shared. Kept as the text, parsed for
 * each caller (none can change another's). Emptied by every save (a request that is not a read or a compute-only one),
 * by someone else's change (App's live link: clearCache) and after CACHE_MS.
 */
const CACHE_MS = 120_000;
const CACHE_MAX = 40; // reads kept, the oldest dropped first (a year of hourly data is a few MB each)
const CACHED = /^\/api\/datasets(\/|\?|$)/;
// an outside service's answer of the moment; the stored evaluation, which an Evaluate (compute-only, keeps the cache)
// may write beside the models
const NOT_CACHED = /\/weather\/|\/models\/evaluation(\?|$)/;
/** POSTs that only compute and write no data (backend core/live.py COMPUTE_ONLY, its dataset and component routes): they
 * keep the cache, and the e2e specs' read-only guard lets them through (e2e/readonly.ts). Evaluate with `store` keeps
 * its answer as models/evaluation.json, a cache of what was computed (NOT_CACHED above). */
export const COMPUTE_ONLY =
  /\/api\/(datasets\/[^/]+\/(models\/evaluate|models\/[^/]+\/simulate|equations\/check|graph\/discover-lags|prepared\/preview|models\/estimate|models\/compare|foundation\/demand)|components\/(check|simulate|fit))(\?|$)/;
const LIVE = /\/api\/live\//; // the live link (the page's screen, the assistant's requests, Connect AI): no data
const cache = new Map<string, { at: number; text: Promise<string> }>();
export function clearCache() {
  cache.clear();
}
function cachedText(url: string, what: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const text = send(url, what).then((r) => r.text());
  cache.set(url, { at: Date.now(), text });
  text.catch(() => cache.get(url)?.text === text && cache.delete(url)); // a failure is asked again next time
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return text;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getJson = async <T>(url: string, what: string): Promise<T> =>
  CACHED.test(url) && !NOT_CACHED.test(url) ? JSON.parse(await cachedText(url, what)) : (await send(url, what)).json();
export const postJson = async <T>(url: string, body: unknown, what: string): Promise<T> => (await send(url, what, jsonInit("POST", body))).json();
export const putJson = async <T>(url: string, body: unknown, what: string): Promise<T> => (await send(url, what, jsonInit("PUT", body))).json();
export const deleteJson = async <T>(url: string, what: string): Promise<T> => (await send(url, what, { method: "DELETE" })).json();
/** POST a file as the raw body (no multipart), JSON back. */
export const postFile = async <T>(url: string, file: Blob, what: string): Promise<T> => (await send(url, what, { method: "POST", body: file })).json();
/** GET a binary (e.g. an image). */
export const getBlob = async (url: string, what: string): Promise<Blob> => (await send(url, what)).blob();
/** POST a file as the raw body, a binary (e.g. an image) back. */
export const postBlob = async (url: string, file: Blob, what: string): Promise<Blob> => (await send(url, what, { method: "POST", body: file })).blob();

/** Whose structure a P&ID, graph or site call is about: the data center's own (dc, the default), the heat
 * distribution's (heat) or the district's (district): each its own folder in silver, backend deps.get_structure). */
export type StructureScope = "dc" | "heat" | "district";
/** The query part for a scope: nothing for the data center's own, so its URLs stay as they were. */
export const scoped = (scope?: StructureScope) => (scope && scope !== "dc" ? { scope } : {});

/** `?a=1&b=2` from the defined, non-empty params ("" when none). */
export function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return q ? `?${q}` : "";
}
