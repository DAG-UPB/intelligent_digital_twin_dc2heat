/**
 * The physics equations being edited: loaded from the dataset, each row checked by the server.
 * Rows carry a stable id, so check results stay with their equation when another row is removed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { checkEquation, getEquations, type EquationCheck, type StructureScope } from "../../../api";

export interface EqRow {
  id: number;
  target: string;
  expr: string;
}

export function useEquations(datasetId: string | undefined, scope?: StructureScope) {
  const [rows, setRows] = useState<EqRow[]>([]);
  const [checks, setChecks] = useState<Record<number, EquationCheck | undefined>>({});
  const nextId = useRef(0);
  const newRow = (target: string, expr: string): EqRow => ({ id: nextId.current++, target, expr });

  /** Check a row on the server; an empty expression clears its result. */
  const check = useCallback(
    async (row: EqRow) => {
      if (!datasetId || !row.expr.trim()) return setChecks((c) => ({ ...c, [row.id]: undefined }));
      const res = await checkEquation(datasetId, row.target, row.expr).catch((e): EquationCheck => ({ ok: false, error: String(e) }));
      setChecks((c) => ({ ...c, [row.id]: res }));
    },
    [datasetId],
  );

  useEffect(() => {
    if (!datasetId) return;
    let live = true;
    getEquations(datasetId, scope)
      .then((saved) => {
        if (!live) return;
        const loaded = Object.entries(saved).map(([target, expr]) => newRow(target, expr));
        setRows(loaded);
        setChecks({});
        loaded.forEach((r) => checkEquation(datasetId, r.target, r.expr).then((res) => live && setChecks((c) => ({ ...c, [r.id]: res }))).catch(() => {}));
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [datasetId, scope]);

  const update = (id: number, change: Partial<EqRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));

  return {
    rows,
    checks,
    check,
    setTarget: (id: number, target: string) => update(id, { target }),
    setExpr: (id: number, expr: string) => update(id, { expr }),
    /** Append a term to a row's expression (as "+ term") and check it. */
    append(row: EqRow, term: string) {
      const next = { ...row, expr: row.expr.trim() ? `${row.expr.trim()} + ${term}` : term };
      update(row.id, next);
      check(next);
    },
    remove: (id: number) => setRows((rs) => rs.filter((r) => r.id !== id)),
    add: (target: string) => setRows((rs) => [...rs, newRow(target, "")]),
    /** Put an equation on `target`: replaces that variable's row, or adds one; then checks it. */
    place(target: string, expr: string) {
      const old = rows.find((r) => r.target === target);
      const row = old ? { ...old, expr } : newRow(target, expr);
      setRows((rs) => (old ? rs.map((r) => (r.id === row.id ? row : r)) : [...rs, row]));
      check(row);
    },
    /** The non-empty equations by target, as saved and sent to the physics model. */
    equations: () => Object.fromEntries(rows.filter((r) => r.target && r.expr.trim()).map((r) => [r.target, r.expr.trim()])),
  };
}

export type Equations = ReturnType<typeof useEquations>;
