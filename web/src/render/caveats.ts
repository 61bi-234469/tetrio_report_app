import { htmlEscape } from "../utils";

// 注意事項カタログ。各図は注意文を直書きせず、ここで定義した短ラベルをIDで参照する。
// 実文はレポート末尾の「注意事項」に一度だけ描画し、タグからアンカーで参照する。
// 定型警告を一箇所へ集約することで、プロース量と将来の翻訳対象を抑える。
// 文体は常体（言い切り）。敬体（です・ます）は使わない。
export type CaveatId =
  | "reverseCausation"
  | "selectionBias"
  | "smallSample"
  | "glickoMissing"
  | "derivedMetric"
  | "cohortBias"
  | "posthocMetric"
  | "normalized"
  | "aggregation"
  | "summaryRecentSplit"
  | "binBoundary"
  | "privacy"
  | "replayExpiry"
  | "replayNotInspected"
  | "dqIncluded"
  | "matchLevelSource"
  | "roundDqMixed";

interface Caveat {
  short: string;
  full: string;
}

export const CAVEATS: Record<CaveatId, Caveat> = {
  reverseCausation: {
    short: "逆因果",
    full: "苦戦したマッチほど長引き、劣勢局面は苦戦マッチ自体の選択を含む。時間や劣勢差だけで敗因を断定しない。",
  },
  selectionBias: {
    short: "選択バイアス",
    full: "接戦や好調セッションだけを抽出するため母集団が偏る。抽出条件を踏まえて読む。",
  },
  smallSample: {
    short: "小標本",
    full: "標本n<20の区分は点推定を結論に使わない。",
  },
  glickoMissing: {
    short: "Glicko欠損",
    full: "対戦前Glicko/RD欠損マッチは期待勝率・期待超過の集計から除外する。",
  },
  derivedMetric: {
    short: "派生指標",
    full: "スタイル値・合成指標は戦績由来の数式特徴量で、開幕選択や盤面の直接観測ではない。",
  },
  cohortBias: {
    short: "相手・時期の偏り",
    full: "各区分は相手層・時期・プレー頻度・自己選択が異なる。区分間の差は純粋な因果ではない。",
  },
  posthocMetric: {
    short: "事後指標",
    full: "マッチ中に確定する指標は結果と同時に決まるため、勝敗予測の事前情報ではない。",
  },
  normalized: {
    short: "正規化値",
    full: "正規化・指数化した線は高さで絶対値を比較できない。元単位の表と併読する。",
  },
  aggregation: {
    short: "集約値",
    full: "マッチ・セット平均のため、個別の開幕・盤面・入力ミス・相殺は識別できない。",
  },
  summaryRecentSplit: {
    short: "現在値と履歴値",
    full: "現在TL値はsummary API由来のサーバ側集計で、ラウンド長・プレイ時間の重みを受ける。直近窓は保存済みrecent recordsのマッチ等重み平均のため基礎値がわずかにずれ、派生指標で差が見える場合がある。summary APIは現在値のみ返すため、窓別比較は自前集計を使う。",
  },
  binBoundary: {
    short: "ビン境界",
    full: "ビン境界はデータ分位で、別期間では値が変わる。",
  },
  privacy: {
    short: "ID表示",
    full: "相手表示はTETR.IOのプレイヤーID。",
  },
  replayExpiry: {
    short: "リプレイ期限",
    full: "リプレイは一定期間でサーバーから削除され、古いマッチは視聴できない。APIデータは盤面や入力を含まない。",
  },
  replayNotInspected: {
    short: "内容未解析",
    full: "候補抽出はAPIの統計値・スコア・時間・勝敗から行い、リプレイ映像・盤面・入力内容は解析しない。",
  },
  dqIncluded: {
    short: "DQ込み",
    full: "本レポートの戦績・能力値集計はDQ(不戦勝・不戦敗)を含む公式勝敗マッチ全体を対象にする。TETR.IO/Tetra Statsの表示と揃えるための意図的な選択。",
  },
  matchLevelSource: {
    short: "マッチ能力値の出典",
    full: "マッチ単位のAPM/PPS/VS(および派生指標)はAPIの試合集計値(leaderboard.stats)を使う。欠損時のみラウンド単純平均で補う。",
  },
  roundDqMixed: {
    short: "DQ試合のラウンド",
    full: "タイブレーク・逆転・決着時間などラウンド単位の項目もDQ試合のラウンドを含む。相手の途中切断などで通常と異なるラウンドが混じる場合がある。",
  },
};

// block から注意タグ列を描画する。空配列なら何も出さない。
export function caveatTags(ids: CaveatId[]): string {
  if (!ids.length) {
    return "";
  }
  const tags = ids
    .map((id) => `<a class="caveat-tag" href="#note-${id}">${htmlEscape(CAVEATS[id].short)}</a>`)
    .join("");
  return `<p class="caveat"><span class="tag warn">注意</span>${tags}</p>`;
}

// レポート末尾に一度だけ描画する注意事項の一覧。タグのアンカー先。
// 折りたたむとアンカー遷移が効かない環境があるため常時表示にする。
export function caveatNotes(): string {
  const rows = (Object.keys(CAVEATS) as CaveatId[])
    .map((id) => `<dt id="note-${id}">${htmlEscape(CAVEATS[id].short)}</dt><dd>${htmlEscape(CAVEATS[id].full)}</dd>`)
    .join("");
  return `<section class="glossary notes" id="notes"><b>注意事項（全図共通）</b><dl>${rows}</dl></section>`;
}
