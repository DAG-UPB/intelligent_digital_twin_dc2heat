/** Live link: which changes the open page reacts to. */
import { expect, test } from "vitest";
import { CLIENT_ID, type LiveEvent } from "../api";
import { addDetail, effectOf, snapshotDetail } from "./live";

const changed = (path: string, client: string | null = null): LiveEvent => ({ type: "changed", method: "PUT", path, client });

test("someone else's change to this data center refreshes the page; another data folder reloads it", () => {
  expect(effectOf(changed("/api/datasets/sim_1/site"), "sim_1")).toBe("refresh");
  expect(effectOf(changed("/api/components/my_hex"), "sim_1")).toBe("refresh");
  expect(effectOf(changed("/api/data-versions/current"), "sim_1")).toBe("reload");
});

test("the page's own saves, other data centers and commands are not changes for it", () => {
  expect(effectOf(changed("/api/datasets/sim_1/site", CLIENT_ID), "sim_1")).toBeNull();
  expect(effectOf(changed("/api/datasets/sim_10/site"), "sim_1")).toBeNull();
  expect(effectOf({ type: "request", id: "r1", target: null, action: "message", args: {} }, "sim_1")).toBeNull();
});

test("the page details of every part on screen are merged, and a part that leaves takes its own along", () => {
  const offA = addDetail(() => ({ instruments: 3, unsaved: false }));
  const offB = addDetail(() => ({ modelling: { saved: ["linear"] }, unsaved: true }));
  expect(snapshotDetail()).toEqual({ instruments: 3, modelling: { saved: ["linear"] }, unsaved: true });
  offB();
  expect(snapshotDetail()).toEqual({ instruments: 3, unsaved: false });
  offA();
  expect(snapshotDetail()).toEqual({});
});
