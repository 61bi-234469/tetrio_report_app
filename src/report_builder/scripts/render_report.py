#!/usr/bin/env python3
"""分析結果からヘッダー、8章、折り畳み付録を自動生成する。"""
from __future__ import annotations

from datetime import datetime
from html import escape
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from report_analysis import AnalysisBundle, STYLE_ORDER

PROJECT_ROOT = Path(__file__).resolve().parents[1]
GENERATED_ROOT = Path("cache") / "generated"
GENERATED_CHAPTERS = GENERATED_ROOT / "chapters"
GENERATED_APPENDICES = GENERATED_ROOT / "appendices.html"

# 章タイトル（番号順）。TOC・chapter_index・本文で共有する単一の真実。
CHAPTER_TITLES = [
    "全体像と基本指標",
    "成長推移と安定性",
    "能力バランス",
    "勝敗に関係しやすい指標",
    "対戦相手の強さと期待値",
    "接戦・決着局面",
    "ラウンド展開と試合時間",
    "連戦の流れとセッション内の試合位置",
]
# 部（大セクション）。各タプルは (ローマ数字, 部名, 開始章番号)。
# 部はその開始章から次の部の開始章直前までを範囲とし、TOC・本文の部見出しで共有する。
PARTS = [
    ("Ⅰ", "全体像", 1),
    ("Ⅱ", "能力の特徴", 2),
    ("Ⅲ", "勝敗との関係", 4),
    ("Ⅳ", "状況別・推移の補助分析", 6),
]
# 章番号 -> (ローマ数字, 部名, 部index)。その章が部の先頭かを判定する。
PART_AT = {start: (roman, name, i + 1) for i, (roman, name, start) in enumerate(PARTS)}
# 付録ID・タイトル（chapter_index の補助情報用）。
APPENDIX_INDEX = [
    {"id": "appendix-monthly", "title": "付録A 月別集計"},
    {"id": "appendix-records", "title": "付録B 検証済みパーソナルレコード"},
    {"id": "appendix-excess-grid", "title": "付録C 曜日・時間帯×セッション位置の期待値調整後成績"},
]

TERM_TITLES = {
    "APM": "Attack Per Minute。1分あたりの攻撃量。",
    "PPS": "Pieces Per Second。1秒あたりの操作ピース数。",
    "VS": "Versus score。攻撃・防御を含む総合圧力の目安。",
    "APP": "Attack Per Piece。1ピースあたりの攻撃効率。",
    "DS/S": "Downstack per Second。1秒あたりの掘り量の目安。",
    "DS/P": "Downstack per Piece。1ピースあたりの掘り効率。",
    "GbE": "Garbage Efficiency。送ったお邪魔の効率の目安。",
    "Garbage Eff.": "Garbage Efficiency。送ったお邪魔の効率の目安。",
    "VS/APM": "攻撃量に対する総合圧力。高いほど守備・相殺込みの圧が出ている目安。",
    "Cheese Index": "穴の散らばり・受けの荒れやすさの補助指標。高ければ常に良いとは限らない。",
    "Glicko": "TETR.IOの実力推定に近いレーティング系指標。",
    "RD": "Rating Deviation。レート推定の不確実性。",
    "AUC": "勝者を上位に並べる性能。高いほど良い。",
    "Brier": "予測確率の誤差。低いほど良い。",
    "Log loss": "予測確率の外し方への罰則。低いほど良い。",
    "Cohen's d": "勝利時と敗北時の差の大きさ。絶対値が大きいほど差が大きい。",
    "CV": "変動係数。平均に対するばらつき。低いほど安定。",
    "期待勝率": "対戦前Glicko/RDから見た勝つ確率の目安。",
    "期待超過": "実績勝率から期待勝率を引いた差。プラスなら期待以上。",
    "TR": "TETRA LEAGUE rating。TETR.IO上のレート。",
}

DIRECTION = {
    "Brier": "↓良い",
    "Log loss": "↓良い",
    "最大DD": "浅いほど良い",
    "最大ドローダウン": "浅いほど良い",
    "Cheese Index": "低めが安定寄り",
    "CV": "↓良い",
}


def nfmt(v: Any, digits: int = 1, comma: bool = False, default: str = "—") -> str:
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return escape(str(v))
    if not np.isfinite(f):
        return default
    spec = f",.{digits}f" if comma else f".{digits}f"
    return format(f, spec)


def pct(v: Any, digits: int = 1, signed: bool = False) -> str:
    if v is None:
        return "—"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "—"
    if not np.isfinite(f):
        return "—"
    sign = "+" if signed and f > 0 else ""
    return f"{sign}{f * 100:.{digits}f}%"


def pp(v: Any, digits: int = 1, signed: bool = True) -> str:
    if v is None:
        return "—"
    try:
        f = float(v) * 100
    except (TypeError, ValueError):
        return "—"
    if not np.isfinite(f):
        return "—"
    sign = "+" if signed and f > 0 else ""
    return f"{sign}{f:.{digits}f}pt"


def sgn(v: Any, digits: int = 1) -> str:
    if v is None:
        return "—"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return "—"
    if not np.isfinite(f):
        return "—"
    return f"{f:+.{digits}f}"


def datefmt(v: Any) -> str:
    if not v:
        return "—"
    try:
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    except Exception:
        return escape(str(v)[:10])


def confidence(n: int, effect: float | None = None) -> tuple[str, str]:
    if n >= 500 and (effect is None or abs(effect) >= 0.03):
        return "高", "hi"
    if n >= 100:
        return "中", "mid"
    return "低", "lo"


def fig(filename: str, alt: str) -> str:
    return f'<div class="fig"><img src="{{{{ chart_uri(\"{filename}\") }}}}" alt="{escape(alt)}"></div>'


def grain(label: str) -> str:
    return f'<p><span class="badge neutral">粒度</span>{escape(label)}</p>'


def term(label: str, text: str | None = None) -> str:
    shown = text or label
    title = TERM_TITLES.get(label)
    if not title:
        return escape(shown)
    return f'<abbr title="{escape(title)}">{escape(shown)}</abbr>'


def header_html(label: str, show_direction: bool = True) -> str:
    raw = str(label)
    title = TERM_TITLES.get(raw)
    base = term(raw) if title else escape(raw)
    direction = DIRECTION.get(raw)
    if raw in {"APM", "PPS", "VS", "APP", "DS/S", "DS/P", "GbE", "Garbage Eff.", "VS/APM", "Area", "Est. TR", "AUC", "勝率", "期待超過", "TR増減", "ピーク", "現在TR", "ピークTR"}:
        direction = direction or "↑良い"
    if show_direction and direction:
        base += f' <span class="dir">{escape(direction)}</span>'
    return base


def plain_text(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html)


