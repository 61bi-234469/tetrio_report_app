import { toNumber } from "../utils";

export function finiteNumbers(values: Iterable<unknown>): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) {
      out.push(number);
    }
  }
  return out;
}

export function mean(values: Iterable<unknown>): number | null {
  const xs = finiteNumbers(values);
  if (!xs.length) {
    return null;
  }
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

export function std(values: Iterable<unknown>, ddof = 1): number | null {
  const xs = finiteNumbers(values);
  if (xs.length <= ddof) {
    return null;
  }
  const m = mean(xs);
  if (m === null) {
    return null;
  }
  const variance = xs.reduce((sum, value) => sum + (value - m) ** 2, 0) / (xs.length - ddof);
  return Math.sqrt(variance);
}

export function cohensD(xValues: Iterable<unknown>, yValues: Iterable<unknown>): number | null {
  const x = finiteNumbers(xValues);
  const y = finiteNumbers(yValues);
  if (x.length < 2 || y.length < 2) {
    return null;
  }
  const vx = variance(x, 1);
  const vy = variance(y, 1);
  if (vx === null || vy === null) {
    return null;
  }
  const pooled = ((x.length - 1) * vx + (y.length - 1) * vy) / (x.length + y.length - 2);
  if (pooled <= 0 || !Number.isFinite(pooled)) {
    return 0;
  }
  return ((mean(x) ?? 0) - (mean(y) ?? 0)) / Math.sqrt(pooled);
}

export function wilsonInterval(wins: number, n: number, z = 1.96): [number | null, number | null] {
  if (n <= 0) {
    return [null, null];
  }
  const p = wins / n;
  const den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n) / den;
  return [center - half, center + half];
}

export function runLengths(values: boolean[]): { wins: number[]; losses: number[] } {
  const wins: number[] = [];
  const losses: number[] = [];
  if (!values.length) {
    return { wins, losses };
  }
  let current = values[0] ?? false;
  let length = 1;
  for (const value of values.slice(1)) {
    if (value === current) {
      length += 1;
    } else {
      (current ? wins : losses).push(length);
      current = value;
      length = 1;
    }
  }
  (current ? wins : losses).push(length);
  return { wins, losses };
}

export interface QuantileBin {
  index: number;
  low: number;
  high: number;
  center: number;
  indices: number[];
}

export function quantile(values: Iterable<unknown>, q: number): number | null {
  const xs = finiteNumbers(values).sort((a, b) => a - b);
  if (!xs.length) {
    return null;
  }
  if (q <= 0) {
    return xs[0] ?? null;
  }
  if (q >= 1) {
    return xs[xs.length - 1] ?? null;
  }
  const pos = (xs.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  const low = xs[lower] ?? xs[0] ?? 0;
  const high = xs[upper] ?? xs[xs.length - 1] ?? low;
  return low * (1 - weight) + high * weight;
}

export function quantileBins(values: Array<number | null | undefined>, q = 5): QuantileBin[] {
  const finite = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => Number.isFinite(item.value));
  if (!finite.length || q <= 0) {
    return [];
  }
  const sortedValues = finite.map((item) => item.value).sort((a, b) => a - b);
  const rawEdges: number[] = [];
  for (let i = 0; i <= q; i += 1) {
    const edge = quantile(sortedValues, i / q);
    if (edge !== null) {
      rawEdges.push(edge);
    }
  }
  const edges = uniqueSortedEdges(rawEdges);
  if (edges.length < 2) {
    return [];
  }
  const bins: QuantileBin[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const low = edges[i];
    const high = edges[i + 1];
    if (low === undefined || high === undefined || low === high) {
      continue;
    }
    const isFirst = i === 0;
    const indices = finite
      .filter((item) => (isFirst ? item.value >= low : item.value > low) && item.value <= high)
      .map((item) => item.index);
    if (indices.length) {
      bins.push({ index: bins.length, low, high, center: (low + high) / 2, indices });
    }
  }
  return bins;
}

export function rollingMean(values: Array<number | null | undefined>, window = 10): Array<number | null> {
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    return mean(values.slice(start, index + 1));
  });
}

function variance(values: number[], ddof: number): number | null {
  if (values.length <= ddof) {
    return null;
  }
  const m = mean(values);
  if (m === null) {
    return null;
  }
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - ddof);
}

export function robustZFactory(values: unknown[]): (value: unknown) => number | null {
  const xs = values.map(toNumber).filter((value): value is number => value !== null);
  const median = quantile(xs, 0.5);
  if (median === null) {
    return () => null;
  }
  const deviations = xs.map((value) => Math.abs(value - median));
  const mad = quantile(deviations, 0.5);
  const fallback = std(xs, 1);
  const scale = mad && mad > 0 ? mad * 1.4826 : fallback;
  if (!scale || scale <= 0) {
    return () => null;
  }
  return (value: unknown): number | null => {
    const parsed = toNumber(value);
    return parsed === null ? null : (parsed - median) / scale;
  };
}

function uniqueSortedEdges(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const previous = out[out.length - 1];
    const tolerance = 1e-12 * Math.max(1, Math.abs(value), Math.abs(previous ?? value));
    if (previous === undefined || Math.abs(value - previous) > tolerance) {
      out.push(value);
    }
  }
  return out;
}
