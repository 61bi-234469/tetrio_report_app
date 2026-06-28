#!/usr/bin/env python3
"""Generate report charts from an AnalysisBundle."""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
import pandas as pd

from report_analysis import AnalysisBundle, STYLE_ORDER, analyze_csv

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# ローリング平均の窓幅（試合数）。トレンド系チャート共通。
ROLLING_WINDOW = 10

GROWTH_STABILITY_METRICS = [
    ("APM", "apm", "{:.1f}"),
    ("PPS", "pps", "{:.2f}"),
    ("VS", "vs", "{:.1f}"),
    ("APP", "APP", "{:.3f}"),
    ("DS/S", "DS/Second", "{:.3f}"),
    ("DS/P", "DS/Piece", "{:.3f}"),
    ("GbE", "Garbage Effi.", "{:.3f}"),
    ("Area", "Area", "{:.1f}"),
]


def set_japanese_font() -> None:
    candidates = ["Meiryo", "Yu Gothic UI", "Yu Gothic", "BIZ UDGothic", "MS Gothic", "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic", "IPAGothic", "Hiragino Sans"]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in candidates:
        if name in available:
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.dpi"] = 120
    # 文字のかすれ対策：全体的に濃く・太くはっきり描く
    plt.rcParams.update({
        "text.color": "#111827",
        "axes.titlecolor": "#111827",
        "axes.titleweight": "bold",
        "axes.labelcolor": "#1f2937",
        "axes.labelweight": "normal",
        "axes.edgecolor": "#4b5563",
        "xtick.color": "#374151",
        "ytick.color": "#374151",
        "xtick.labelcolor": "#1f2937",
        "ytick.labelcolor": "#1f2937",
        "font.size": 10.5,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
    })


def save(fig: plt.Figure, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150, bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)


def _set_padded_ylim(ax, values: pd.Series, pad_ratio: float = 0.12) -> None:
    vals = pd.to_numeric(values, errors="coerce").dropna()
    if vals.empty:
        return
    lo = float(vals.quantile(0.02))
    hi = float(vals.quantile(0.98))
    if not np.isfinite(lo) or not np.isfinite(hi):
        return
    pad = max(abs(hi) * pad_ratio, 1.0) if math.isclose(lo, hi) else (hi - lo) * pad_ratio
    ax.set_ylim(lo - pad, hi + pad)


def _legend_below(ax, handles=None, labels=None, ncol: int | None = None, fontsize: float = 9.0) -> None:
    if handles is None or labels is None:
        handles, labels = ax.get_legend_handles_labels()
    if not handles:
        return
    ax.legend(
        handles,
        labels,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.18),
        ncol=ncol or min(len(handles), 4),
        frameon=False,
        fontsize=fontsize,
    )


def _first_existing_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    return next((column for column in candidates if column in df and df[column].notna().any()), None)


def _wrap_label(label: str, width: int = 8) -> str:
    if len(label) <= width:
        return label
    if "(" in label:
        return label.replace("(", "\n(", 1)
    parts = label.split()
    if len(parts) > 1:
        midpoint = len(parts) // 2
        return " ".join(parts[:midpoint]) + "\n" + " ".join(parts[midpoint:])
    return label[:width] + "\n" + label[width:]