def block(reading: str, result: str, interpretation: str, caution: str, conf: tuple[str, str] = ("中", "mid")) -> str:
    return f"""
<div class="block">
<p><span class="tag">読み方</span>{reading}</p>
<p class="result"><span class="tag">結果</span>{result}</p>
<p><span class="tag">注意</span>{caution}</p>
</div>
"""


def table(headers: list[str], rows: list[list[Any]], left_cols: set[int] | None = None, min_width: int | None = None, show_direction: bool = True, colorize: bool = False) -> str:
    left_cols = left_cols or {0}
    formatted_headers = [header_html(str(h), show_direction=show_direction) for h in headers]
    labels = [escape(plain_text(h)) for h in formatted_headers]
    th = "".join(f'<th class="{"l" if i in left_cols else ""}">{h}</th>' for i, h in enumerate(formatted_headers))
    body = []
    for row in rows:
        cells = []
        for i, v in enumerate(row):
            content = v if isinstance(v, str) else escape(str(v))
            classes = ["l"] if i in left_cols else []
            class_attr = f' class="{" ".join(classes)}"' if classes else ""
            cells.append(f'<td{class_attr} data-label="{labels[i] if i < len(labels) else ""}">{content}</td>')
        tds = "".join(cells)
        body.append(f"<tr>{tds}</tr>")
    style = f' style="min-width:{min_width}px"' if min_width else ""
    scroll_cls = "scroll mobile-card" if min_width and min_width >= 900 else "scroll"
    return f'<div class="{scroll_cls}"><table{style}><thead><tr>{th}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'


def part_divider(num: int) -> str:
    """num がいずれかの部の先頭章なら、その部見出しHTMLを返す。"""
    if num not in PART_AT:
        return ""
    roman, name, idx = PART_AT[num]
    return f'<h2 class="part" id="part-{idx}"><span class="pno">第{roman}部</span>{escape(name)}</h2>\n'


def chapter_header(num: int, title: str, lead: str) -> str:
    return part_divider(num) + f'<h2 class="chap" id="c{num}"><span class="no">第{num}章</span>{escape(title)}<a class="toclink" href="#top">↑ 目次</a></h2>\n<p class="lead">{lead}</p>'


