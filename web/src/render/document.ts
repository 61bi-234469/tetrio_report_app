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

const INT = (v: unknown): string => nfmt(v, 0, true);

function buildSubtitle(bundle: AnalysisBundle, anon: Anonymizer): string {
  const s = bundle.summary as any;
  const meta = s.meta;
  const name = anon.subject(s.source.username);
  return (
    `対象プレイヤー：<b>${htmlEscape(name)}</b>　／　対象期間：${datefmt(meta.start)} 〜 ${datefmt(meta.end)}（JST）　／　生成日：${htmlEscape(String(s.source.fetched_at).slice(0, 10))}<br>` +
    `公式マッチ数 ${INT(meta.matches)}　通常分析 ${INT(meta.analysis_matches ?? meta.matches)}マッチ　ラウンド数 ${INT(meta.rounds)}　セッション数 ${INT(meta.sessions ?? 0)}　稼働日数 ${meta.active_days}日　対戦相手 ${INT(meta.opponents)}名`
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
    ["CV", TERM_TITLES.CV],
    ["Cohen's d", TERM_TITLES["Cohen's d"]],
    ["AUC/Brier/Log loss", "モデルの当たり具合。AUCは高いほど、BrierとLog lossは低いほど良い。"],
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
    `<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
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
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${htmlEscape(title)}</title><link rel="icon" href="data:,"><style>${REPORT_CSS}</style></head><body>`,
    `<div class="wrap"><main class="message"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p><a href="/">フォームへ戻る</a></main></div>`,
    "</body></html>",
  ].join("");
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const REPORT_SAVE_BOOT = `
(function(){
  const button=document.getElementById('save-html-button');
  if(!button)return;
  const status=document.getElementById('save-html-status');
  const actions=button.closest('.report-actions');
  button.addEventListener('click',function(){
    const filename=(actions&&actions.getAttribute('data-filename'))||'tetrio_report.html';
    const html='<!doctype html>\\n'+document.documentElement.outerHTML;
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},30000);
    if(status)status.textContent='保存ファイルを作成。';
  });
}());
`;

// モバイルの列優先表で「全列を表示／主要列だけ表示」を切り替える。
const REPORT_MOBILE_BOOT = `
(function(){
  document.querySelectorAll('.mobile-toggle').forEach(function(btn){
    btn.addEventListener('click',function(){
      var box=btn.closest('.mobile-priority');
      if(!box)return;
      var open=box.classList.toggle('show-all');
      btn.setAttribute('aria-expanded',open?'true':'false');
      btn.textContent=open?'主要列だけ表示':'全列を表示';
    });
  });
}());
`;

// Chart.js 描画ブートストラップ。configs.ts の $pct / $unit / $notes / $pointLabels /
// options.refLines マーカーを解釈する（関数はJSON化できないためここで付与する）。
const CHART_BOOT = `
Chart.defaults.font.family='"Noto Sans CJK JP","Hiragino Kaku Gothic ProN",system-ui,sans-serif';
Chart.defaults.font.size=11.5;
Chart.defaults.color='#374151';
Chart.register({id:'refLines',afterDatasetsDraw(chart){
  const lines=(chart.options&&chart.options.refLines)||[];const area=chart.chartArea;const ctx=chart.ctx;
  for(const line of lines){
    const scale=chart.scales[line.axis||(line.x!==undefined?'x':'y')];
    if(!scale||!area)continue;
    ctx.save();ctx.strokeStyle=line.color||'#94a3b8';ctx.lineWidth=1;
    ctx.setLineDash(line.dash===undefined?[5,4]:line.dash);ctx.beginPath();
    if(line.x!==undefined){const px=scale.getPixelForValue(line.x);
      if(px>=area.left-1&&px<=area.right+1){ctx.moveTo(px,area.top);ctx.lineTo(px,area.bottom);}}
    else{const py=scale.getPixelForValue(line.y);
      if(py>=area.top-1&&py<=area.bottom+1){ctx.moveTo(area.left,py);ctx.lineTo(area.right,py);}}
    ctx.stroke();ctx.restore();
  }
}});
Chart.register({id:'pointTextLabels',afterDatasetsDraw(chart){
  chart.data.datasets.forEach(function(ds,di){
    const labels=ds.$pointLabels;if(!labels)return;
    const meta=chart.getDatasetMeta(di);if(meta.hidden)return;
    meta.data.forEach(function(el,i){
      const text=labels[i];if(!text||ds.data[i]==null)return;
      const ctx=chart.ctx;ctx.save();
      ctx.font='bold 10px sans-serif';ctx.fillStyle=ds.borderColor||'#111827';
      ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillText(String(text),el.x,el.y-7);ctx.restore();
    });
  });
}});
function radarUnits(labels){const n=labels.length;
  return labels.map(function(_,i){const a=Math.PI/2-(i*2*Math.PI/n);return{x:Math.cos(a),y:Math.sin(a)};});}
function radarRingStep(radialMax){const raw=radialMax/4;
  const pow=Math.pow(10,Math.floor(Math.log10(raw)));const m=raw/pow;
  return (m>=5?5:m>=2.5?2.5:m>=2?2:m>=1?1:0.5)*pow;}
Chart.register({id:'signedRadar',beforeDatasetsDraw(chart,args,opts){
  if(!opts||!opts.labels)return;
  const xs=chart.scales.x,ys=chart.scales.y;if(!xs||!ys)return;
  const radialMax=opts.radialMax||1,ctx=chart.ctx,units=radarUnits(opts.labels);
  const path=function(r){units.forEach(function(u,i){const px=xs.getPixelForValue(u.x*r),py=ys.getPixelForValue(u.y*r);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);});ctx.closePath();};
  const step=radarRingStep(radialMax);
  const rings=[];for(let r=step;r<=radialMax*1.001;r+=step)rings.push(r);
  ctx.save();
  ctx.fillStyle='rgba(100,116,139,.055)';
  for(let i=0;i<rings.length;i+=2){ctx.beginPath();path(rings[i]);if(i>0)path(rings[i-1]);ctx.fill('evenodd');}
  rings.forEach(function(r,i){
    ctx.beginPath();path(r);
    const outer=i===rings.length-1;
    ctx.strokeStyle=outer?'#b8bfcc':'#d9dde5';ctx.lineWidth=outer?1.2:.8;ctx.stroke();
  });
  ctx.strokeStyle='#c9cfda';ctx.lineWidth=.8;
  units.forEach(function(u){ctx.beginPath();ctx.moveTo(xs.getPixelForValue(-u.x*radialMax),ys.getPixelForValue(-u.y*radialMax));ctx.lineTo(xs.getPixelForValue(u.x*radialMax),ys.getPixelForValue(u.y*radialMax));ctx.stroke();});
  ctx.font='9.5px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.9)';
  rings.forEach(function(r){
    const text=String(Math.round(r*100)/100);
    const px=xs.getPixelForValue(0)+5,py=ys.getPixelForValue(r);
    ctx.strokeText(text,px,py);ctx.fillStyle='#98a0ad';ctx.fillText(text,px,py);
  });
  ctx.restore();
},afterDatasetsDraw(chart,args,opts){
  if(!opts||!opts.labels)return;
  const xs=chart.scales.x,ys=chart.scales.y;if(!xs||!ys)return;
  const radialMax=opts.radialMax||1,ctx=chart.ctx,units=radarUnits(opts.labels),labelRadius=radialMax*1.08;
  ctx.save();ctx.font='bold 10.5px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.92)';ctx.lineJoin='round';
  opts.labels.forEach(function(label,i){
    const u=units[i],text=String(label);
    const half=ctx.measureText(text).width/2;
    const px=Math.min(Math.max(xs.getPixelForValue(u.x*labelRadius),half+2),chart.width-half-2);
    const py=ys.getPixelForValue(u.y*labelRadius);
    ctx.strokeText(text,px,py);ctx.fillStyle='#334155';ctx.fillText(text,px,py);
  });
  ctx.fillStyle='#94a3b8';ctx.beginPath();ctx.arc(xs.getPixelForValue(0),ys.getPixelForValue(0),2.5,0,Math.PI*2);ctx.fill();ctx.restore();
}});
function fmtVal(v){if(v==null||!isFinite(v))return'—';
  if(Math.abs(v)>=1000)return Math.round(v).toLocaleString();
  return String(Math.round(v*100)/100);}
function hexA(hex,a){const c=hex.replace('#','');
  return'rgba('+parseInt(c.slice(0,2),16)+','+parseInt(c.slice(2,4),16)+','+parseInt(c.slice(4,6),16)+','+a+')';}
function radarFillGradient(chart,color,alpha){
  const xs=chart.scales.x,ys=chart.scales.y;
  const edge=Math.min(1,alpha*1.7),center=alpha*.3;
  if(!xs||!ys||!chart.chartArea)return hexA(color,alpha);
  const sr=(chart.options.plugins&&chart.options.plugins.signedRadar)||{};
  const cx=xs.getPixelForValue(0),cy=ys.getPixelForValue(0);
  const r=Math.max(1,Math.abs(xs.getPixelForValue(sr.radialMax||1)-cx));
  const g=chart.ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  g.addColorStop(0,hexA(color,center));g.addColorStop(1,hexA(color,edge));
  return g;}
function enhanceConfig(cfg){
  const o=cfg.options=cfg.options||{};
  const scales=o.scales||{};
  if(o.$signedRadar){cfg.data.datasets.forEach(function(ds){
    if(!ds.$fillColor)return;
    const col=ds.$fillColor,alpha=ds.$fillAlpha||.15;
    ds.backgroundColor=function(c){return radarFillGradient(c.chart,col,alpha);};
  });}
  for(const key of Object.keys(scales)){const s=scales[key];
    if(s&&s.$pct){s.ticks=Object.assign({},s.ticks,{callback:function(v){return v+'%';}});}}
  const horizontal=o.indexAxis==='y';
  o.plugins=o.plugins||{};
  o.plugins.legend=o.plugins.legend||{};
  o.plugins.legend.labels=Object.assign({},o.plugins.legend.labels,{sort:function(a,b){return a.datasetIndex-b.datasetIndex;}});
  o.plugins.tooltip=Object.assign({},o.plugins.tooltip,{callbacks:{
    label:function(c){const ds=c.dataset;const name=ds.label?ds.label+': ':'';
      if(ds.$radarValues){const axis=ds.$radarLabels&&ds.$radarLabels[c.dataIndex]?ds.$radarLabels[c.dataIndex]+': ':'';return name+axis+fmtVal(ds.$radarValues[c.dataIndex]);}
      if(cfg.type==='scatter'){return name+'('+fmtVal(c.parsed.x)+', '+fmtVal(c.parsed.y)+')';}
      if(Array.isArray(c.raw)){return name+fmtVal(c.raw[0])+' 〜 '+fmtVal(c.raw[1])+(ds.$unit||'');}
      const raw=cfg.type==='radar'?c.parsed.r:(horizontal?c.parsed.x:c.parsed.y);
      return name+fmtVal(raw)+(ds.$unit||'');},
    afterLabel:function(c){const notes=c.dataset.$notes;
      return notes&&notes[c.dataIndex]?String(notes[c.dataIndex]):'';}
  }});
}
for(const [id,cfg] of Object.entries(CHART_CONFIGS)){
  const el=document.getElementById(id);
  if(!el)continue;
  enhanceConfig(cfg);
  if(cfg.options&&cfg.options.$signedRadar){const box=el.closest('.chart');if(box)box.classList.add('signed-radar');}
  else if(cfg.type==='radar'||cfg.type==='scatter'||(cfg.options&&cfg.options.$tall)){const box=el.closest('.chart');if(box)box.classList.add('tall');}
  new Chart(el,cfg);
}
`;

// src/report_builder/template/report.css を移植し、canvas 描画用の .fig .chart 規則を追加。
const REPORT_CSS = `
:root{--ink:#15161e;--muted:#6b7280;--grid:#e8e9ef;--primary:#6366f1;--win:#0f9b6e;--loss:#c2410c;--amber:#f59e0b;--cyan:#06b6d4;--violet:#8b5cf6;--bg:#fbfbfd;--card:#fff;--issue:#c2410c;--neutral:#2563eb;}
*{box-sizing:border-box}
body{font-family:"Noto Sans CJK JP","Hiragino Kaku Gothic ProN",system-ui,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.85;font-size:15.5px;}
.wrap{max-width:980px;margin:0 auto;padding:32px 22px 80px;}
header.top{border-bottom:2px solid var(--ink);padding-bottom:20px;margin-bottom:8px;}
header.top h1{font-size:30px;margin:0 0 6px;letter-spacing:.01em;}
header.top .sub{color:var(--muted);font-size:14px;}
a{color:#4f46e5;}
.report-actions{display:flex;align-items:center;gap:10px;margin:16px 0 8px;}
.report-actions button{appearance:none;border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:8px;padding:7px 13px;font-weight:800;font-size:13px;cursor:pointer;}
.report-actions button:hover{background:#30313d;}
.report-actions span{font-size:12.5px;}
h2.part{font-size:15px;font-weight:800;letter-spacing:.04em;color:var(--primary);margin:64px 0 0;display:flex;align-items:center;gap:12px;scroll-margin-top:16px;}
h2.part .pno{background:var(--primary);color:#fff;border-radius:8px;padding:4px 12px;font-size:13px;font-weight:800;}
h2.part::after{content:"";flex:1;height:2px;background:var(--primary);opacity:.22;}
h2.part + h2.chap{margin-top:14px;border-top:none;padding-top:0;}
h2.chap{font-size:23px;margin:54px 0 4px;padding-top:10px;border-top:1px solid var(--grid);display:flex;align-items:baseline;gap:12px;scroll-margin-top:16px;}
h2.chap .no{color:var(--primary);font-weight:800;font-size:16px;background:#eef0ff;border-radius:8px;padding:3px 11px;}
h2.chap .toclink{margin-left:auto;font-size:12px;font-weight:700;color:var(--muted);text-decoration:none;}
h2.chap .toclink:hover{color:var(--primary);}
h3{font-size:17px;margin:30px 0 6px;color:var(--ink);}
.lead{color:var(--muted);font-size:14.5px;margin:2px 0 14px;}
p{margin:10px 0;}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0 8px;}
.kpi{background:var(--card);border:1px solid var(--grid);border-radius:14px;padding:15px 16px;}
.kpi .lab{font-size:12px;color:var(--muted);letter-spacing:.02em;}
.kpi .val{font-size:25px;font-weight:800;margin-top:3px;}
.kpi .note{font-size:11.5px;color:var(--muted);margin-top:2px;}
.badge{display:inline-block;font-size:11.5px;font-weight:800;border-radius:999px;padding:1px 8px;margin-right:7px;white-space:nowrap;}
.badge.neutral{background:#dbeafe;color:#1d4ed8;}
.badge.hi{background:#e0e7ff;color:#4338ca;}
.badge.mid{background:#f3f4f6;color:#4b5563;}
.badge.good{background:#d1fae5;color:#047857;}
.badge.bad{background:#ffe4e6;color:#be123c;}
.glossary{font-size:13.5px;}
.glossary dl{display:grid;grid-template-columns:minmax(80px,130px) 1fr;gap:6px 12px;margin:8px 0 4px;}
.glossary dt{font-weight:800;}
.glossary dd{margin:0;color:var(--muted);}
abbr[title]{text-decoration:underline dotted;text-underline-offset:3px;cursor:help;}
.toc{background:var(--card);border:1px solid var(--grid);border-radius:14px;padding:18px 22px;margin:26px 0;}
.toc ol{margin:6px 0;padding-left:22px;} .toc li{margin:3px 0;}
.toc .toc-part{font-weight:800;color:var(--primary);font-size:13px;letter-spacing:.03em;margin:12px 0 2px;}
.toc .toc-part:first-of-type{margin-top:6px;}
.toc a{color:var(--ink);text-decoration:none;border-bottom:1px solid transparent;}
.toc a:hover{border-bottom-color:var(--primary);color:var(--primary);}
.fig{margin:18px 0 4px;text-align:center;}
.fig .chart{height:330px;border:1px solid var(--grid);border-radius:12px;background:#fff;padding:12px 14px;box-shadow:0 1px 2px rgba(15,16,30,.04);}
.fig .chart.tall{height:420px;}
.fig .chart.signed-radar{height:600px;max-width:560px;margin:0 auto;}
.fig .chart canvas{width:100%!important;height:100%!important;}
.block{background:var(--card);border:1px solid var(--grid);border-left:4px solid var(--primary);border-radius:0 12px 12px 0;padding:14px 18px;margin:14px 0 26px;}
.block .tag{display:inline-block;font-size:11.5px;font-weight:700;color:var(--primary);background:#eef0ff;border-radius:6px;padding:1px 9px;margin-right:7px;}
.block .tag.warn{color:var(--issue);background:#fff1ec;}
.block p{margin:7px 0;font-size:13.5px;line-height:1.7;}
.block .caption,.block .headline{color:var(--ink);font-size:13.5px;font-weight:400;}
.block .caption{margin:0 0 7px;}
.block .caveat{margin:9px 0 0;font-size:12.5px;line-height:1.6;}
.caveat-tag{display:inline-block;color:var(--muted);background:#f4f5fb;border:1px solid var(--grid);border-radius:999px;padding:1px 9px;margin:2px 6px 2px 0;font-size:12px;font-weight:700;text-decoration:none;}
.caveat-tag:hover{color:var(--issue);border-color:var(--issue);}
.notes{margin:44px 0 0;font-size:13.5px;}
.notes dt{scroll-margin-top:20px;}
table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0;}
th,td{border:1px solid var(--grid);padding:6px 9px;text-align:right;}
th{background:#f4f5fb;color:var(--ink);font-weight:700;}
td.l,th.l{text-align:left;}
.dir{font-size:11px;color:var(--muted);font-weight:700;margin-left:2px;}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
.scroll table{min-width:880px;}
.mobile-toggle{display:none;appearance:none;border:1px solid var(--grid);background:#fff;color:var(--muted);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:2px 0 6px;}
.mobile-toggle:hover{color:var(--primary);border-color:var(--primary);}
.only-mobile{display:none;}
.rc-list{margin:12px 0;}
.rc-card{border:1px solid var(--grid);border-radius:10px;background:var(--card);padding:10px 13px;margin:9px 0;}
.rc-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap;line-height:1.5;}
.rc-cond{font-weight:700;font-size:13.5px;}
.rc-detail{font-size:12px;color:var(--muted);margin-top:3px;}
.rc-detail:empty{display:none;}
.rc-target{font-size:13px;margin-top:6px;}
.rc-link{margin-top:7px;font-size:13px;font-weight:700;}
details{background:var(--card);border:1px solid var(--grid);border-radius:12px;padding:6px 16px;margin:14px 0;}
summary{cursor:pointer;font-weight:700;padding:8px 0;font-size:15px;}
.backtop{position:fixed;right:16px;bottom:16px;background:var(--ink);color:#fff;text-decoration:none;border-radius:999px;padding:7px 11px;font-size:12px;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.16);}
.muted{color:var(--muted);}
.message{padding:48px 0;} .message a{color:var(--primary);font-weight:700;}
footer{margin-top:60px;border-top:1px solid var(--grid);padding-top:20px;color:var(--muted);font-size:12.5px;}
.note-box{background:#fffdf5;border:1px solid #f3e6c0;border-radius:12px;padding:12px 18px;margin:16px 0;font-size:13.5px;}
@media (max-width:700px){
  .wrap{padding:24px 14px 72px;}
  header.top h1{font-size:24px;}
  h2.chap{font-size:20px;gap:8px;}
  h2.chap .toclink{font-size:11px;}
  .glossary dl{display:block;}
  .glossary dt{margin-top:6px;}
  .fig .chart{height:270px;}
  .fig .chart.tall{height:340px;}
  .fig .chart.signed-radar{height:400px;max-width:360px;}
  .scroll.mobile-card{overflow:visible;}
  .scroll.mobile-card table,.scroll.mobile-card thead,.scroll.mobile-card tbody,.scroll.mobile-card tr,.scroll.mobile-card th,.scroll.mobile-card td{display:block;width:100%;min-width:0!important;}
  .scroll.mobile-card thead{display:none;}
  .scroll.mobile-card tr{border:1px solid var(--grid);border-radius:8px;background:#fff;margin:10px 0;padding:6px 8px;}
  .scroll.mobile-card td{border:0;border-bottom:1px solid #f0f1f5;text-align:left;padding:6px 2px 6px 42%;position:relative;min-height:28px;}
  .scroll.mobile-card td:last-child{border-bottom:0;}
  .scroll.mobile-card td::before{content:attr(data-label);position:absolute;left:2px;top:6px;width:38%;color:var(--muted);font-weight:700;white-space:normal;}
  .only-desktop{display:none;}
  .only-mobile{display:block;}
  .scroll:not(.mobile-priority) table,.scroll.mobile-priority:not(.show-all) table{min-width:0!important;}
  .scroll.mobile-priority:not(.show-all) .mhide{display:none;}
  .scroll:not(.mobile-card) th,.scroll:not(.mobile-card) td{padding:5px 6px;}
  .mobile-toggle{display:inline-block;}
}
@media print{.kpi,.block,.toc{break-inside:avoid;} body{font-size:12px;} .fig .chart{height:260px;} .fig .chart.signed-radar{height:500px;max-width:460px;}}
`;
