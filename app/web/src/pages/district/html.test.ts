/** escapeHtml: a name rendered by Leaflet as HTML stays text. */
import { expect, test } from "vitest";
import { escapeHtml } from "./html";

test("escapes markup so it cannot run", () => {
  expect(escapeHtml(`<img src=x onerror=alert(1)>`)).toBe("&#60;img src=x onerror=alert(1)&#62;");
  expect(escapeHtml(`a & "b" 'c'`)).toBe("a &#38; &#34;b&#34; &#39;c&#39;");
  expect(escapeHtml("Rechenzentrum Süd")).toBe("Rechenzentrum Süd");
});
