/**
 * Names shown for variables in place of their own (dataset.json "names", set on Physical structure or by an
 * assistant): the data, the graph files and the models keep the own names, so a name shown is only a label, and
 * removing it gives the own name back. Pure functions only.
 */
export type Names = Record<string, string>;

/** The name shown for a variable: its given name, else its own. */
export const shownName = (v: string, names: Names | null | undefined) => names?.[v] || v;

/** A name shown with the own name after it, when they differ (hover texts, tooltips). */
export const withOwnName = (v: string, names: Names | null | undefined) => (names?.[v] && names[v] !== v ? `${names[v]} (${v})` : v);

/**
 * Bulk renaming: `find` replaced by `replace` in the names shown of `vars` (as text, every occurrence; or as a
 * regular expression, where `replace` may use $1, ...). Only the names that change, trimmed; "" when a name would
 * become the own name again. Throws for a regular expression that does not parse.
 */
export function renamed(vars: string[], names: Names, find: string, replace: string, regex = false): Names {
  if (!find) return {};
  const pattern = regex ? new RegExp(find, "g") : null;
  const out: Names = {};
  for (const v of vars) {
    const now = shownName(v, names);
    const next = (pattern ? now.replace(pattern, replace) : now.split(find).join(replace)).trim();
    if (next !== now) out[v] = next === v || !next ? "" : next;
  }
  return out;
}
