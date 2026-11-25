/**
 * The assistant's set_profile_shape (ProfileGenerator): which open generator it means and its drawn shapes checked
 * before they are drawn, the way a drag would draw them. Pure.
 */

/** The one of `names` that `wanted` means (exact, else the only one containing it); with one open, that one. */
export function pickByName(names: string[], wanted: unknown): string {
  if (wanted === undefined || wanted === null || wanted === "") {
    if (names.length === 1) return names[0];
    throw new Error(
      `${names.length ? "Several" : "No"} profile generators are open: give profile, one of ${names.join(" | ") || "none (open a profile first)"}`,
    );
  }
  const w = String(wanted).toLowerCase();
  const hits = names.filter((n) => n.toLowerCase() === w);
  const near = hits.length ? hits : names.filter((n) => n.toLowerCase().includes(w));
  if (near.length !== 1) throw new Error(`profile "${String(wanted)}" ${near.length ? "matches several" : "matches none"}: ${names.join(" | ")}`);
  return near[0];
}

/** `n` values of 0 or more, as drawn bars or points; an Error naming `what` otherwise. */
export function shapeValues(x: unknown, n: number[], what: string): number[] {
  const ok = Array.isArray(x) && n.includes(x.length) && x.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (!ok) throw new Error(`${what} needs ${n.join(" or ")} numbers of 0 or more`);
  return x as number[];
}
