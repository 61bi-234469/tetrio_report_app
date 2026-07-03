import { htmlEscape } from "../utils";
import { type CaveatId, caveatTags } from "./caveats";
import { DIRECTION, TERM_TITLES, datefmt, nfmt, pct, pp } from "./format";

// 方向注記を付与する見出しラベル集合（render_report.py header_html 準拠）。
const DIRECTION_UP = new Set([
  "APM", "PPS", "VS", "APP", "DS/S", "DS/Second", "DS/P", "DS/Piece", "APP+DS/Piece",
  "GbE", "Garbage Eff.", "VS/APM", "Cheese Index", "Area", "Est. TR", "AUC",
  "勝率", "期待超過", "TR増減", "ピーク", "現在TR", "ピークTR",
]);

export function term(label: string, text?: string): string {
  const shown = text ?? label;
  const title = TERM_TITLES[label];
  if (!title) {
    return htmlEscape(shown);
  }
  return `<abbr title="${htmlEscape(title)}">${htmlEscape(shown)}</abbr>`;
}

export function headerHtml(label: string, showDirection = true): string {
  const raw = String(label);
  const title = TERM_TITLES[raw];
  let base = title ? term(raw) : htmlEscape(raw);
  let direction = DIRECTION[raw];
  if (DIRECTION_UP.has(raw)) {
    direction = direction ?? "↑良い";
  }
  if (showDirection && direction) {
    base += ` <span class="dir">${htmlEscape(direction)}</span>`;
  }
  return base;
}

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export function confidence(n: number, effect: number | null = null): [string, string] {
  if (n >= 500 && (effect === null || Math.abs(effect) >= 0.03)) {
    return ["高", "hi"];
  }
  if (n >= 100) {
    return ["中", "mid"];
  }
  return ["低", "lo"];
}

// Chart.js 用に canvas を出す（Python版は base64 PNG の <img>）。
export function fig(chartId: string, alt: string): string {
  return `<div class="fig"><div class="chart"><canvas id="${htmlEscape(chartId)}" aria-label="${htmlEscape(alt)}"></canvas></div></div>`;
}

export function grain(label: string): string {
  return `<p><span class="badge neutral">粒度</span>${htmlEscape(label)}</p>`;
}

// 定量寄りの図解説ブロック。読み方と要点は同じ本文階層で扱い、
// 数字の詳細はチャート・表に寄せる。
// 「要点1文（headline）＋注意タグ（caveats）＋任意の短い読み方（caption）」に絞る。
// caveats は caveats.ts のIDで参照し、実文はレポート末尾に一度だけ描く。
export function block(headline: string, caveats: CaveatId[] = [], caption?: string): string {
  const parts = [`<div class="block">`];
  if (caption) {
    parts.push(`<p class="caption"><span class="tag">読み方</span>${caption}</p>`);
  }
  parts.push(`<p class="headline"><span class="tag">要点</span>${headline}</p>`);
  parts.push(caveatTags(caveats));
  parts.push(`</div>`);
  return parts.join("");
}

export type Cell = string | number | null | undefined;

