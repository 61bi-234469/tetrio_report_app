import type { CellValue, DataRow } from "./analysis/types";

export function nested(data: unknown, ...keys: string[]): unknown {
  let current = data;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? undefined;
}

export function firstNested(data: unknown, ...paths: Array<string | string[]>): unknown {
  for (const path of paths) {
    const keys = Array.isArray(path) ? path : [path];
    const value = nested(data, ...keys);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

export function jsonCell(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

export function metricDelta(before: unknown, after: unknown): number | null {
  const left = toNumber(before);
  const right = toNumber(after);
  if (left === null || right === null) {
    return null;
  }
  return right - left;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

// Number()の素の変換に有限性チェックだけを足した変換。
// toNumberと異なり null/"" は 0 になる（チャート・描画系の現行挙動を保持するため統一しない）。
export function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cell(value: unknown): CellValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return jsonCell(value);
}

export function safeDiv(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }
  return numerator / denominator;
}

export function requireNumber(name: string, value: unknown): number {
  const parsed = toNumber(value);
  if (parsed === null) {
    throw new Error(`${name} is blank or not numeric`);
  }
  return parsed;
}

export function prefixed(values: Record<string, unknown>, prefix: string): DataRow {
  const out: DataRow = {};
  for (const [key, value] of Object.entries(values)) {
    out[`${prefix}_${key}`] = cell(value);
  }
  return out;
}

export function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isoToJst(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return formatJstDateTime(date.getTime());
}

export function formatJstDateTime(epochMs: number): string {
  const d = new Date(epochMs + 9 * 60 * 60 * 1000);
  return [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
  ].join("-") + " " + [
    pad2(d.getUTCHours()),
    pad2(d.getUTCMinutes()),
    pad2(d.getUTCSeconds()),
  ].join(":");
}

export function jstParts(value: unknown): {
  epochMs: number | null;
  date: string | null;
  month: string | null;
  weekday: number | null;
  hour: number | null;
} {
  if (!value) {
    return { epochMs: null, date: null, month: null, weekday: null, hour: null };
  }
  const date = new Date(String(value).replace(" ", "T") + (String(value).includes("T") ? "" : "+09:00"));
  const epochMs = Number.isNaN(date.getTime()) ? null : date.getTime();
  if (epochMs === null) {
    return { epochMs, date: null, month: null, weekday: null, hour: null };
  }
  const jst = new Date(epochMs + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const monthNumber = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  return {
    epochMs,
    date: `${year}-${pad2(monthNumber)}-${pad2(day)}`,
    month: `${year}-${pad2(monthNumber)}`,
    weekday: (jst.getUTCDay() + 6) % 7,
    hour: jst.getUTCHours(),
  };
}

export function normalizeCacheEpoch(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null) {
    return null;
  }
  const epoch = Math.trunc(parsed);
  return epoch > 10_000_000_000 ? Math.trunc(epoch / 1000) : epoch;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