def render_chapters(bundle: AnalysisBundle, project_root: Path) -> None:
    s = bundle.summary
    meta, kpi = s["meta"], s["kpis"]
    chapters = project_root / GENERATED_CHAPTERS
    chapters.mkdir(parents=True, exist_ok=True)
    scope = s.get("recent_scope", {})
    recent_tag = f"直近{scope.get('n_matches', 100)}試合（試合単位）"

    # 1 全体像と基本指標
    windows = s["recent_windows"]
    window_rows = [[w["label"], f"{w['wins']}/{w['n']}", pct(w["expected_actual"]), pct(w["expected"]), w["expected_n"], pp(w["excess_rate"]), nfmt(w["excess_wins"], 1)] for w in windows]
    recent = windows[0]
    peak_gap = abs(float(kpi['current_tr']) - float(kpi['peak_tr'])) if kpi.get('peak_tr') is not None else float('nan')
    c1 = chapter_header(1, "全体像と基本指標", "対象期間全体の規模、TRの長期推移、直近の実績と対戦前期待値の差を確認します。")
    c1 += fig("01_tr_history.png", "TR推移")
    c1 += block(
        "横軸はJSTの試合日時、縦軸はTR・Est. TRです。配置直後の欠損区間は線から除外しています。",
        f"確認できる最初のTRは{nfmt(kpi['first_tr'],0,True)}、現在は{nfmt(kpi['current_tr'],0,True)}で、差は{nfmt(kpi['tr_change'],0,True)}です。ピークは{nfmt(kpi['peak_tr'],0,True)}（{datefmt(kpi['peak_date'])}）、最大ドローダウンは{nfmt(kpi['max_drawdown'],0,True)}です。",
        "初期区間はTRの変動が大きく、後半区間の傾きは相対的に小さくなります。Est. TRとGlickoは、TRと同じ向きに動くかどうかの目安です。",
        f"TRは対戦相手と内部レーティングの影響を受けます。単日の上下は能力変化と一対一には対応しません。現在TRはピークから{nfmt(peak_gap,0)}の位置です。",
        ("高", "hi"),
    )
    c1 += "<h3>直近窓別の実績 vs 期待</h3>" + table(["期間", "勝数", "実績", "期待", "期待対象", "期待超過", "超過勝数"], window_rows)
    c1 += block(
        "勝数は各窓（窓全体）の通常勝敗の実数です。実績・期待・期待超過は対戦前Glicko/RDが揃う「期待対象」試合だけで揃えて算出するため、実績−期待＝期待超過が一致します。期待超過勝数は各試合の実績−期待確率の合計です。",
        f"{recent['label']}は実績{pct(recent['expected_actual'])}、期待{pct(recent['expected'])}で、差は{pp(recent['excess_rate'])}・{nfmt(recent['excess_wins'],1)}勝分です。全期間の公式勝率は{pct(kpi['official_win_rate'])}です。",
        "実績と期待を分けると、相手が強くなって勝率が下がった場合と、同程度の相手に結果が下振れた場合を区別できます。",
        "期待値は対戦前Glicko/RDを使った標準Glicko期待スコアです。相手レーティング欠損試合は期待値の集計から外しています。直近の調子は、生勝率に加えて期待超過勝数と能力指標で確認できます。",
        confidence(recent["n"], recent["excess_rate"]),
    )
    (chapters / "01_c1.html").write_text(c1, encoding="utf-8")

    # 2 成長推移と安定性（旧3章＋旧4章の統合）
    growth = s["growth"]
    growth_rows = [[m, nfmt(v["early"],3 if m in ["APP","DS/S","DS/P","DS/Piece","GbE"] else 1), nfmt(v["recent"],3 if m in ["APP","DS/S","DS/P","DS/Piece","GbE"] else 1), pct(v["growth_rate"],1,True)] for m,v in growth.items()]
    best_growth = max(growth.items(), key=lambda x: x[1]["growth_rate"] if x[1]["growth_rate"] is not None else -999)
    st = s["stability"]
    cv_improvements = sorted(((m, v["early_cv"] - v["recent_cv"]) for m,v in st.items()), key=lambda x:x[1], reverse=True)
    best_cv = cv_improvements[0]
    c2 = chapter_header(2, "成長推移と安定性", f"試合日時ベースの指標推移と、初期{s['growth_window_n']}戦・直近{s['growth_window_n']}戦の変化を確認します。")
    c2 += fig("05_monthly_normalized_trends.png", "指標推移")
    c2 += block(
        "横軸は第1章のTR推移と同じJSTの試合日時です。各指標の初期ローリング平均を100として、試合日時に沿った相対変化を重ねています。APM・PPS・VS・APP・DS/S・DS/P・GbE・Areaを同一基準で方向比較するための正規化です。",
        f"初期から直近で最も伸びた指標は{best_growth[0]}で{pct(best_growth[1]['growth_rate'],1,True)}です。APMは{nfmt(growth['APM']['early'],1)}→{nfmt(growth['APM']['recent'],1)}、PPSは{nfmt(growth['PPS']['early'],2)}→{nfmt(growth['PPS']['recent'],2)}、APPは{nfmt(growth['APP']['early'],3)}→{nfmt(growth['APP']['recent'],3)}です。",
        "速度（APM・PPS）と効率（APP・GbE・DS/S）の線が同じ向きに動くかどうかで、高速化中心の変化か総合的な変化かを区別できます。",
        "ローリング平均には相手層やプレー頻度の変化が含まれます。正規化線の高さで絶対値は比較できません。元単位の増減と正規化推移、複数指標の一致度を併せて確認します。",
        ("高", "hi"),
    )
    c2 += table(["指標", "初期", "直近", "増減率"], growth_rows)
    c2 += fig("06_stability_windows.png", "Stability by metric")
    (chapters / "02_c2.html").write_text(c2, encoding="utf-8")

    # 3 能力バランス（レーダー/スタイルは直近100試合・試合単位）
    metrics = s["metrics"]
    mr = s["metrics_recent"]
    metric_rows = [[m, nfmt(v["self"], 3 if m in ["APP","DS/Second","DS/Piece","Garbage Eff.","VS/APM"] else 1), nfmt(v["opponent"], 3 if m in ["APP","DS/Second","DS/Piece","Garbage Eff.","VS/APM"] else 1), nfmt(v["difference"], 3 if m in ["APP","DS/Second","DS/Piece","Garbage Eff.","VS/APM"] else 1)] for m, v in mr.items()]
    rec_adv = sorted(mr.items(), key=lambda x: x[1]["difference"] if x[1]["difference"] is not None else -999, reverse=True)
    strongest = rec_adv[0][0]
    c3 = chapter_header(3, "能力バランス", "主要指標の分布と、相手平均に対する能力バランスを確認します。レーダーとスタイルは直近100試合を試合単位で集計します。")
    c3 += fig("02_metric_distributions.png", "主要指標分布")
    c3 += block(
        "各箱は試合平均値の分布で、中央線が中央値、箱が中央50%、ひげが主要範囲です。外れ値は読みやすさのため非表示で、対象は全期間の試合です。",
        f"平均APMは自分{nfmt(metrics['APM']['self'],1)}・相手{nfmt(metrics['APM']['opponent'],1)}、PPSは自分{nfmt(metrics['PPS']['self'],2)}・相手{nfmt(metrics['PPS']['opponent'],2)}、VSは自分{nfmt(metrics['VS']['self'],1)}・相手{nfmt(metrics['VS']['opponent'],1)}です。",
        "分布の重なりが大きい指標は、平均差があっても単独での勝敗判別力は限定的です。",
        f"セット平均なので、個別の開幕、盤面、入力ミス、相殺のタイミングは識別できません。相手平均との差が大きい軸の一つは{strongest}です。",
        ("高", "hi"),
    )
    c3 += f"<h3>能力レーダーと4プレイスタイル（{recent_tag}）</h3>" + fig("03_capability_radar.png", "能力レーダー")
    c3 += block(
        f"各軸は自分と相手平均の絶対値の大きい方を1.0として正規化し、{recent_tag}で集計しています。上から時計回りにAPM、PPS、VS、APP、DS/Second、DS/Piece、APP+DS/Piece、VS/APM、Cheese Index、Garbage Eff.です。値が負の軸は0参照円より内側に描きます。",
        f"APPは{nfmt(mr['APP']['self'],3)}対{nfmt(mr['APP']['opponent'],3)}、GbEは{nfmt(mr['Garbage Eff.']['self'],3)}対{nfmt(mr['Garbage Eff.']['opponent'],3)}、PPSは{nfmt(mr['PPS']['self'],2)}対{nfmt(mr['PPS']['opponent'],2)}です。",
        "形状は相対的な偏りを示します。PPSが相手平均より低い軸でも、APPや火力密度の軸が外側にあれば、速度以外の効率が高い形です。",
        "軸ごとに単位が異なります。Cheese Indexは高低の良し悪しが文脈依存のため、正規化レーダーの面積は総合実力と同一ではありません。相手との差は形状と実数値の両方で確認します。",
        ("高", "hi"),
    )
    c3 += fig("04_playstyle_radar.png", "4プレイスタイル")
    sr_means = s["styles_recent"]["means"]
    representative = s["styles_recent"]["representative"]
    c3 += block(
        f"値は能力指標から推定したスタイル傾向で、{recent_tag}の平均です。負の値は0参照円より内側に描きます。",
        f"自分の最大値は{representative} {nfmt(sr_means[representative]['self'],2)}です。Opener {nfmt(sr_means['Opener']['self'],2)}、Stride {nfmt(sr_means['Stride']['self'],2)}、Inf DS {nfmt(sr_means['Inf DS']['self'],2)}、Plonk {nfmt(sr_means['Plonk']['self'],2)}でした。",
        "代表スタイルは最大値による便宜的な分類で、実際の試合では複数傾向が混ざります。",
        f"スタイル式はTetraStats由来の派生指標で、盤面や意図を直接観測するものではありません。{recent_tag}の代表傾向は速度・効率の軸とあわせて読みます。",
        ("中", "mid"),
    )
    c3 += "<h3>4プレイスタイルの推移</h3>" + fig("20_playstyle_trend.png", "4プレイスタイル推移")
    c3 += block(
        "横軸はJSTの試合日時、縦軸は自分の各スタイル傾向の試合単位ローリング平均です。Opener・Stride・Inf DS・Plonkの4本を重ねています。",
        "線が上下に入れ替わる時期は、プレイスタイルの重心が移ったことを示します。",
        "同時に上がる・下がる線の組み合わせから、速度寄り・効率寄りといった傾向の変化を読み取れます。",
        "ローリング平均には相手層やプレー頻度の変化が含まれます。短期の上下より、複数試合にわたる持続的な変化に注目します。",
        ("中", "mid"),
    )
    c3 += f"<h3>主要指標（{recent_tag}）</h3>" + table(["指標", "自分", "相手平均", "差"], metric_rows, min_width=620)
    (chapters / "03_c3.html").write_text(c3, encoding="utf-8")

    # 4 勝敗に関係しやすい指標（旧5章）
    effects = s["effect_sizes"]
    top_effect = effects[0]
    model = s["model"]
    base = model.get("baseline", {})
    rel = model.get("relative", {})
    model_rows = [
        ["対戦前Glicko/RD期待値", nfmt(base.get("auc"),3), nfmt(base.get("brier"),3), nfmt(base.get("log_loss"),3), "試合前に利用可能"],
        ["相対能力差モデル", nfmt(rel.get("auc"),3), nfmt(rel.get("brier"),3), nfmt(rel.get("log_loss"),3), "試合後の関連分析"],
    ]
    c4 = chapter_header(4, "勝敗に関係しやすい指標", "勝利時と敗北時の能力差、相手との相対優位、モデルの追加説明力を確認します。")
    c4 += fig("08_relative_effect_sizes.png", "効果量")
    c4 += block(
        "Cohen's dは勝利群平均−敗北群平均を共通標準偏差で割った値です。正なら勝利時に高い傾向を示します。killsは結果と循環するため除外しています。",
        f"絶対値が最大の指標は{top_effect['metric']}でd={nfmt(top_effect['d'],2)}。勝利時平均{nfmt(top_effect['win_mean'],3)}、敗北時平均{nfmt(top_effect['loss_mean'],3)}です。",
        "効果量は単位に依存せず比較できます。ここで示すのは因果的な勝因ではなく、勝敗と同時に起きた関連です。",
        "試合スタッツは勝敗後に確定し、長引いた試合ほど値の意味が変わる逆因果もあります。効果量・相対優位・再現性を併せて見ると、探索的な関連の強さを比較できます。",
        ("高", "hi"),
    )
    c4 += fig("09_delta_vs_winrate.png", "相対VS差と勝率")
    c4 += block(
        "横軸は自分VS−相手VSを分位ビンに分けた平均、縦軸はそのビンの勝率です。0より右は相手よりVSが高い試合です。",
        f"最左ビンから最右ビンまでの勝率差は{pp((s['delta_vs_bins'][-1]['win_rate']-s['delta_vs_bins'][0]['win_rate']) if len(s['delta_vs_bins'])>=2 else None)}です。各点には試合数を表示しています。",
        "VS差が大きいビンほど勝率が高い場合、絶対値より相手との相対的な圧力・処理量が勝敗と強く結びつきます。",
        "ビン境界はデータ分位で、別期間では値が変わります。自分の指標単独だけでなく、相手との差と勝率の関係を確認します。",
        ("高", "hi"),
    )
    c4 += fig("10_apm_vs_dominance_heatmap.png", "APMとVS相対優位")
    dom_best = max(s["dominance"], key=lambda x: x["win_rate"] if x["win_rate"] is not None else -1)
    c4 += block(
        "列がAPM優劣、行がVS優劣です。各セルは勝率と試合数を示します。",
        f"最も高いセルはAPM{'優位' if dom_best['apm_adv'] else '劣位'}・VS{'優位' if dom_best['vs_adv'] else '劣位'}で、勝率{pct(dom_best['win_rate'])}（n={dom_best['n']}）です。",
        "APMのみ優位、VSのみ優位、両方優位、両方劣位を分けると、攻撃量と総合圧力それぞれの勝率との関係が見えます。",
        "同じセルでもTR差・試合時間・相手スタイルが異なるため、セル間差は純粋な因果ではありません。APMの優位がVSを含む相対優位に結びついているかをセル別に確認します。",
        ("高", "hi"),
    )
    c4 += "<h3>補足：ベースライン vs 拡張モデル（時系列7:3分割）</h3>"
    c4 += "<div class=\"note-box\">この章で見た相対指標が、勝敗とどれだけ結びつくかをまとめて確認する補足表です。試合前に分かるレーティングだけのモデルと、相手との能力差を加えたモデルを並べ、説明力がどれだけ伸びるかを示します。本編の数値や勝率にはレーティングのみのモデルを使っています。</div>"
    c4 += table(["モデル", "AUC", "Brier", "Log loss", "用途"], model_rows)
    auc_gain = (rel.get("auc") or math.nan) - (base.get("auc") or math.nan)
    c4 += block(
        "AUCは勝者を上位に並べる能力、Brier scoreとLog lossは予測確率の正確さを示します。BrierとLog lossは小さい方が良好です。",
        f"Glicko/RD期待値のAUCは{nfmt(base.get('auc'),3)}、相対能力差を加えた診断モデルは{nfmt(rel.get('auc'),3)}で、差は{nfmt(auc_gain,3)}です。",
        "相対能力差モデルのAUC改善が大きいほど、試合中の能力差がレーティング差を超えて結果を説明します。このモデルは試合後情報を含むため、試合前予測には使えません。",
        "相対スタッツは試合後情報であり、係数は因果効果ではありません。多重共線性もあります。モデルは『何が同時に起きたか』の整理に使います。",
        ("中", "mid"),
    )
    (chapters / "04_c4.html").write_text(c4, encoding="utf-8")

    # 5 対戦相手の強さと期待値（旧6章）
    tr_gap = s["tr_gap"]
    reliable_tr_gap = [x for x in tr_gap if x["n"] >= 20]
    best_gap = max(reliable_tr_gap, key=lambda x:x["excess"]) if reliable_tr_gap else None
    worst_gap = min(reliable_tr_gap, key=lambda x:x["excess"]) if reliable_tr_gap else None
    c5 = chapter_header(5, "対戦相手の強さと期待値", "格上・同格・格下を細分化し、実績勝率が対戦前期待値からどこで外れたかを確認します。")
    c5 += fig("12_tr_gap_expected_vs_actual.png", "TR差別実績と期待")
    c5 += block(
        "横軸は自分TR−相手TRの帯、2本の線は実績勝率とGlicko/RD期待勝率です。",
        (f"標本20以上では、期待超過が最大の帯は{best_gap['label']}で{pp(best_gap['excess'])}（n={best_gap['n']}）、最小は{worst_gap['label']}で{pp(worst_gap['excess'])}（n={worst_gap['n']}）です。" if best_gap and worst_gap else "TR差を算出できる十分な標本の帯が不足しています。"),
        "実績線が期待線を上回る帯は、その強さの相手にレーティング以上の結果を出した区分です。",
        "初期TR欠損試合は除外され、各帯の時期・スタイル構成も異なります。n<20の帯は点推定を結論に使いません。格上・格下の大括りではなく、どの差帯で期待から外れるかを確認します。",
        confidence(best_gap["n"] if best_gap else 0, best_gap["excess"] if best_gap else None),
    )
    (chapters / "05_c5.html").write_text(c5, encoding="utf-8")

    # 6 接戦・決着局面
    streak = s["streaks"]
    tb = s["tiebreak"]
    positions, durations = s["session_positions"], s["duration_bins"]
    session_definition = s.get("session_definition", {})
    session_gap_minutes = session_definition.get("gap_minutes", 10)
    session_rule = session_definition.get(
        "same_session_rule",
        f"前試合完了直後から次試合開始までの間隔が{session_gap_minutes}分以内なら同一セッションです。",
    )
    streak_states = s.get("streak_states", [])
    score_states = s.get("score_states", [])
    ss_map = {x["label"]: x for x in score_states}
    score_labels = ["同点", "リード時", "ビハインド時"]
    mp_labels = ["自分MP", "相手MP", "双方MP"]
    c6 = chapter_header(6, "接戦・決着局面", "接戦になった試合をどう閉じたかを確認します。タイブレークは試合単位、スコア状況別の次ラウンド勝率と最終ラウンドの能力変化はラウンド単位で扱います。")
    ss_rows = [
        [ss_map[lbl]["label"], ss_map[lbl]["n"], pct(ss_map[lbl]["win_rate"]), nfmt(ss_map[lbl]["score_diff_mean"], 2)]
        for lbl in score_labels if lbl in ss_map
    ]
    lead_ss = ss_map.get("リード時")
    behind_ss = ss_map.get("ビハインド時")
    even_ss = ss_map.get("同点")
    c6 += "<h3>スコア状況別・次ラウンド勝率（ラウンド単位）</h3>" + grain("ラウンド単位。開始前スコア状況ごとに、次の1ラウンドの勝率を見ます。") + fig("18_score_state_next_round.png", "スコア状況別次ラウンド勝率")
    if ss_rows:
        c6 += table(["状況", "標本", "次ラウンド勝率", "平均スコア差"], ss_rows, show_direction=False)
    c6 += block(
        "各ラウンドを開始前のスコア差でリード・同点・ビハインドに分け、その状況での次ラウンド勝率を示します。終了後ではなく開始前スコアで分類します。",
        (f"同点時は{pct(even_ss['win_rate'])}（n={even_ss['n']}）、リード時は{pct(lead_ss['win_rate'])}（n={lead_ss['n']}）、ビハインド時は{pct(behind_ss['win_rate'])}（n={behind_ss['n']}）です。" if lead_ss and behind_ss and even_ss else "スコア状況別の標本を集計できませんでした。"),
        "リード時とビハインド時で勝率差が大きい場合、流れに乗ると伸び、劣勢から戻しにくい傾向を示します。同点時の勝率はその局面での地力の目安です。",
        "開始前スコアには相手の強さや試合展開が混ざります。ビハインドに陥る試合自体が苦戦である逆因果があるため、勝率差だけで切り替えの巧拙を断定しません。",
        confidence(lead_ss["n"] if lead_ss else 0, None),
    )
    mp_rows = [
        [ss_map[lbl]["label"], ss_map[lbl]["n"], pct(ss_map[lbl]["win_rate"])]
        for lbl in mp_labels if lbl in ss_map
    ]
    own_mp = ss_map.get("自分MP")
    opp_mp = ss_map.get("相手MP")
    c6 += "<h3>マッチポイント到達後の勝率（試合単位）</h3>" + grain("試合内のマッチポイント局面を、次ラウンド単位で集計します。")
    if mp_rows:
        c6 += table(["状況", "標本", "次ラウンド勝率"], mp_rows, show_direction=False)
    c6 += block(
        "あと1本で決着する局面を、自分マッチポイント・相手マッチポイント・双方マッチポイントに分けて次ラウンド勝率を示します。最終スコアから決着本数を求め、スコア欠損試合は除外します。",
        (f"自分MP時は{pct(own_mp['win_rate'])}（n={own_mp['n']}）、相手MP時は{pct(opp_mp['win_rate'])}（n={opp_mp['n']}）です。" if own_mp and opp_mp else "マッチポイント局面の標本を集計できませんでした。"),
        "自分MP時に決め切れているか、相手MP時に粘れているかで、決着局面の強さを確認できます。双方MPは事実上のタイブレーク局面です。",
        "決着本数は最終スコアから推定し、target_score・opponent_scoreの欠損試合は除外します。標本が小さい区分は点推定の幅が大きく、タイブレークと併読します。",
        confidence(own_mp["n"] if own_mp else 0, None),
    )
    c6 += "<h3>タイブレーク（試合単位）</h3>" + grain("試合単位。双方があと1ラウンドで勝利する最終決着局面だけを抽出します。") + fig("15_tiebreak_analysis.png", "タイブレーク分析")
    if tb.get("n",0):
        tb_result = f"タイブレークは{tb['n']}試合、実績{pct(tb['win_rate'])}、期待{pct(tb['expected'])}、期待超過{pp(tb['excess'])}です。95% Wilson区間は{pct(tb['wilson_low'])}〜{pct(tb['wilson_high'])}です。"
    else:
        tb_result = "タイブレーク該当試合を抽出できませんでした。"
    c6 += block(
        "最終スコア差が1で、最終ラウンド開始時点に双方があと1本の試合を抽出します。棒は追いついた／追いつかれた経路別の実績と期待です。",
        tb_result,
        "期待超過が正でも区間が広い場合は点推定の幅が大きく、最終ラウンドの能力変化と合わせて見る必要があります。",
        "タイブレークへ到達した接戦だけを選ぶため選択バイアスがあります。勝率・期待値・最終ラウンドのPPS/APP変化が一致するかで、決着局面の傾向を確認します。",
        confidence(tb.get("n",0), tb.get("excess")),
    )
    if tb.get("final_changes"):
        changes = tb["final_changes"]
        c6 += "<h3>最終ラウンドの能力変化（ラウンド単位）</h3>" + grain("ラウンド単位。同じ試合内の最終ラウンドと、それ以前のラウンド平均を比べます。") + table(["指標", "最終−それ以前"], [[m, nfmt(v,3 if m in ["APP","DS/Piece","Garbage Eff."] else 1)] for m,v in changes.items()])
    (chapters / "06_c6.html").write_text(c6, encoding="utf-8")

    # 7 ラウンド展開と試合時間
    duration_filtered = [d for d in durations if d["n"]>=20]
    worst_duration = min(duration_filtered, key=lambda x:x["win_rate"]) if duration_filtered else None
    dbr = s.get("duration_by_result", {})
    win_dur, loss_dur = dbr.get("win", {}), dbr.get("loss", {})
    c7 = chapter_header(7, "ラウンド展開と試合時間", "ラウンドが長短どの帯に入ったとき何が起きたかを確認します。決着時間分布・ラウンド時間別勝率・時間帯別の能力差分をいずれもラウンド単位で扱います。")
    c7 += "<h3>勝敗別の決着時間分布（ラウンド単位）</h3>" + grain("ラウンド単位。1本ごとの継続時間を、勝ちラウンドと負けラウンドで比べます。")
    if win_dur or loss_dur:
        c7 += table(
            ["ラウンド結果", "標本", "平均秒", "中央値秒", "P75秒"],
            [
                ["勝ちラウンド", win_dur.get("n", "—"), nfmt(win_dur.get("mean"),1), nfmt(win_dur.get("median"),1), nfmt(win_dur.get("p75"),1)],
                ["負けラウンド", loss_dur.get("n", "—"), nfmt(loss_dur.get("mean"),1), nfmt(loss_dur.get("median"),1), nfmt(loss_dur.get("p75"),1)],
            ],
            show_direction=False,
        )
    c7 += block(
        "勝ちラウンドと負けラウンドそれぞれの継続時間を、平均・中央値・P75で比較します。",
        (f"勝ちラウンドの中央値は{nfmt(win_dur.get('median'),1)}秒、負けラウンドは{nfmt(loss_dur.get('median'),1)}秒です。" if win_dur and loss_dur else "勝敗別の決着時間を集計できませんでした。"),
        "負けラウンドが長い側に寄る場合、決め切れず長引いた末に競り負ける展開が多いことを示します。",
        "苦しいラウンドほど長引く逆因果があり、時間そのものが敗因とは限りません。次の時間帯別勝率・能力差分と併読します。",
        ("中", "mid"),
    )
    c7 += "<h3>ラウンド決着時間別勝率（ラウンド単位）</h3>" + grain("ラウンド単位。30秒幅の決着時間帯ごとにラウンド勝率を見ます。") + fig("17_round_duration.png", "ラウンド決着時間別勝率")
    c7 += block(
        "ラウンド継続時間を30秒幅で区切り、各帯のラウンド勝率と標本数を示します。",
        (f"標本20以上で最も低い帯は{worst_duration['label']}、勝率{pct(worst_duration['win_rate'])}（n={worst_duration['n']}）です。" if worst_duration else "十分な標本の時間帯がありません。"),
        "特定の時間帯で勝率が下がる場合、その長さで盤面維持や火力変換が崩れやすい可能性があります。",
        "苦しいラウンドほど長引く逆因果があるため、長時間が敗因とは限りません。勝率が低い時間帯は、隣接帯との連続性も含めて確認します。",
        confidence(worst_duration["n"] if worst_duration else 0, (worst_duration["win_rate"]-0.5) if worst_duration else None),
    )
    delta_rows = [
        [d["label"], d["n"], nfmt(d.get("delta_VS"),1), nfmt(d.get("delta_APP"),3), nfmt(d.get("delta_DS/P"),3), nfmt(d.get("delta_APM"),1), nfmt(d.get("delta_PPS"),2), nfmt(d.get("delta_GbE"),3)]
        for d in duration_filtered
    ]
    c7 += "<h3>ラウンド決着時間帯別の能力差分（ラウンド単位）</h3>" + grain("ラウンド単位。各時間帯に入ったラウンドで、自分と相手の指標差を見ます。") + fig("19_duration_metric_deltas.png", "ラウンド決着時間帯別の能力差分")
    if delta_rows:
        c7 += table(["時間帯", "標本", "ΔVS", "ΔAPP", "ΔDS/P", "ΔAPM", "ΔPPS", "ΔGbE"], delta_rows, show_direction=False, min_width=720)
    c7 += block(
        "各時間帯で、自分と相手の能力指標の差（自分−相手）の平均を示します。図はΔVS・ΔAPP・ΔDS/P、表は全指標です。",
        "正の差分はその時間帯で相手より優位、負は劣位を表します。時間帯ごとに優劣がどう変わるかを確認します。",
        "短時間帯では速攻型、長時間帯では掘り・効率型の差が出やすく、時間帯ごとに勝敗との結びつきが異なります。",
        "標本n<20の帯は弱い根拠として扱います。差分は相手構成の影響を受けるため、勝率と能力差分の両方を併せて読みます。",
        ("中", "mid"),
    )
    (chapters / "07_c7.html").write_text(c7, encoding="utf-8")

    # 8 連戦の流れとセッション内の試合位置
    worst_pos = min(positions, key=lambda x:x["excess"]) if positions else None
    c8 = chapter_header(8, "連戦の流れとセッション内の試合位置", "試合と試合の間で続く流れを確認します。連勝連敗、前戦結果、セッション内の試合位置、TRドローダウンを試合単位で集計します。")
    c8 += "<h3>連勝・連敗と前戦結果（試合単位）</h3>" + grain("試合単位。直前までの連勝・連敗段階ごとに、次の1試合の結果を見ます。") + fig("14_streak_distribution.png", "連勝連敗分布")
    if streak_states:
        c8 += table(
            ["直前段階", "次戦勝率", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "標本"],
            [[r["label"], pct(r["win_rate"]), pp(r["excess"]), sgn(r["d_apm"], 1), sgn(r["d_pps"], 2), sgn(r["d_vs"], 1), sgn(r["d_area"], 1), r["n"]] for r in streak_states],
            left_cols={0},
        )
    loss3 = next((r for r in streak_states if r["label"] == "3連敗以降"), None)
    after_loss_states = [r for r in streak_states if r["label"] in ("1連敗", "2連敗", "3連敗以降")]
    c8 += block(
        "棒グラフの横軸は連続した勝敗の長さ、縦軸は発生回数です。表は直前の連勝・連敗段階別に、次戦の実績勝率・期待超過・能力指標差分（全完了試合平均との差）を並べています。",
        f"最長連勝は{streak['max_win']}、最長連敗は{streak['max_loss']}です。" + (
            "連敗段階の期待超過は" + "、".join(f"{r['label']}{pp(r['excess'])}（n={r['n']}）" for r in after_loss_states) + "です。" if after_loss_states else "段階別の標本が不足しています。"
        ),
        "段階に沿って期待超過や能力指標差分が単調に動くか、特定段階だけ外れるかを確認します。期待超過は相手強度を補正した結果の上振れ・下振れです。",
        "相手強度・時期・連戦位置が混ざる単純集計です。実績勝率だけでなく期待超過と能力指標差分を併読し、段階別の変化を比較します。",
        confidence(loss3["n"] if loss3 else 0, (loss3["excess"] if loss3 else None)),
    )
    c8 += "<h3>セッション内の試合位置（試合単位）</h3>" + grain(f"セッション内の試合位置。前試合完了直後から次試合開始までの間隔が{session_gap_minutes}分以内の連戦で、何試合目かを見ます。") + fig("16_session_position.png", "セッション位置")
    if positions:
        c8 += table(
            ["区分", "実績", "期待", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "標本"],
            [[p["label"], pct(p["actual"]), pct(p["expected"]), pp(p["excess"]), sgn(p["d_apm"], 1), sgn(p["d_pps"], 2), sgn(p["d_vs"], 1), sgn(p["d_area"], 1), p["n"]] for p in positions],
            left_cols={0},
        )
    c8 += block(
        f"{session_rule} 1〜10戦目は1戦ずつ、11戦目以降をまとめた区分で集計しています。試合完了時刻はラウンド時間から推定し、能力指標差分は各区分の平均と全完了試合平均との差です。",
        (f"期待超過が最も低い区分は{worst_pos['label']}で{pp(worst_pos['excess'])}（n={worst_pos['n']}）、実績{pct(worst_pos['actual'])}・期待{pct(worst_pos['expected'])}です。" if worst_pos else "セッション位置を集計できませんでした。"),
        "区分の進行に沿って期待超過と能力指標差分が連続して動くか、特定区分だけ外れるかを確認します。",
        "時間帯・曜日・プレー時期・自己選択が位置と混ざります。n<20の区分は点推定を結論に使わず、区分別の期待超過と能力指標の推移を確認します。",
        confidence(worst_pos["n"] if worst_pos else 0, worst_pos["excess"] if worst_pos else None),
    )
    c8 += "<h3>TRドローダウン</h3>" + grain("試合単位。各試合後TRが、それまでのピークからどれだけ下がったかを見ます。") + fig("13_tr_drawdown.png", "TRドローダウン")
    c8 += block(
        "0はその時点までの最高TR、負値はピークからの下落幅です。",
        f"最大ドローダウンは{nfmt(kpi['max_drawdown'],0,True)}で、底は{datefmt(kpi['max_drawdown_date'])}でした。現在TRは{nfmt(kpi['current_tr'],0,True)}です。",
        "下落幅と能力指標を併読すると、スタッツも落ちたコンディション型か、能力は維持で結果だけ下振れた分散型かを区別できます。",
        "回復までの試合数はプレー間隔に左右され、暦日だけでは原因を特定できません。TRが水面下でも、期待超過や能力平均が維持されているかを同じ期間で確認できます。",
        ("高", "hi"),
    )
    (chapters / "08_c8.html").write_text(c8, encoding="utf-8")