def chart_tr_history(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches.dropna(subset=["tr_after"])
    fig, ax = plt.subplots(figsize=(10.5, 4.4))
    bg_handles = []
    rating_values = [m["tr_after"]]
    est_tr_col = "Est. TR"
    for legacy_est_tr_col in ["Est. TR " + "(TetraStats)", "Est. TR(" + "S2 " + "sheet" + "Bot)"]:
        if est_tr_col not in m and legacy_est_tr_col in m:
            est_tr_col = legacy_est_tr_col
    if est_tr_col in m and m[est_tr_col].notna().any():
        est_tr = pd.to_numeric(m[est_tr_col], errors="coerce").rolling(
            window=ROLLING_WINDOW, min_periods=max(3, ROLLING_WINDOW // 2)
        ).mean()
        line, = ax.plot(m["played_at_jst"], est_tr, linewidth=1.0, alpha=0.75, color="#38bdf8", label=f"Est. TR（{ROLLING_WINDOW}試合ローリング平均）", zorder=2)
        bg_handles.append(line)
        rating_values.append(est_tr)
    tr_line, = ax.plot(m["played_at_jst"], m["tr_after"], linewidth=1.35, label="TR", zorder=3, color="#f97316")
    _set_padded_ylim(ax, pd.concat(rating_values, ignore_index=True), pad_ratio=0.05)
    if len(m):
        peak = m.loc[m["tr_after"].idxmax()]
        ax.scatter([peak["played_at_jst"]], [peak["tr_after"]], s=36, zorder=4, color="#f97316")
        ax.annotate(f"ピーク {peak['tr_after']:,.0f}", (peak["played_at_jst"], peak["tr_after"]), xytext=(8, 10), textcoords="offset points", fontsize=9)
    ax.set_title("TR推移")
    ax.set_ylabel("TR")
    ax.grid(alpha=0.3)
    ax.legend(handles=[tr_line, *bg_handles], loc="center left", bbox_to_anchor=(1.08, 0.5), frameon=False, fontsize=8.5)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    save(fig, out / "01_tr_history.png")


def chart_metric_distributions(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches
    specs = [("APM", "apm", "opponent_apm"), ("PPS", "pps", "opponent_pps"), ("VS", "vs", "opponent_vs"), ("APP", "APP", "opponent_APP")]
    fig, axes = plt.subplots(1, 4, figsize=(12.0, 4.2))
    for ax, (label, own, opp) in zip(axes, specs):
        data = [m[own].dropna(), m[opp].dropna()]
        ax.boxplot(data, tick_labels=["自分", "相手"], showfliers=False)
        ax.set_title(label)
        ax.grid(axis="y", alpha=0.25)
    fig.suptitle("主要指標の分布（試合平均）", y=1.02)
    fig.tight_layout()
    save(fig, out / "02_metric_distributions.png")


def draw_radar(labels, own, opp, title, subtitle, output, radial_max=None) -> None:
    own = np.asarray(own, dtype=float)
    opp = np.asarray(opp, dtype=float)
    n = len(labels)
    angles = np.pi / 2 - np.linspace(0, 2 * np.pi, n, endpoint=False)
    unit_x = np.cos(angles)
    unit_y = np.sin(angles)
    if radial_max is None:
        radial_max = max(1.05, np.nanmax(np.r_[own, opp]) * 1.1)
    data_abs_max = float(np.nanmax(np.abs(np.r_[own, opp])))
    radial_max = max(radial_max, data_abs_max * 1.1, 1e-6)

    def signed_xy(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x = values * unit_x
        y = values * unit_y
        return np.r_[x, x[0]], np.r_[y, y[0]]

    fig, ax = plt.subplots(figsize=(8.7, 7.8))
    closed_x = np.r_[unit_x, unit_x[0]]
    closed_y = np.r_[unit_y, unit_y[0]]
    for r in np.linspace(radial_max / 5, radial_max, 5):
        ax.plot(closed_x * r, closed_y * r, color="#9ca3af", linewidth=0.9, alpha=0.65, zorder=0)
    for x, y in zip(unit_x, unit_y):
        ax.plot([-x * radial_max, x * radial_max], [-y * radial_max, y * radial_max], color="#9ca3af", linewidth=0.8, alpha=0.55, zorder=0)
    ax.scatter([0], [0], s=12, color="#6b7280", zorder=2)

    own_x, own_y = signed_xy(own)
    opp_x, opp_y = signed_xy(opp)
    l1, = ax.plot(own_x, own_y, linewidth=2.4, marker="o", markersize=4, label="自分")
    l2, = ax.plot(opp_x, opp_y, linewidth=2.0, marker="o", markersize=3, linestyle="--", label="相手平均")
    ax.fill(own_x, own_y, alpha=0.16)
    ax.fill(opp_x, opp_y, alpha=0.08)
    label_radius = radial_max * 1.08
    for label, x, y in zip(labels, unit_x, unit_y):
        ax.text(x * label_radius, y * label_radius, label, ha="center", va="center", fontsize=11)
    ax.set_title(f"{title}\n{subtitle}" if subtitle else title, pad=22, fontsize=14)
    ax.legend(handles=[l1, l2], loc="upper right", bbox_to_anchor=(1.25, 1.12), frameon=False)
    limit = radial_max * 1.18
    ax.set_xlim(-limit, limit)
    ax.set_ylim(-limit, limit)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.subplots_adjust(left=0.08, right=0.83, top=0.82, bottom=0.08)
    save(fig, output)


def _recent_subtitle(bundle: AnalysisBundle, tail: str = "") -> str:
    scope = bundle.summary.get("recent_scope", {})
    nm = scope.get("n_matches")
    base = f"直近{nm}試合・試合単位" if nm else "直近100試合・試合単位"
    return f"{base} - {tail}" if tail else base


def chart_capability_radar(bundle: AnalysisBundle, out: Path) -> None:
    s = bundle.summary["metrics_recent"]
    labels = ["APM", "PPS", "VS", "APP", "DS/Second", "DS/Piece", "APP+DS/Piece", "VS/APM", "Cheese Index", "Garbage Eff."]
    own = np.array([s[x]["self"] for x in labels], dtype=float)
    opp = np.array([s[x]["opponent"] for x in labels], dtype=float)
    denom = np.maximum(np.abs(own), np.abs(opp))
    denom[~np.isfinite(denom) | (denom == 0)] = 1
    draw_radar(labels, own / denom, opp / denom, "能力レーダー", _recent_subtitle(bundle, "各軸＝自分と相手平均の最大値で正規化"), out / "03_capability_radar.png", radial_max=1.05)


def chart_style_radar(bundle: AnalysisBundle, out: Path) -> None:
    s = bundle.summary["styles_recent"]["means"]
    own = [s[x]["self"] for x in STYLE_ORDER]
    opp = [s[x]["opponent"] for x in STYLE_ORDER]
    radial_max = max(0.8, np.nanmax(np.r_[own, opp]) * 1.15)
    draw_radar(STYLE_ORDER, own, opp, "4プレイスタイル", _recent_subtitle(bundle), out / "04_playstyle_radar.png", radial_max=radial_max)


def chart_style_trend(bundle: AnalysisBundle, out: Path) -> None:
    """Rolling average trend for the four playstyles."""
    m = bundle.matches.sort_values("played_at_jst").copy()
    style_colors = {
        "Opener": "#d62728",
        "Plonk": "#16a34a",
        "Stride": "#eab308",
        "Inf DS": "#2563eb",
    }
    window = ROLLING_WINDOW
    min_periods = max(3, window // 2)
    fig, ax = plt.subplots(figsize=(11.4, 4.6))
    plotted = False
    for style in STYLE_ORDER:
        if style not in m:
            continue
        series = pd.to_numeric(m[style], errors="coerce").rolling(window=window, min_periods=min_periods).mean()
        if series.dropna().empty:
            continue
        ax.plot(m["played_at_jst"], series, linewidth=1.9, label=style, color=style_colors.get(style))
        plotted = True
    ax.set_title(f"4スタイル推移（自分・{window}試合ローリング平均）", fontsize=13)
    ax.set_ylabel("スタイル傾向")
    ax.set_xlabel("JSTの試合日時")
    ax.grid(alpha=0.3)
    if plotted:
        ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), frameon=False, fontsize=10)
        ax.set_xlim(m["played_at_jst"].min(), m["played_at_jst"].max())
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    save(fig, out / "20_playstyle_trend.png")


def chart_effect_sizes(bundle: AnalysisBundle, out: Path) -> None:
    data = [x for x in bundle.summary["effect_sizes"] if x["d"] is not None]
    data = sorted(data, key=lambda x: x["d"])
    fig, ax = plt.subplots(figsize=(8.5, 5.0))
    ax.barh([x["metric"] for x in data], [x["d"] for x in data])
    ax.axvline(0, linewidth=1)
    ax.set_title("勝利群と敗北群の効果量（Cohen's d）")
    ax.set_xlabel("正：勝利時に高い")
    ax.grid(axis="x", alpha=0.25)
    save(fig, out / "08_relative_effect_sizes.png")


def chart_delta_vs(bundle: AnalysisBundle, out: Path) -> None:
    bins = bundle.summary["delta_vs_bins"]
    fig, ax = plt.subplots(figsize=(8.7, 4.7))
    if bins:
        x = [b["delta_mean"] for b in bins]
        y = [b["win_rate"] * 100 for b in bins]
        n = [b["n"] for b in bins]
        ax.plot(x, y, marker="o")
        for xx, yy, nn in zip(x, y, n):
            ax.annotate(f"n={nn}", (xx, yy), xytext=(0, 7), textcoords="offset points", ha="center", fontsize=7)
    ax.axhline(50, linewidth=1, linestyle="--")
    ax.axvline(0, linewidth=1, linestyle=":")
    ax.set_title("相対VS差と勝率")
    ax.set_xlabel("自分VS - 相手VS")
    ax.set_ylabel("勝率（%）")
    ax.grid(alpha=0.25)
    save(fig, out / "09_delta_vs_winrate.png")


def chart_dominance(bundle: AnalysisBundle, out: Path) -> None:
    mat = np.full((2, 2), np.nan)
    ns = np.zeros((2, 2), dtype=int)
    for row in bundle.summary["dominance"]:
        i = 1 if row["vs_adv"] else 0
        j = 1 if row["apm_adv"] else 0
        win_rate = row.get("win_rate")
        if win_rate is not None and np.isfinite(win_rate):
            mat[i, j] = win_rate * 100
        ns[i, j] = row["n"]
    fig, ax = plt.subplots(figsize=(6.0, 5.0))
    cmap = plt.get_cmap("viridis").copy()
    cmap.set_bad("#f3f4f6")
    im = ax.imshow(np.ma.masked_invalid(mat), cmap=cmap, vmin=0, vmax=100, aspect="auto")
    ax.set_xticks([0, 1], ["APM劣位", "APM優位"])
    ax.set_yticks([0, 1], ["VS劣位", "VS優位"])
    for i in range(2):
        for j in range(2):
            label = f"{mat[i,j]:.1f}%\nn={ns[i,j]}" if np.isfinite(mat[i, j]) else f"窶能nn={ns[i,j]}"
            ax.text(j, i, label, ha="center", va="center")
    ax.set_title("APM・VS相対優位による勝率")
    fig.colorbar(im, ax=ax, label="勝率（%）")
    save(fig, out / "10_apm_vs_dominance_heatmap.png")


def chart_tr_gap(bundle: AnalysisBundle, out: Path) -> None:
    d = bundle.summary["tr_gap"]
    x = np.arange(len(d))
    fig, ax = plt.subplots(figsize=(10.2, 5.2))
    if d:
        ax.plot(x, [r["actual"] * 100 for r in d], marker="o", label="実績")
        ax.plot(x, [r["expected"] * 100 for r in d], marker="o", linestyle="--", label="期待")
        for i, row in enumerate(d):
            ax.annotate(f"n={row['n']}", (i, row["actual"] * 100), xytext=(0, 7), textcoords="offset points", ha="center", fontsize=7)
        ax.set_xticks(x, [r["label"] for r in d], rotation=30, ha="right", rotation_mode="anchor")
    ax.set_title("相手TR差別の実績勝率 vs 期待勝率")
    ax.set_ylabel("勝率（%）")
    ax.set_xlabel("自分TR - 相手TR", labelpad=10)
    ax.grid(alpha=0.25)
    handles, labels = ax.get_legend_handles_labels()
    if handles:
        ax.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, -0.32),
                  ncol=2, frameon=False, fontsize=9)
    fig.tight_layout(rect=(0, 0.06, 0.9, 1))
    save(fig, out / "12_tr_gap_expected_vs_actual.png")


def chart_drawdown(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches.dropna(subset=["tr_after"]).copy()
    dd = m["tr_after"] - m["tr_after"].cummax()
    fig, ax = plt.subplots(figsize=(10.5, 4.2))
    ax.fill_between(m["played_at_jst"], dd, 0, color="#fecaca", alpha=0.75)
    ax.plot(m["played_at_jst"], dd, color="#dc2626", linewidth=1.25)
    ax.axhline(0, color="#991b1b", linewidth=1)
    if len(dd):
        idx = dd.idxmin()
        ax.annotate(f"最大 {dd.loc[idx]:,.0f}", (m.loc[idx, "played_at_jst"], dd.loc[idx]), xytext=(8, -18), textcoords="offset points", fontsize=9)
    ax.set_title("TRドローダウン（過去ピークからの下落幅）")
    ax.set_ylabel("TR差")
    ax.grid(alpha=0.25)
    fig.autofmt_xdate()
    save(fig, out / "13_tr_drawdown.png")


def chart_streaks(bundle: AnalysisBundle, out: Path) -> None:
    s = bundle.summary["streaks"]
    max_len = max(s["max_win"], s["max_loss"], 1)
    lengths = np.arange(1, max_len + 1)
    win_counts = [s["win_runs"].count(int(x)) for x in lengths]
    loss_counts = [s["loss_runs"].count(int(x)) for x in lengths]
    fig, ax = plt.subplots(figsize=(9.0, 4.5))
    width = 0.38
    ax.bar(lengths - width / 2, win_counts, width, label="連勝")
    ax.bar(lengths + width / 2, loss_counts, width, label="連敗")
    ax.set_title("連勝・連敗の長さ分布")
    ax.set_xlabel("連続試合数")
    ax.set_ylabel("発生回数")
    ax.set_xticks(lengths)
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=0.25)
    save(fig, out / "14_streak_distribution.png")


def chart_tiebreak(bundle: AnalysisBundle, out: Path) -> None:
    routes = bundle.summary["tiebreak"].get("routes", [])
    fig, ax = plt.subplots(figsize=(9.4, 4.8))
    if routes:
        x = np.arange(len(routes))
        width = 0.36
        ax.bar(x - width / 2, [r["win_rate"] * 100 for r in routes], width, label="実績")
        ax.bar(x + width / 2, [r["expected"] * 100 for r in routes], width, label="期待")
        ax.set_xticks(x, [_wrap_label(str(r["route"]), width=9) for r in routes], rotation=0, ha="center")
        for i, r in enumerate(routes):
            ax.text(i, max(r["win_rate"], r["expected"]) * 100 + 2, f"n={r['n']}", ha="center", fontsize=8)
    ax.set_ylim(0, 100)
    ax.set_title("タイブレーク到達経路別の実績 vs 期待")
    ax.set_ylabel("勝率（%）")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout(rect=(0, 0, 0.82, 1))
    save(fig, out / "15_tiebreak_analysis.png")


def chart_session_position(bundle: AnalysisBundle, out: Path) -> None:
    d = bundle.summary["session_positions"]
    x = np.arange(len(d))
    fig, ax = plt.subplots(figsize=(10.5, 4.5))
    width = 0.36
    if d:
        ax.bar(x - width / 2, [r["actual"] * 100 for r in d], width, label="実績")
        ax.bar(x + width / 2, [r["expected"] * 100 for r in d], width, label="期待")
        ax.set_xticks(x, [r["label"] for r in d], rotation=20, ha="right")
        for i, r in enumerate(d):
            ax.text(i, max(r["actual"], r["expected"]) * 100 + 1.5, f"n={r['n']}", ha="center", fontsize=8)
    ax.set_ylim(0, 100)
    ax.set_title("セッション内の連戦位置別勝率")
    ax.set_ylabel("勝率（%）")
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=0.25)
    save(fig, out / "16_session_position.png")


