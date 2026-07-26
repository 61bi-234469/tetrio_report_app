import type { AnalysisBundle } from "../analysis/types";
import { buildChartConfigs } from "../charts/configs";
import CHART_RUNTIME from "../../node_modules/chart.js/dist/chart.umd.min.js";
import { htmlEscape } from "../utils";
import { createAnonymizer, type Anonymizer } from "./anonymize";
import { caveatNotes } from "./caveats";
import { renderAppendices } from "./appendices";
import { ACTIVE_CHAPTER_NUMBERS, CHAPTER_TITLES, PARTS, renderChapters } from "./chapters";
import { kpisHtml, selectedRecordKpis } from "./components";
import { TERM_TITLES, datefmt, nfmt, pct } from "./format";
import { CHART_BOOT, REPORT_CSS, REPORT_MOBILE_BOOT, REPORT_SAVE_BOOT } from "./static-assets";

const INT = (v: unknown): string => nfmt(v, 0, true);

function buildSubtitle(bundle: AnalysisBundle, anon: Anonymizer): string {
  const s = bundle.summary as any;
  const meta = s.meta;
  const name = anon.subject(s.source.username);
  return (
    `対象プレイヤー：<b>${htmlEscape(name)}</b>　／　対象期間：${datefmt(meta.start)} 〜 ${datefmt(meta.end)}（JST）　／　生成日：${htmlEscape(String(s.source.fetched_at).slice(0, 10))}<br>` +
    `公式マッチ数 ${INT(meta.matches)}　分析対象 ${INT(meta.analysis_matches ?? meta.matches)}マッチ　ラウンド数 ${INT(meta.rounds)}　セッション数 ${INT(meta.sessions ?? 0)}　稼働日数 ${meta.active_days}日　対戦相手 ${INT(meta.opponents)}名`
  );
}

function buildKpis(bundle: AnalysisBundle): string {
  const s = bundle.summary as any;
  const kpi = s.kpis;
  const windows = s.recent_windows as Array<Record<string, any>>;
  const analysisMatches = Number(s.meta.analysis_matches ?? s.meta.matches);
  const recent = (windows.find((w) => w.n === 100 && w.label !== "全期間") ??
    (analysisMatches <= 100 ? windows[windows.length - 1] : windows[0]))!;

  const officialNote =
    `${kpi.wins}勝 ${kpi.losses}敗／DQ勝${kpi.dq_wins}／DQ負${kpi.dq_losses ?? 0}／無効${kpi.nullified ?? 0}` +
    (kpi.no_contest || kpi.ties ? `／No Contest${kpi.no_contest ?? 0}／Tie${kpi.ties ?? 0}` : "");
  const currentLeague = s.current_league ?? {};
  const currentLeagueRaw = currentLeague.raw ?? {};

  const items = [
    { label: "公式戦績勝率", value: pct(kpi.official_win_rate), note: officialNote },
    currentLeague.available
      ? { label: "現在TR（summary）", value: INT(currentLeagueRaw.TR), note: "TETRA CHANNEL summary" }
      : { label: "履歴末尾TR", value: INT(kpi.current_tr), note: `開始 ${INT(kpi.first_tr)} から ${INT(kpi.tr_change)}` },
    { label: "ピークTR", value: INT(kpi.peak_tr), note: datefmt(kpi.peak_date) },
    { label: "最大ドローダウン", value: INT(kpi.max_drawdown), note: datefmt(kpi.max_drawdown_date) },
    {
      label: `${recent.label} 実績勝率`,
      value: pct(recent.expected_actual),
      note: `期待 ${pct(recent.expected)}／${nfmt(recent.excess_wins, 1)}勝分（期待対象${recent.expected_n}マッチ）`,
    },
    ...selectedRecordKpis((s.records ?? []) as Array<Record<string, any>>),
  ];
  return kpisHtml(items);
}

