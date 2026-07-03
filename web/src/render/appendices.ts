import type { AnalysisBundle } from "../analysis/types";
import { htmlEscape } from "../utils";
import { type Cell, fig, recordsTableHtml, table } from "./components";
import { nfmt, pct, pp, sgn } from "./format";

function excessTable(rows: Array<Record<string, any>>): string {
  const body: Cell[][] = rows.map((r) => [
    r.label,
    pct(r.actual),
    pct(r.expected),
    pp(r.excess),
    sgn(r.d_apm, 1),
    sgn(r.d_pps, 2),
    sgn(r.d_vs, 1),
    sgn(r.d_area, 1),
    r.n,
  ]);
  return table(["区分", "実績", "期待", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "標本"], body, {
    leftCols: new Set([0]),
    minWidth: 900,
    showDirection: false,
    mobileColumns: [0, 1, 2, 3, 8],
  });
}

export function renderAppendices(bundle: AnalysisBundle): string {
  const s = bundle.summary as any;
  const monthly = bundle.monthly as Array<Record<string, any>>;
  const records = (s.records ?? []) as Array<Record<string, any>>;

  const monthlyRows: Cell[][] = monthly.map((r) => [
    htmlEscape(String(r.month)),
    r.matches,
    r.wins,
    r.losses,
    pct(r.official_win_rate),
    pct(r.expected_win_rate),
    pp(r.expected_excess_rate),
    nfmt(r.tr_start, 0, true),
    nfmt(r.tr_end, 0, true),
    nfmt(r.tr_change, 0, true),
    nfmt(r.peak_tr, 0, true),
    nfmt(r.max_drawdown, 0, true),
    nfmt(r.APM, 1),
    nfmt(r.PPS, 2),
    nfmt(r.VS, 1),
    nfmt(r.APP, 3),
    nfmt(r["DS/S"], 3),
    nfmt(r["DS/P"], 3),
    nfmt(r.GbE, 3),
    nfmt(r.Area, 1),
    nfmt(r.Opener, 2),
    nfmt(r.Stride, 2),
    nfmt(r["Inf DS"], 2),
    nfmt(r.Plonk, 2),
  ]);
  const monthlyTable = table(
    ["月", "マッチ", "勝", "敗", "勝率", "期待", "期待超過", "月初TR", "月末TR", "TR増減", "ピーク", "最大DD", "APM", "PPS", "VS", "APP", "DS/S", "DS/P", "GbE", "Area", "Opener", "Stride", "Inf DS", "Plonk"],
    monthlyRows,
    { minWidth: 1900, showDirection: false, mobileColumns: [0, 1, 4, 6, 9] },
  );

  const weekdayTable = excessTable((s.excess_by_weekday ?? []) as Array<Record<string, any>>);
  const hourTable = excessTable((s.excess_by_hour ?? []) as Array<Record<string, any>>);

  return [
    `<details id="appendix-monthly">`,
    `<summary>付録A　月別集計を開く（${monthly.length}か月）</summary>`,
    `<p class="lead">月（JST）ごとの勝率・期待値・TR・主要能力・4スタイル。標本の少ない月は一般化しない。</p>`,
    monthlyTable,
    `</details>`,
    `<details id="appendix-records">`,
    `<summary>付録B　パーソナルレコード（全）を開く（${records.length}件）</summary>`,
    `<p class="lead">対象期間の自己ベスト全件。単マッチ・単ラウンド・期間窓を区別し、注意欄で集計上の扱いを補う。</p>`,
    recordsTableHtml(records),
    `</details>`,
    `<details id="appendix-excess-grid">`,
    `<summary>付録C　曜日・時間帯別の期待値調整後成績を開く</summary>`,
    `<p class="lead">曜日・時間帯（JST、マッチ単位）ごとの実績勝率・期待勝率・期待超過と能力指標差分（各区分平均と全完了マッチ平均の差）。期待超過がプラスなら相手強度を補正して期待以上。n&lt;20の区分は<a href="#note-smallSample">弱い根拠</a>として扱う。</p>`,
    `<h3>曜日別の期待値調整後成績</h3>`,
    fig("21_excess_weekday", "曜日別の期待値調整後成績"),
    weekdayTable,
    `<h3>時間帯別の期待値調整後成績</h3>`,
    fig("22_excess_hour", "時間帯別の期待値調整後成績"),
    hourTable,
    `</details>`,
  ].join("");
}