def _chart_excess_breakdown(rows: list[dict], title: str, output: Path) -> None:
    x = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(10.5, 4.5))
    width = 0.36
    if rows:
        ax.bar(x - width / 2, [r["actual"] * 100 for r in rows], width, label="実績")
        ax.bar(x + width / 2, [r["expected"] * 100 for r in rows], width, label="期待")
        ax.set_xticks(x, [r["label"] for r in rows], rotation=0, ha="center")
        for i, r in enumerate(rows):
            ax.text(i, max(r["actual"], r["expected"]) * 100 + 1.5, f"n={r['n']}", ha="center", fontsize=8)
    ax.set_ylim(0, 100)
    ax.set_title(title)
    ax.set_ylabel("勝率（%）")
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()
    save(fig, output)


def chart_excess_weekday(bundle: AnalysisBundle, out: Path) -> None:
    _chart_excess_breakdown(
        bundle.summary.get("excess_by_weekday", []),
        "曜日別の実績・期待勝率と期待超過", out / "20_excess_weekday.png",
    )


def chart_excess_hour(bundle: AnalysisBundle, out: Path) -> None:
    _chart_excess_breakdown(
        bundle.summary.get("excess_by_hour", []),
        "時間帯別の実績・期待勝率と期待超過", out / "21_excess_hour.png",
    )


