import { htmlEscape } from "../utils";

// render_report.py の METRIC_DIGITS / DIRECTION / TERM_TITLES を移植した単一の真実。
export const METRIC_DIGITS: Record<string, number> = {
  PPS: 2,
  APP: 3,
  "DS/Second": 3,
  "DS/Piece": 3,
  "APP+DS/Piece": 3,
  "VS/APM": 3,
  "Cheese Index": 2,
  "Garbage Eff.": 3,
  "Est. TR": 1,
  Opener: 2,
  Stride: 2,
  "Inf DS": 2,
  Plonk: 2,
};

export const DIRECTION: Record<string, string> = {
  Brier: "↓良い",
  "Log loss": "↓良い",
  最大DD: "浅いほど良い",
  最大ドローダウン: "浅いほど良い",
  "Cheese Index": "低めが安定寄り",
  CV: "↓良い",
};

export const TERM_TITLES: Record<string, string> = {
  APM: "Attack Per Minute。1分あたりの攻撃量。",
  PPS: "Pieces Per Second。1秒あたりの操作ピース数。",
  VS: "Versus score。攻撃・防御を含む総合圧力の目安。",
  APP: "Attack Per Piece。1ピースあたりの攻撃効率。",
  "DS/S": "Downstack per Second。1秒あたりの掘り量の目安。",
  "DS/Second": "Downstack per Second。1秒あたりの掘り量の目安。",
  "DS/P": "Downstack per Piece。1ピースあたりの掘り効率。",
  "DS/Piece": "Downstack per Piece。1ピースあたりの掘り効率。",
  "APP+DS/Piece": "APPとDS/Pieceを足した攻撃・掘り効率の合成指標。",
  GbE: "Garbage Efficiency。送ったお邪魔の効率の目安。",
  "Garbage Eff.": "Garbage Efficiency。送ったお邪魔の効率の目安。",
  "VS/APM": "攻撃量に対する総合圧力。高いほど守備・相殺込みの圧が出ている目安。",
  "Cheese Index": "穴の散らばり・受けの荒れやすさの補助指標。高ければ常に良いとは限らない。",
  Area: "APM・PPS・VS・APP・DS/S・DS/P・GbEを重み付けで合算した総合スコア。",
  Glicko: "TETR.IOの実力推定に近いレーティング系指標。",
  RD: "Rating Deviation。レート推定の不確実性。",
  "Est. TR": "能力指標から推定したTRの目安。入力データに既存の推定値がある場合に使用。",
  AUC: "勝者を上位に並べる性能。高いほど良い。",
  Brier: "予測確率の誤差。低いほど良い。",
  "Log loss": "予測確率の外し方への罰則。低いほど良い。",
  "Cohen's d": "勝利時と敗北時の差の大きさ。絶対値が大きいほど差が大きい。",
  CV: "変動係数。平均に対するばらつき。低いほど安定。",
  期待勝率: "対戦前Glicko/RDから見た勝つ確率の目安。",
  期待超過: "実績勝率から期待勝率を引いた差。プラスなら期待以上。",
  TR: "TETRA LEAGUE rating。TETR.IO上のレート。",
};

const EM_DASH = "—";

function toFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function nfmt(value: unknown, digits = 1, comma = false, def = EM_DASH): string {
  if (value === null || value === undefined) {
    return def;
  }
  const number = Number(value);
  if (Number.isNaN(number)) {
    return htmlEscape(String(value));
  }
  if (!Number.isFinite(number)) {
    return def;
  }
  const fixed = number.toFixed(digits);
  if (!comma) {
    return fixed;
  }
  const parts = fixed.split(".");
  const intPart = parts[0] ?? "";
  const fracPart = parts[1];
  const sign = intPart.startsWith("-") ? "-" : "";
  const digitsOnly = sign ? intPart.slice(1) : intPart;
  const grouped = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart !== undefined ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

export function pct(value: unknown, digits = 1, signed = false): string {
  const number = toFinite(value);
  if (number === null) {
    return EM_DASH;
  }
  const scaled = number * 100;
  const sign = signed && scaled > 0 ? "+" : "";
  return `${sign}${scaled.toFixed(digits)}%`;
}

export function pp(value: unknown, digits = 1, signed = true): string {
  if (value === null || value === undefined) {
    return EM_DASH;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return EM_DASH;
  }
  const scaled = number * 100;
  const sign = signed && scaled > 0 ? "+" : "";
  return `${sign}${scaled.toFixed(digits)}pt`;
}

export function sgn(value: unknown, digits = 1): string {
  const number = toFinite(value);
  if (number === null) {
    return EM_DASH;
  }
  const sign = number >= 0 ? "+" : "";
  return `${sign}${number.toFixed(digits)}`;
}

export function datefmt(value: unknown): string {
  if (!value) {
    return EM_DASH;
  }
  return htmlEscape(String(value).slice(0, 10));
}

export function metricFmt(label: string, value: unknown, signed = false): string {
  const digits = METRIC_DIGITS[label] ?? 1;
  return signed ? sgn(value, digits) : nfmt(value, digits);
}