function buildGlossary(bundle: AnalysisBundle): string {
  const gap = (bundle.summary as any).session_definition?.gap_minutes ?? 10;
  const items: Array<[string, string | undefined]> = [
    ["マッチ", "Tetra Leagueの1マッチ。勝敗・TR変動・期待勝率・全期間の連続勝敗・セッション位置はマッチ単位で扱う。"],
    ["ラウンド", "マッチ内の1本。ラウンド勝敗・決着時間・開始前スコア状況・最終ラウンドの能力変化はラウンド単位で扱う。"],
    ["セッション", `前マッチ完了直後から次マッチ開始までの間隔が${gap}分以内の連戦まとまり。セッション内の1マッチ目・2マッチ目・11マッチ目以降などの位置をマッチ単位で集計。`],
    ["連勝連敗", "最長連勝・最長連敗は全期間の連続勝敗。直前段階別の表と分布図は同一セッション内の連勝連敗を扱う。"],
    ["TR", TERM_TITLES.TR],
    ["Est. TR", TERM_TITLES["Est. TR"]],
    ["Glicko", TERM_TITLES.Glicko],
    ["RD", TERM_TITLES.RD],
    ["期待勝率", TERM_TITLES.期待勝率],
    ["期待超過", TERM_TITLES.期待超過],
    ["APM", TERM_TITLES.APM],
    ["PPS", TERM_TITLES.PPS],
    ["VS", TERM_TITLES.VS],
    ["APP", TERM_TITLES.APP],
    ["DS/S", TERM_TITLES["DS/S"]],
    ["DS/P", TERM_TITLES["DS/P"]],
    ["GbE", TERM_TITLES.GbE],
    ["VS/APM", TERM_TITLES["VS/APM"]],
    ["Area", TERM_TITLES.Area],
    ["Cheese Index", TERM_TITLES["Cheese Index"]],
    ["Opener", TERM_TITLES.Opener],
    ["Stride", TERM_TITLES.Stride],
    ["Inf DS", TERM_TITLES["Inf DS"]],
    ["Plonk", TERM_TITLES.Plonk],
    ["CV", TERM_TITLES.CV],
    ["Cohen's d", TERM_TITLES["Cohen's d"]],
  ];
  const rows = items.map(([k, v]) => `<dt>${htmlEscape(k)}</dt><dd>${htmlEscape(v ?? "")}</dd>`).join("");
  return `<details class="glossary"><summary>先に用語を確認する</summary><dl>${rows}</dl></details>`;
}

function buildToc(): string {
  let toc = "<b>目次</b>";
  PARTS.forEach(([roman, name, start], idx) => {
    const end = idx + 1 < PARTS.length ? PARTS[idx + 1]![2] - 1 : CHAPTER_TITLES.length;
    const chapterNumbers: number[] = [];
    for (let n = start; n <= end; n += 1) {
      if (ACTIVE_CHAPTER_NUMBERS.includes(n)) {
        chapterNumbers.push(n);
      }
    }
    if (!chapterNumbers.length) {
      return;
    }
    toc += `<div class="toc-part">第${roman}部　${htmlEscape(name)}</div>`;
    toc += `<ol start="${start}">` + chapterNumbers.map((n) => `<li value="${n}"><a href="#c${n}">${htmlEscape(String(CHAPTER_TITLES[n - 1]))}</a></li>`).join("") + "</ol>";
  });
  toc +=
    '<div class="muted" style="font-size:13px">付録：' +
    '<a href="#appendix-monthly">付録A 月別集計</a>　／　' +
    '<a href="#appendix-records">付録B パーソナルレコード（全）</a>　／　' +
    '<a href="#appendix-excess-grid">付録C 曜日・時間帯別の期待値調整後成績</a></div>';
  return toc;
}

function buildNoteBox(bundle: AnalysisBundle): string {
  const gap = (bundle.summary as any).session_definition?.gap_minutes ?? 10;
  return `本レポートはマッチ・ラウンド・セッションを分けて集計。勝敗やTR・期待勝率は主にマッチ単位、決着時間やスコア状況はラウンド単位、連戦中の位置はセッション内のマッチ位置で見る。セッションは前マッチ完了直後から次マッチ開始まで${gap}分以内の連戦。`;
}