def chart_duration(bundle: AnalysisBundle, out: Path) -> None:
    d = [r for r in bundle.summary["duration_bins"] if r["n"] >= 20]
    fig, ax = plt.subplots(figsize=(10.2, 4.6))
    if d:
        x = np.arange(len(d))
        ax.plot(x, [r["win_rate"] * 100 for r in d], marker="o")
        ax.set_xticks(x, [r["label"] for r in d], rotation=35, ha="right")
        for i, r in enumerate(d):
            ax.annotate(f"n={r['n']}", (i, r["win_rate"] * 100), xytext=(0, 7), textcoords="offset points", ha="center", fontsize=7)
    ax.axhline(50, linewidth=1, linestyle="--")
    ax.set_title("ラウンド継続時間別のラウンド勝率（30秒粒度）")
    ax.set_ylabel("勝率（%）")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    save(fig, out / "17_round_duration.png")


def chart_score_state(bundle: AnalysisBundle, out: Path) -> None:
    states = bundle.summary.get("score_states", [])
    fig, ax = plt.subplots(figsize=(9.4, 4.6))
    if states:
        labels = ["双方MP\n(タイブレーク)" if s["label"] == "双方MP" else s["label"] for s in states]
        rates = [s["win_rate"] * 100 if s["win_rate"] is not None and np.isfinite(s["win_rate"]) else 0.0 for s in states]
        score_colors = ["#94a3b8", "#94a3b8", "#94a3b8", "#22c55e", "#ef4444", "#f59e0b"]
        colors = [score_colors[i] if i < len(score_colors) else "#94a3b8" for i in range(len(states))]
        x = np.arange(len(states))
        ax.bar(x, rates, color=colors)
        ax.set_xticks(x, labels, rotation=0, ha="center")
        for i, s in enumerate(states):
            ax.text(i, rates[i] + 1.5, f"n={s['n']}", ha="center", fontsize=8)
    ax.axhline(50, linewidth=1, linestyle="--")
    ax.set_ylim(0, 100)
    ax.set_title("スコア状況別・次ラウンド勝率（ラウンド開始前スコアで分類）")
    ax.set_ylabel("勝率（%）")
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()
    save(fig, out / "18_score_state_next_round.png")