def render_appendices(bundle: AnalysisBundle, project_root: Path) -> None:
    monthly = bundle.monthly
    monthly_rows = []
    for _, r in monthly.iterrows():
        monthly_rows.append([
            escape(str(r["month"])), int(r["matches"]), int(r["wins"]), int(r["losses"]), pct(r["official_win_rate"]),
            pct(r["expected_win_rate"]), pp(r["expected_excess_rate"]), nfmt(r["tr_start"],0,True), nfmt(r["tr_end"],0,True),
            nfmt(r["tr_change"],0,True), nfmt(r["peak_tr"],0,True), nfmt(r["max_drawdown"],0,True),
            nfmt(r["APM"],1), nfmt(r["PPS"],2), nfmt(r["VS"],1), nfmt(r["APP"],3), nfmt(r["DS/S"],3),
            nfmt(r["DS/P"],3), nfmt(r["GbE"],3), nfmt(r["Area"],1), nfmt(r["Opener"],2), nfmt(r["Stride"],2), nfmt(r["Inf DS"],2), nfmt(r["Plonk"],2),
        ])
    monthly_table = table(
        ["月","試合","勝","敗","勝率","期待","期待超過","月初TR","月末TR","TR増減","ピーク","最大DD","APM","PPS","VS","APP","DS/S","DS/P","GbE","Area","Opener","Stride","Inf DS","Plonk"],
        monthly_rows, min_width=1900, show_direction=False,
    )

    records_rows = []
    for r in bundle.summary["records"]:
        value = pct(r["value"]) if r["unit"] == "%" and r["value"] is not None and abs(float(r["value"])) <= 1 else nfmt(r["value"],3 if r["unit"] in ["APP","DS/S","DS/P","GbE","VS/APM"] else 1, comma=r["unit"]=="TR")
        records_rows.append([escape(r["name"]), value, escape(r["unit"]), datefmt(r["date"]), escape(r["scope"]), escape(r.get("note") or "")])
    records_table = table(["記録", "値", "単位", "日付", "粒度", "注意"], records_rows, left_cols={0,4,5}, min_width=900, show_direction=False)

    def excess_table(rows_data: list[dict[str, Any]]) -> str:
        rows = [
            [r["label"], pct(r["actual"]), pct(r["expected"]), pp(r["excess"]),
             sgn(r["d_apm"], 1), sgn(r["d_pps"], 2), sgn(r["d_vs"], 1), sgn(r["d_area"], 1), r["n"]]
            for r in rows_data
        ]
        return table(
            ["区分", "実績", "期待", "期待超過", "ΔAPM", "ΔPPS", "ΔVS", "ΔArea", "標本"],
            rows, left_cols={0}, min_width=900, show_direction=False,
        )

    weekday_rows = bundle.summary.get("excess_by_weekday", [])
    hour_rows = bundle.summary.get("excess_by_hour", [])
    weekday_table = excess_table(weekday_rows)
    hour_table = excess_table(hour_rows)

    html = f"""
<details id="appendix-monthly">
<summary>付録A　月別集計を開く（{len(monthly)}か月）</summary>
<p class="lead">月はJSTで区切り、勝率・期待値・TR・主要能力・4スタイルを同じ表へまとめています。標本数の少ない月は一般化しないでください。</p>
{monthly_table}
</details>
<details id="appendix-records">
<summary>付録B　検証済みパーソナルレコードを開く（{len(records_rows)}件）</summary>
<p class="lead">元parquetから正規化して再計算し、単試合・単ラウンド・期間窓を区別しています。最短ラウンドは切断・DQ等のアーティファクト疑いを避けるため5秒未満を除外します。単ラウンドPRや初期配置期のTR変動、派生指標の外れ値は、注意欄を確認してください。</p>
{records_table}
</details>
<details id="appendix-excess-grid">
<summary>付録C　曜日別・時間帯別の期待値調整後成績を開く</summary>
<p class="lead">曜日・時間帯（JST、試合単位）ごとに、実績勝率・期待勝率・期待超過と能力指標差分（各区分平均と全完了試合平均との差）をまとめています。期待超過がプラスなら相手強度を補正したうえで期待以上です。標本n&lt;20の区分は弱い根拠として扱ってください。</p>
<h3>曜日別の期待値調整後成績</h3>
{fig("20_excess_weekday.png", "曜日別の期待値調整後成績")}
{weekday_table}
<h3>時間帯別の期待値調整後成績</h3>
{fig("21_excess_hour.png", "時間帯別の期待値調整後成績")}
{hour_table}
</details>
"""
    output = project_root / GENERATED_APPENDICES
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")


