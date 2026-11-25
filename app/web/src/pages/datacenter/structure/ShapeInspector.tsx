/**
 * Side panel for the selected shape of the construct: its label and role, its size, its values (design data such as
 * capacity_kW = 50), the variable that sits on it (one of the drawing's variables, a data column, or a new variable
 * named after the label) and Delete shape.
 */
import { useState } from "react";
import type { ShapeRole } from "../../../api";
import { KIND_LABEL, valueOf, type Shape, type ShapeEdit } from "./construct";

const ROLES: { id: ShapeRole; label: string }[] = [
  { id: "component", label: "Component" },
  { id: "instrument", label: "Instrument" },
  { id: "pipe", label: "Pipe" },
  { id: "note", label: "Note" },
  { id: "drawing", label: "Drawing (as on the sheet)" },
  { id: "", label: "None" },
];

/** A variable name from a shape's label: "TI 101" -> "TI_101" (letters, digits and _, starting with a letter). */
export const nameFromLabel = (label: string) => {
  const n = label
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return n ? (/^[A-Za-z_]/.test(n) ? n : `v_${n}`).slice(0, 64) : "";
};

interface Props {
  shape: Shape;
  onDrawing: string[]; // the variables on the drawing
  columns: string[]; // data columns not on it yet
  onEdit: (e: ShapeEdit) => void;
  onMatch: (variable: string) => void;
  onDelete: () => void;
}

export function ShapeInspector({ shape: s, onDrawing, columns, onEdit, onMatch, onDelete }: Props) {
  const sized = s.kind === "rect" || s.kind === "circle";
  const fresh = nameFromLabel(s.label);
  const pct = (v: number | undefined) => Math.round((v ?? 0) * 1000) / 10;
  return (
    <>
      <strong>
        {KIND_LABEL[s.kind]} <span className="pid-muted">{s.id}</span>
      </strong>
      <label className="pid-stack">
        Label
        <input className="field field--sm" value={s.label} maxLength={80} onChange={(e) => onEdit({ label: e.target.value })} />
      </label>
      <label className="pid-stack">
        Role
        <select className="field field--sm" value={s.role} onChange={(e) => onEdit({ role: e.target.value as ShapeRole })}>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {sized && (
        <div className="pid-bar">
          <label className="pid-stack">
            Width %
            <input
              className="field field--sm"
              type="number"
              step={0.5}
              min={0.5}
              max={100}
              value={pct(s.w)}
              onChange={(e) => onEdit({ w: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="pid-stack">
            Height %
            <input
              className="field field--sm"
              type="number"
              step={0.5}
              min={0.5}
              max={100}
              value={pct(s.h)}
              onChange={(e) => onEdit({ h: Number(e.target.value) / 100 })}
            />
          </label>
        </div>
      )}
      <Values key={s.id} props={s.props ?? {}} onEdit={(props) => onEdit({ props })} />
      <label className="pid-stack">
        Put a variable on it
        <select className="field field--sm" value="" onChange={(e) => e.target.value && onMatch(e.target.value)}>
          <option value="">Choose…</option>
          {fresh && !onDrawing.includes(fresh) && !columns.includes(fresh) && <option value={fresh}>New variable {fresh}</option>}
          <optgroup label="On the drawing">
            {onDrawing.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </optgroup>
          {columns.length > 0 && (
            <optgroup label="Data columns not on it yet">
              {columns.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <button type="button" className="btn pid-delete" onClick={onDelete}>
        Delete shape
      </button>
    </>
  );
}

/** The shape's values: each editable (empty removes it), and a row to add one. */
function Values({ props, onEdit }: { props: Record<string, string | number>; onEdit: (p: Record<string, string | number | null>) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const ok = /^[A-Za-z_][A-Za-z0-9_ .%/-]{0,39}$/.test(name.trim()) && value.trim() !== "";
  const add = () => {
    if (!ok) return;
    onEdit({ [name.trim()]: valueOf(value) });
    setName("");
    setValue("");
  };
  return (
    <div className="pid-stack" role="group" aria-label="Values">
      Values
      {Object.entries(props).map(([k, v]) => (
        <span key={k} className="pid-value">
          <span className="pid-value__name" title={k}>
            {k}
          </span>
          <input
            className="field field--sm"
            aria-label={`Value ${k}`}
            defaultValue={String(v)}
            onBlur={(e) => e.target.value !== String(v) && onEdit({ [k]: e.target.value === "" ? null : valueOf(e.target.value) })}
          />
          <button type="button" className="btn btn--sm" aria-label={`Remove ${k}`} onClick={() => onEdit({ [k]: null })}>
            ×
          </button>
        </span>
      ))}
      <span className="pid-value">
        <input
          className="field field--sm"
          placeholder="name, e.g. capacity_kW"
          aria-label="New value name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field field--sm"
          placeholder="value"
          aria-label="New value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button type="button" className="btn btn--sm" disabled={!ok} onClick={add}>
          Add
        </button>
      </span>
    </div>
  );
}