export function table(
  headers: string[],
  rows: Cell[][],
  options: {
    leftCols?: Set<number>;
    minWidth?: number;
    showDirection?: boolean;
    // モバイル表示戦略。"card"=1行1カード、mobileColumns=主要列だけ残し残りは折りたたむ。
    mobile?: "card";
    mobileColumns?: number[];
  } = {},
): string {
  const leftCols = options.leftCols ?? new Set([0]);
  const showDirection = options.showDirection ?? true;
  const minWidth = options.minWidth;
  const mobileColumns = options.mobileColumns;
  const usePriority = Boolean(mobileColumns && mobileColumns.length);
  const isHidden = (i: number): boolean => usePriority && !mobileColumns!.includes(i);
  const cellClass = (i: number): string => {
    const cls: string[] = [];
    if (leftCols.has(i)) cls.push("l");
    if (isHidden(i)) cls.push("mhide");
    return cls.length ? ` class="${cls.join(" ")}"` : "";
  };
  const formattedHeaders = headers.map((h) => headerHtml(String(h), showDirection));
  const labels = formattedHeaders.map((h) => htmlEscape(plainText(h)));
  const th = formattedHeaders.map((h, i) => `<th${cellClass(i)}>${h}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map((v, i) => {
          const content = typeof v === "string" ? v : htmlEscape(String(v ?? "—"));
          return `<td${cellClass(i)} data-label="${labels[i] ?? ""}">${content}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const style = minWidth ? ` style="min-width:${minWidth}px"` : "";
  const cols = headers.length;
  let mobileCls = "";
  if (usePriority) {
    mobileCls = " mobile-priority";
  } else if (options.mobile === "card" || (!minWidth && cols >= 5 && cols <= 6)) {
    mobileCls = " mobile-card";
  }
  const toggle = usePriority
    ? `<button type="button" class="mobile-toggle" aria-expanded="false">全列を表示</button>`
    : "";
  return `<div class="scroll${mobileCls}">${toggle}<table${style}><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export interface RecordEntry {
  name: string;
  value: unknown;
  unit: string;
  date?: unknown;
  scope: string;
  note?: string | null;
}

export function recordValueCell(r: Record<string, any>): string {
  const unit = r.unit ?? "";
  const v = r.value;
  if (unit === "ランク") {
    return v !== null && v !== undefined ? htmlEscape(String(v).toUpperCase()) : "—";
  }
  if (unit === "%" && v !== null && v !== undefined) {
    const f = Number(v);
    if (Number.isFinite(f) && Math.abs(f) <= 1) {
      return pct(v);
    }
  }
  const digits = ["APP", "DS/S", "DS/P", "GbE", "VS/APM"].includes(unit) ? 3 : 1;
  return nfmt(v, digits, unit === "TR");
}

export function recordsTableHtml(records: Array<Record<string, any>>): string {
  const rows: Cell[][] = records.map((r) => [
    htmlEscape(String(r.name)),
    recordValueCell(r),
    htmlEscape(String(r.unit ?? "")),
    datefmt(r.date),
    htmlEscape(String(r.scope ?? "")),
    htmlEscape(String(r.note ?? "")),
  ]);
  return table(["記録", "値", "単位", "日付", "粒度", "注意"], rows, {
    leftCols: new Set([0, 4, 5]),
    minWidth: 900,
    showDirection: false,
    mobile: "card",
  });
}

export function selectedRecordsCardsHtml(records: Array<Record<string, any>>): string {
  const preferred = ["最高TR", "最高ランク", "勝利した相手最高TR", "最長連勝", "最長連敗", "最高単マッチAPM"];
  const byName = new Map(records.map((r) => [r.name, r]));
  const selected = preferred.map((name) => byName.get(name)).filter(Boolean).slice(0, 6) as Array<Record<string, any>>;
  if (selected.length === 0) {
    return `<p class="muted">表示できる記録なし。</p>`;
  }
  const cards = selected
    .map((record) => {
      const note = [htmlEscape(String(record.unit ?? "")), datefmt(record.date), htmlEscape(String(record.scope ?? ""))]
        .filter((part) => part && part !== "—")
        .join("／");
      return `<div class="kpi"><div class="lab">${htmlEscape(String(record.name))}</div><div class="val">${recordValueCell(record)}</div><div class="note">${note}</div></div>`;
    })
    .join("");
  return `<div class="kpis">${cards}</div>`;
}

export function selectedRecordKpis(records: Array<Record<string, any>>): Array<{ label: string; value: string; note: string }> {
  const preferred = ["最高ランク", "勝利した相手最高TR", "タイブレーク勝率", "最長連勝", "最長連敗"];
  const byName = new Map(records.map((r) => [r.name, r]));
  const out: Array<{ label: string; value: string; note: string }> = [];
  for (const name of preferred) {
    const record = byName.get(name);
    if (!record) {
      continue;
    }
    const note = [datefmt(record.date), record.scope ?? ""].filter((part) => part && part !== "—").join("／");
    out.push({ label: record.name, value: recordValueCell(record), note: note || htmlEscape(String(record.unit ?? "")) });
  }
  return out;
}

export function advantageRows(rows: Array<Record<string, any>>): Cell[][] {
  return rows.map((r) => [htmlEscape(String(r.label)), r.n, pct(r.actual), pct(r.expected), pp(r.excess)]);
}

export function advantageTable(rows: Array<Record<string, any>>): string {
  return table(["分類", "試合数", "実績勝率", "期待勝率", "期待超過"], advantageRows(rows), {
    leftCols: new Set([0]),
    minWidth: 720,
    showDirection: false,
    mobile: "card",
  });
}

export function kpisHtml(items: Array<{ label: string; value: string; note?: string }>): string {
  const cards = items
    .map(
      (item) =>
        `<div class="kpi"><div class="lab">${htmlEscape(item.label)}</div><div class="val">${item.value}</div><div class="note">${item.note ?? ""}</div></div>`,
    )
    .join("");
  return `<div class="kpis">${cards}</div>`;
}