def build_glossary(session_definition: dict[str, Any] | None = None) -> str:
    session_definition = session_definition or {}
    session_gap_minutes = session_definition.get("gap_minutes", 10)
    items = [
        ("試合", "Tetra Leagueの1マッチです。勝敗、TR変動、期待勝率、連勝連敗、セッション位置は試合単位で扱います。"),
        ("ラウンド", "試合内の1本です。ラウンド勝敗、決着時間、開始前スコア状況、最終ラウンドの能力変化はラウンド単位で扱います。"),
        ("セッション", f"前試合完了直後から次試合開始までの間隔が{session_gap_minutes}分以内の連戦まとまりです。セッション内の1戦目、2戦目、11戦目以降などの位置を試合単位で集計します。"),
        ("期待勝率", TERM_TITLES["期待勝率"]),
        ("期待超過", TERM_TITLES["期待超過"]),
        ("APP", TERM_TITLES["APP"]),
        ("DS/S", TERM_TITLES["DS/S"]),
        ("DS/P", TERM_TITLES["DS/P"]),
        ("GbE", TERM_TITLES["GbE"]),
        ("VS/APM", TERM_TITLES["VS/APM"]),
        ("Cheese Index", TERM_TITLES["Cheese Index"]),
        ("AUC/Brier/Log loss", "モデルの当たり具合。AUCは高いほど、BrierとLog lossは低いほど良い。"),
        ("Cohen's d", TERM_TITLES["Cohen's d"]),
    ]
    rows = "".join(f"<dt>{escape(k)}</dt><dd>{escape(v)}</dd>" for k, v in items)
    return f"""
<details class="glossary">
<summary>先に用語を確認する</summary>
<dl>{rows}</dl>
</details>
"""


