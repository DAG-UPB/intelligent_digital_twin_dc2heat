/** Which graph file Physical structure opens first. */
import { expect, test } from "vitest";
import { pickFile } from "./usePidSources";

test("the physical (modified) graph first, then pcmci, then the default, then any", () => {
  expect(pickFile(["causal_graph.json", "causal_graph_pcmci.json", "causal_graph_modified.json"])).toBe("causal_graph_modified.json");
  expect(pickFile(["causal_graph.json", "causal_graph_pcmci.json"])).toBe("causal_graph_pcmci.json");
  expect(pickFile(["causal_graph.json", "x.json"])).toBe("causal_graph.json");
  expect(pickFile(["x.json"])).toBe("x.json");
  expect(pickFile([])).toBe("causal_graph.json");
});