def chart_duration_deltas(bundle: AnalysisBundle, out: Path) -> None:
    d = [r for r in bundle.summary["duration_bins"] if r["n"] >= 20]
    metrics = [
        ("delta_APM", "APM"),
        ("delta_PPS", "PPS"),
        ("delta_VS", "VS"),
        ("delta_APP", "APP"),
        ("delta_DS/S", "DS/S"),
        ("delta_DS/P", "DS/Piece"),
        ("delta_GbE", "GbE"),
        ("delta_Area", "Area"),
    ]
    fig, axes = plt.subplots(4, 2, figsize=(11.4, 9.4), sharex=True)
    axes_flat = axes.flatten()
    if d:
        x = np.arange(len(d))
        labels = [r["label"] for r in d]
        for ax, (key, label) in zip(axes_flat, metrics):
            y = np.array([r.get(key, np.nan) for r in d], dtype=float)
            ax.plot(x, y, marker="o", linewidth=1.6, color="#2563eb")
            ax.axhline(0, linewidth=1, linestyle="--", color="#6b7280")
            finite = y[np.isfinite(y)]
            if len(finite):
                low, high = float(finite.min()), float(finite.max())
                span = high - low
                pad = span * 0.18 if span > 0 else max(abs(high) * 0.12, 0.05)
                ax.set_ylim(low - pad, high + pad)
            ax.set_title(f"Δ{label}", fontsize=10)
            ax.grid(alpha=0.25)
        for ax in axes_flat[-2:]:
            ax.set_xticks(x, labels, rotation=35, ha="right")
    else:
        for ax, (_, label) in zip(axes_flat, metrics):
            ax.set_title(f"Δ{label}", fontsize=10)
            ax.axhline(0, linewidth=1, linestyle="--", color="#6b7280")
            ax.grid(alpha=0.25)
    fig.suptitle("ラウンド決着時間帯別の能力差分（自分−相手）", y=0.995)
    fig.supxlabel("ラウンド決着時間帯", y=0.015)
    fig.supylabel("差分（自分−相手）", x=0.01)
    fig.tight_layout(rect=(0.03, 0.04, 1, 0.97))
    save(fig, out / "19_duration_metric_deltas.png")