def render_report_data(bundle: AnalysisBundle, project_root: Path, player_name: str) -> None:
    s = bundle.summary
    meta, kpi = s["meta"], s["kpis"]
    recent = s["recent_windows"][0]
    now_jst = pd.Timestamp.now(tz="Asia/Tokyo")
    output_date = now_jst.strftime("%Y_%m_%d")
    subtitle = (
        f"対象プレイヤー：<b>{escape(player_name)}</b>　／　対象期間：{datefmt(meta['start'])} 〜 {datefmt(meta['end'])}（JST）　／　生成日：{now_jst.strftime('%Y-%m-%d')}<br>"
        f"公式試合数 {meta['matches']:,}　通常分析 {meta.get('analysis_matches', meta['matches']):,}試合　ラウンド数 {meta['rounds']:,}　セッション数 {meta.get('sessions', 0):,}　稼働日数 {meta['active_days']}日　対戦相手 {meta['opponents']:,}名"
    )
    kpis = [
        {"label":"公式戦績勝率", "value":pct(kpi["official_win_rate"]), "note":(
            f"{kpi['wins']}勝 {kpi['losses']}敗／DQ勝{kpi['dq_wins']}／DQ負{kpi.get('dq_losses', 0)}／無効{kpi.get('nullified', 0)}"
            + (f"／No Contest{kpi.get('no_contest', 0)}／Tie{kpi.get('ties', 0)}" if (kpi.get("no_contest", 0) or kpi.get("ties", 0)) else "")
        )},
        {"label":"現在TR", "value":nfmt(kpi["current_tr"],0,True), "note":f"開始 {nfmt(kpi['first_tr'],0,True)} から {nfmt(kpi['tr_change'],0,True)}"},
        {"label":"ピークTR", "value":nfmt(kpi["peak_tr"],0,True), "note":datefmt(kpi["peak_date"])},
        {"label":"最大ドローダウン", "value":nfmt(kpi["max_drawdown"],0,True), "note":datefmt(kpi["max_drawdown_date"])},
        {"label":f"{recent['label']} 実績勝率", "value":pct(recent["expected_actual"]), "note":f"期待 {pct(recent['expected'])}／{nfmt(recent['excess_wins'],1)}勝分（期待対象{recent['expected_n']}戦）"},
    ]
    toc = '<b>目次</b>'
    for idx, (roman, name, start) in enumerate(PARTS):
        end = PARTS[idx + 1][2] - 1 if idx + 1 < len(PARTS) else len(CHAPTER_TITLES)
        toc += f'<div class="toc-part">第{roman}部　{escape(name)}</div>'
        toc += f'<ol start="{start}">' + ''.join(
            f'<li><a href="#c{n}">{CHAPTER_TITLES[n - 1]}</a></li>' for n in range(start, end + 1)
        ) + '</ol>'
    toc += ('<div class="muted" style="font-size:13px">付録：'
            '<a href="#appendix-monthly">付録A 月別集計</a>　／　'
            '<a href="#appendix-records">付録B 検証済みパーソナルレコード</a>　／　'
            '<a href="#appendix-excess-grid">付録C 曜日・時間帯×セッション位置の期待値調整後成績</a></div>')
    session_definition = s.get("session_definition", {})
    session_gap_minutes = session_definition.get("gap_minutes", 10)
    note = f"本レポートは試合・ラウンド・セッションを分けて集計します。勝敗やTR、期待勝率は主に試合単位、決着時間やスコア状況はラウンド単位、連戦中の位置はセッション内の試合位置で見ます。セッションは前試合完了直後から次試合開始まで{session_gap_minutes}分以内の連戦です。"
    report = {
        "title": f"TETR.IO 戦績分析レポート — {player_name}",
        "heading": "TETR.IO Tetra League 戦績分析レポート",
        "subtitle_html": subtitle,
        "kpis": kpis,
        "executive_summary_html": "",
        "glossary_html": build_glossary(session_definition),
        "note_box_html": note,
        "toc_html": toc,
        "generated_date": now_jst.strftime("%Y-%m-%d"),
        "output_filename": f"{output_date}_{player_name}_tetrio_performance_report.html",
    }
    (project_root / "cache" / "report_data.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def render_chapter_index(project_root: Path) -> None:
    """章構成から chapter_index.json を生成し、静的ファイルのドリフトを防ぐ。"""
    index = [
        {
            "number": i,
            "id": f"c{i}",
            "title": f"第{i}章 {title}",
            "file": f"{GENERATED_CHAPTERS.as_posix()}/{i:02d}_c{i}.html",
        }
        for i, title in enumerate(CHAPTER_TITLES, start=1)
    ]
    (project_root / "cache").mkdir(parents=True, exist_ok=True)
    (project_root / "cache" / "chapter_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def render_all(bundle: AnalysisBundle, project_root: Path, player_name: str) -> None:
    render_chapters(bundle, project_root)
    render_appendices(bundle, project_root)
    render_report_data(bundle, project_root, player_name)
    render_chapter_index(project_root)
