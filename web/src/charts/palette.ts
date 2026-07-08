export const WIN_COLOR = "#16a34a";
export const LOSS_COLOR = "#dc2626";
export const EXPECTED_COLOR = "#64748b";
export const PRIMARY_COLOR = "#6366f1";
export const NEUTRAL_BAR_COLOR = "#cbd5e1";

export const METRIC_COLORS: Record<string, string> = {
  win: WIN_COLOR,
  loss: LOSS_COLOR,
  APM: "#d62728",
  PPS: "#1f77b4",
  VS: "#2ca02c",
  APP: "#d62728",
  "DS/Second": "#7e57c2",
  "DS/Piece": "#00a6a6",
  "APP+DS/Piece": "#7c3aed",
  "VS/APM": "#374151",
  "Cheese Index": "#eab308",
  "Garbage Eff.": "#1e3a8a",
  Area: "#c026d3",
  "Est. TR": "#38bdf8",
  expected: EXPECTED_COLOR,
};

// Python版 charts.py の style_colors と同じ対応。
export const STYLE_COLORS: Record<string, string> = {
  Opener: "#d62728",
  Stride: "#eab308",
  "Inf DS": "#2563eb",
  Plonk: "#16a34a",
};

export function alphaColor(hex: string, opacity: number): string {
  const rgb = hex.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})`;
  }
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// 勝率0..1を赤(0)→黄(0.5)→緑(1)で塗り分ける（Python版 27_rivals の RdYlGn 相当）。
export function winRateColor(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return NEUTRAL_BAR_COLOR;
  }
  const t = Math.max(0, Math.min(1, rate));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [220, 38, 38]],
    [0.5, [234, 179, 8]],
    [1, [22, 163, 74]],
  ];
  let low = stops[0]!;
  let high = stops[stops.length - 1]!;
  for (let i = 0; i + 1 < stops.length; i += 1) {
    if (t >= stops[i]![0] && t <= stops[i + 1]![0]) {
      low = stops[i]!;
      high = stops[i + 1]!;
      break;
    }
  }
  const span = high[0] - low[0] || 1;
  const f = (t - low[0]) / span;
  const mix = low[1].map((c, i) => Math.round(c + (high[1][i]! - c) * f));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}