def chart_monthly_trends(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches.sort_values("played_at_jst").copy()
    metric_styles = {
        "APM":    ("apm",            "#d62728", "-"),
        "PPS":    ("pps",            "#1f77b4", "-"),
        "VS":     ("vs",             "#2ca02c", "-"),
        "Area":   ("Area",           "#e377c2", "-"),
        "APP":    ("APP",            "#ff7f0e", "-"),
        "DS/S":   ("DS/Second",      "#9467bd", "-"),
        "DS/P":   ("DS/Piece",       "#17becf", "-"),
        "GbE":    ("Garbage Effi.",  "#8c564b", "-"),
        "VS/APM": ("VS/APM",         "#111827", "-"),
    }
    groups = [
        ("APM / PPS / VS", ["APM", "PPS", "VS"]),
        ("派生指標", ["APP", "DS/S", "DS/P", "GbE", "VS/APM", "Area"]),
    ]
    window = ROLLING_WINDOW
    min_periods = max(3, window // 2)
    fig, axes = plt.subplots(2, 1, figsize=(11.4, 7.4), sharex=True)
    for ax, (title, metrics) in zip(axes, groups):
        for metric in metrics:
            col, color, linestyle = metric_styles[metric]
            if col not in m:
                continue
            series = pd.to_numeric(m[col], errors="coerce").rolling(window=window, min_periods=min_periods).mean()
            valid = series.dropna()
            if valid.empty:
                continue
            first = valid.iloc[0]
            if first == 0 or not np.isfinite(first):
                continue
            ax.plot(m["played_at_jst"], series / first * 100, linewidth=1.8, label=metric, color=color, linestyle=linestyle)
        ax.axhline(100, linewidth=1, linestyle="--", color="#6b7280")
        ax.set_title(title, fontsize=12)
        ax.set_ylabel("指数")
        ax.grid(alpha=0.3)
        ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), frameon=False, fontsize=9.5)
        if len(m):
            ax.set_xlim(m["played_at_jst"].min(), m["played_at_jst"].max())
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    axes[-1].set_xlabel("JSTの試合日時")
    fig.suptitle(f"指標推移（初期ローリング平均＝100、{window}試合窓）", y=0.995, fontsize=13)
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0, 0.9, 0.965), h_pad=3.4)
    save(fig, out / "05_monthly_normalized_trends.png")


