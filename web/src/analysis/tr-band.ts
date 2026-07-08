import type { MatchRow } from "./types";
import { quantile } from "./stats";
import { finiteNumber } from "../utils";

export const TR_BAND_WINDOW = 50;

export interface TrBandSeries {
  labels: string[];              // 日付ラベル（played_at_jstの先頭10文字）
  p10: Array<number | null>;
  p50: Array<number | null>;
  p90: Array<number | null>;
  count: number;                 // 有効行数
}

// マッチ後TRの直近window分位帯。tr_afterがあり日時のある行のみ、日時昇順。
export function trBandSeries(matches: MatchRow[], window = TR_BAND_WINDOW): TrBandSeries {
  const rows = matches
    .map((match) => ({
      playedAt: String(match.played_at_jst ?? ""),
      tr: finiteNumber(match.tr_after),
    }))
    .filter((row): row is { playedAt: string; tr: number } => row.tr !== null && row.playedAt.length > 0)
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const windows = rows.map((_, index) => rows.slice(Math.max(0, index - window + 1), index + 1).map((row) => row.tr));
  return {
    labels: rows.map((row) => row.playedAt.slice(0, 10)),
    p10: windows.map((values) => quantile(values, 0.1)),
    p50: windows.map((values) => quantile(values, 0.5)),
    p90: windows.map((values) => quantile(values, 0.9)),
    count: rows.length,
  };
}
