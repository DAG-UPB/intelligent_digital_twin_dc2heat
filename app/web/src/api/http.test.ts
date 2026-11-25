/** Errors carry FastAPI's `detail`; bodies and methods are what the backend expects; the datasets' reads are kept in memory
 * (asked once, emptied by a save but not by a compute-only POST, each caller its own copy, a failure not kept). */
import { afterEach, expect, test, vi } from "vitest";
import { clearCache, getJson, postJson, putJson, query, CLIENT_ID, COMPUTE_ONLY } from "./http";

afterEach(() => {
  clearCache();
  vi.unstubAllGlobals();
});
const answer = (body: string, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));

test("JSON back on success", async () => {
  answer('{"a":1}');
  expect(await getJson("/x", "Load")).toEqual({ a: 1 });
});

test.each([
  ['{"detail":"Dataset not found"}', 404, "Load: Dataset not found"],
  ['{"detail":[{"msg":"field required"},{"msg":"bad lag"}]}', 422, "Load: field required; bad lag"],
  ["Internal Server Error", 500, "Load: Internal Server Error"],
  ["", 502, "Load: 502"],
])("error %s (%d) -> %s", async (body, status, message) => {
  answer(body, status);
  await expect(getJson("/x", "Load")).rejects.toThrow(message);
});

test("post and put send JSON", async () => {
  answer("{}");
  await postJson("/p", { a: 1 }, "Save");
  await putJson("/q", [2], "Save");
  const calls = vi.mocked(fetch).mock.calls;
  // every request names this page (live link: the page ignores its own change events)
  expect(calls[0]).toEqual(["/p", { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID }, body: '{"a":1}' }]);
  expect(calls[1][1]).toMatchObject({ method: "PUT", body: "[2]" });
});

test("query drops empty params", () => {
  expect(query({ file: "a b", columns: "" })).toBe("?file=a+b");
  expect(query({ source: undefined })).toBe("");
});

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, statusText: "", text: async () => JSON.stringify(body), json: async () => body });

test("a dataset's read is asked once, its answer a copy for each caller", async () => {
  const fetch = vi.fn(async () => reply({ rows: [1, 2] }));
  vi.stubGlobal("fetch", fetch);
  const a = await getJson<{ rows: number[] }>("/api/datasets/x/data", "read");
  a.rows.push(3); // a caller changing its own
  const b = await getJson<{ rows: number[] }>("/api/datasets/x/data", "read");
  expect(b.rows).toEqual([1, 2]);
  expect(fetch).toHaveBeenCalledTimes(1);
  await getJson("/api/data-versions", "not a dataset's read: always asked");
  await getJson("/api/data-versions", "not a dataset's read: always asked");
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("a save empties it, a compute-only POST does not; a failure is asked again", async () => {
  const fetch = vi.fn(async () => reply({}));
  vi.stubGlobal("fetch", fetch);
  await getJson("/api/datasets/x/site", "read");
  await postJson("/api/datasets/x/models/xgb/simulate", {}, "compute");
  await getJson("/api/datasets/x/site", "read");
  expect(fetch).toHaveBeenCalledTimes(2); // kept across the simulation
  await putJson("/api/datasets/x/site", {}, "save");
  await getJson("/api/datasets/x/site", "read");
  expect(fetch).toHaveBeenCalledTimes(4); // read again after the save

  fetch.mockImplementationOnce(async () => reply({ detail: "down" }, false));
  await expect(getJson("/api/datasets/y/site", "read")).rejects.toThrow("down");
  await getJson("/api/datasets/y/site", "read");
  expect(fetch).toHaveBeenCalledTimes(6);
});

test("an Evaluate keeps the cache, and the stored evaluation it may write is never read from it", async () => {
  const fetch = vi.fn(async () => reply({}));
  vi.stubGlobal("fetch", fetch);
  await getJson("/api/datasets/x/site", "read");
  await getJson("/api/datasets/x/models/evaluation?scope=heat", "read");
  await postJson("/api/datasets/x/models/evaluate?scope=heat", {}, "compute");
  await getJson("/api/datasets/x/site", "read"); // kept
  await getJson("/api/datasets/x/models/evaluation?scope=heat", "read"); // asked again
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(COMPUTE_ONLY.test("/api/datasets/x/models/train")).toBe(false);
  expect(COMPUTE_ONLY.test("/api/datasets/x/models/evaluate")).toBe(true);
});
