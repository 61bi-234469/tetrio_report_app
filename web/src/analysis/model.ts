import type { MatchRow } from "./types";

export const STYLE_ORDER = ["Opener", "Stride", "Inf DS", "Plonk"] as const;
export const RECENT_MATCH_WINDOW = 100;
export const TABLE_SCOPE_WINDOWS = [10, 50, 100] as const;
export const SCORE_STATE_ORDER = ["同点", "リード時", "ビハインド時", "自分MP", "相手MP", "双方MP"] as const;
export const RANK_ORDER = [
  "d",
  "d+",
  "c-",
  "c",
  "c+",
  "b-",
  "b",
  "b+",
  "a-",
  "a",
  "a+",
  "s-",
  "s",
  "s+",
  "ss",
  "u",
  "x",
  "x+",
] as const;

// 相手スタイル2軸平面の4象限。buildStyleMatchupPlane（第6章）と
// リプレイ候補の苦手象限認定で同じ分類を使う。
export const STYLE_QUADRANTS: ReadonlyArray<
  readonly [string, (match: MatchRow) => boolean]
> = [
  ["相手Opener・Stride寄り", (m) => Number(m["opponent_Opener - Inf DS"]) >= 0 && Number(m["opponent_Stride - Plonk"]) >= 0],
  ["相手Opener・Plonk寄り", (m) => Number(m["opponent_Opener - Inf DS"]) >= 0 && Number(m["opponent_Stride - Plonk"]) < 0],
  ["相手Inf DS・Stride寄り", (m) => Number(m["opponent_Opener - Inf DS"]) < 0 && Number(m["opponent_Stride - Plonk"]) >= 0],
  ["相手Inf DS・Plonk寄り", (m) => Number(m["opponent_Opener - Inf DS"]) < 0 && Number(m["opponent_Stride - Plonk"]) < 0],
] as const;

// 平面集計・苦手象限認定の共通標本ゲート（全体マッチ数）。
export const STYLE_PLANE_MIN_MATCHES = 30;