function buildReportActions(bundle: AnalysisBundle, anon: Anonymizer): string {
  const s = bundle.summary as any;
  const username = anon.subjectSlug(s.source.username ?? "tetrio") || "tetrio";
  const date = String(s.source.fetched_at ?? new Date().toISOString()).slice(0, 10).replaceAll("-", "");
  const filename = `${username}_tetrio_report_${date}.html`.replace(/[\\/:*?"<>|\s]+/g, "_");
  return [
    `<div class="report-actions" data-filename="${htmlEscape(filename)}">`,
    `<button type="button" id="save-html-button">HTMLを保存</button>`,
    `<span id="save-html-status" class="muted" aria-live="polite"></span>`,
    `</div>`,
  ].join("");
}

function buildFooter(bundle: AnalysisBundle, anon: Anonymizer): string {
  const s = bundle.summary as any;
  const name = htmlEscape(anon.subject(s.source.username));
  const date = htmlEscape(String(s.source.fetched_at).slice(0, 10));
  return [
    "<footer>",
    "<b>指標定義と注意書き（まとめ）</b>",
    "<p>APP = APM/(PPS×60)、DS/S = VS/100 － APM/60、DS/P = DS/S ÷ PPS、GbE = (APP×DS/S/PPS)×2、Area は同じ入力列から再計算、4スタイル値（Opener/Stride/Inf DS/Plonk）・Est. TR は入力の派生指標列を使用。VS/APM は VS÷APM（APM=0は欠損）。</p>",
    "<p><b>期待勝率</b>：対戦前Glickoと相手RDから標準Glicko期待スコアを算出。表のnはDQ勝・DQ負を含む公式勝敗マッチ数、期待勝率はGlicko/RD欠損を除いたマッチ数を分母にする。TETR.IO内部のTR計算を再現するものではない。</p>",
    `<p><b>因果の注意</b>：各図の解釈上の限界は<a href="#notes">注意事項（全図共通）</a>にまとめた。</p>`,
    "<p><b>データ処理</b>：現在値はTETRA CHANNEL summaries/league、履歴分析はrecent recordsから生成。マッチ単位へは、勝敗・TR・Glicko/RD・スコアはマッチの代表値、能力指標はAPIの試合集計値（leaderboard.stats）優先、欠損時のみラウンド平均で補完。DQ勝（dqvictory）・DQ負（dqdefeat）は公式勝敗として集計し、tie・無効（nullified）・no contestは勝敗分析から除外。Glicko/RD欠損マッチは期待勝率分析から除外。APIレスポンスはリプレイや盤面の個別状態を含まないため、開幕・盤面・相殺・入力ミス・回線状態は識別できない。</p>",
    `<p><b>帰属</b>：本レポートは非公式ツールで生成。TETR.IO / osk とは無関係。"TETR.IO" は権利者の商標。Est. TR、4スタイル値、Cheese Indexなどの派生指標は<a href="https://github.com/dan63047/TetraStats">TetraStats</a>由来の計算式を使用。生成ツールは<a href="https://github.com/61bi-234469/tetrio_report_app">MITライセンスで公開</a>。${name} の公開Tetra Leagueデータから生成。</p>`,
    `<p class="muted">生成日 ${date}（JST）／ 自己完結HTML・外部依存なし。グラフはChart.jsでcanvasに描画。</p>`,
    "</footer>",
  ].join("");
}

export interface RenderOptions {
  anonymize?: boolean;
}

export function renderDocument(bundle: AnalysisBundle, options: RenderOptions = {}): string {
  const s = bundle.summary as any;
  const anon = createAnonymizer(Boolean(options.anonymize));
  const chartConfigs = buildChartConfigs(bundle, anon);
  const title = `戦績レポート for TETR.IO — ${anon.subject(s.source.username)}`;
  const truncatedNotice = s.source.truncated
    ? `<div class="note-box">取得ページ数の上限に達したため、取得できた直近${s.source.rows.records}件で作成。</div>`
    : "";
  return [
    "<!doctype html>",
    `<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">`,
    `<title>${htmlEscape(title)}</title><link rel="icon" href="data:,"><style>${REPORT_CSS}</style></head><body>`,
    `<a id="top"></a>`,
    `<div class="wrap">`,
    `<header class="top"><h1>戦績レポート for TETR.IO</h1><div class="sub">${buildSubtitle(bundle, anon)}</div></header>`,
    buildReportActions(bundle, anon),
    truncatedNotice,
    buildKpis(bundle),
    buildGlossary(bundle),
    `<div class="note-box">${buildNoteBox(bundle)}</div>`,
    `<div class="toc">${buildToc()}</div>`,
    renderChapters(bundle, anon),
    renderAppendices(bundle),
    caveatNotes(),
    buildFooter(bundle, anon),
    `</div>`,
    `<a class="backtop" href="#top">↑ 目次</a>`,
    `<script>${CHART_RUNTIME}</script>`,
    `<script>${REPORT_SAVE_BOOT}</script>`,
    `<script>${REPORT_MOBILE_BOOT}</script>`,
    `<script>const CHART_CONFIGS=${JSON.stringify(chartConfigs)};${CHART_BOOT}</script>`,
    `</body></html>`,
  ].join("");
}

export function renderMessagePage(status: number, title: string, message: string): Response {
  const html = [
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex, nofollow\">",
    `<title>${htmlEscape(title)}</title><link rel="icon" href="data:,"><style>${REPORT_CSS}</style></head><body>`,
    `<div class="wrap"><main class="message"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p><a href="/">フォームへ戻る</a></main></div>`,
    "</body></html>",
  ].join("");
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