def chart_stability_windows(bundle: AnalysisBundle, out: Path) -> None:
    stability = bundle.summary.get("stability", {})
    specs = [spec for spec in GROWTH_STABILITY_METRICS if spec[0] in stability]
    fig, axes = plt.subplots(4, 2, figsize=(11.2, 10.0))
    axes_flat = axes.flatten()
    for ax, (metric, _, fmt) in zip(axes_flat, specs):
        row = stability[metric]
        early = [row.get("early_p10"), row.get("early_p50"), row.get("early_p90")]
        recent = [row.get("recent_p10"), row.get("recent_p50"), row.get("recent_p90")]
        for y, vals, color, label in [(1, early, "#64748b", "Early"), (0, recent, "#2563eb", "Recent")]:
            p10, p50, p90 = [float(v) if v is not None and np.isfinite(v) else np.nan for v in vals]
            if np.isfinite(p10) and np.isfinite(p90):
                ax.hlines(y, p10, p90, color=color, linewidth=5, alpha=0.35)
            if np.isfinite(p50):
                ax.scatter([p50], [y], color=color, s=34, zorder=3, label=label)
                ax.annotate(fmt.format(p50), (p50, y), xytext=(6, 0), textcoords="offset points", va="center", fontsize=8)
        early_cv = row.get("early_cv")
        recent_cv = row.get("recent_cv")
        cv_text = ""
        if early_cv is not None and recent_cv is not None and np.isfinite(early_cv) and np.isfinite(recent_cv):
            cv_text = f"CV {early_cv * 100:.1f}% -> {recent_cv * 100:.1f}%"
        ax.set_title(f"{metric}  {cv_text}", fontsize=10)
        ax.set_yticks([1, 0], ["Early", "Recent"])
        ax.grid(axis="x", alpha=0.25)
    for ax in axes_flat[len(specs):]:
        ax.axis("off")
    handles, labels = axes_flat[0].get_legend_handles_labels()
    if handles:
        fig.legend(handles[:2], labels[:2], loc="upper right", frameon=False)
    fig.suptitle("Stability by metric (p10-p90 band, median point; early vs recent window)", y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    save(fig, out / "06_stability_windows.png")


def generate_all_charts(bundle: AnalysisBundle, output_dir: Path) -> None:
    set_japanese_font()
    funcs = [
        chart_tr_history, chart_metric_distributions, chart_capability_radar, chart_style_radar,
        chart_style_trend, chart_monthly_trends, chart_stability_windows, chart_effect_sizes,
        chart_delta_vs, chart_dominance, chart_tr_gap,
        chart_drawdown, chart_streaks, chart_tiebreak, chart_session_position,
        chart_duration, chart_score_state, chart_duration_deltas,
        chart_excess_weekday, chart_excess_hour,
    ]
    for func in funcs:
        func(bundle, output_dir)
    return len(funcs)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("csv", type=Path)
    p.add_argument("--player", default="your_username")
    p.add_argument("--output", type=Path, default=PROJECT_ROOT / "charts")
    args = p.parse_args()
    bundle = analyze_csv(args.csv, player_name=args.player)
    chart_count = generate_all_charts(bundle, args.output)
    print(f"{chart_count}グラフ生成完了: {args.output}")

if __name__ == "__main__":
    main()
