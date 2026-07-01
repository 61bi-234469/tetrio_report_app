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

from report_analysis import ABILITY_METRIC_COLUMNS, ABILITY_METRICS, AnalysisBundle, STYLE_ORDER, analyze_csv

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# ローリング平均の窓幅（マッチ数）。トレンド系チャート共通。
ROLLING_WINDOW = 10

METRIC_COLORS = {
    "APM": "#d62728",
    "PPS": "#1f77b4",
    "VS": "#2ca02c",
    "APP": "#d62728",
    "DS/Second": "#7e57c2",
    "DS/Piece": "#00a6a6",
    "APP+DS/Piece": "#7c3aed",
    "VS/APM": "#374151",
    "Cheese Index": "#eab308",
    "Garbage Eff.": "#1e3a8a",
    "Area": "#c026d3",
    "Est. TR": "#38bdf8",
}
METRIC_COLORS.update({
    "DS/S": METRIC_COLORS["DS/Second"],
    "DS/P": METRIC_COLORS["DS/Piece"],
    "GbE": METRIC_COLORS["Garbage Eff."],
})


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
    """実際のmin/maxを基準に余白を付ける。分位点でクリップすると線が軸に収まらないため使わない。"""
    vals = pd.to_numeric(values, errors="coerce")
    vals = vals[np.isfinite(vals)]
    if vals.empty:
        return
    lo = float(vals.min())
    hi = float(vals.max())
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


def _rate_label(value: float) -> str:
    return f"{value:.1f}%" if value is not None and np.isfinite(value) else "—"


def _annotate_grouped_rate_bars(ax, centers, series_values, ns, offsets) -> None:
    for values, offset in zip(series_values, offsets):
        for x, value in zip(centers, values):
            if value is None or not np.isfinite(value):
                continue
            ax.text(x + offset, min(value + 1.8, 106), _rate_label(value),
                    ha="center", va="bottom", fontsize=7.5)
    for x, n in zip(centers, ns):
        ax.text(x, 2.0, f"n={n}", ha="center", va="bottom", fontsize=7.5, color="#374151")


def _annotate_single_rate_bars(ax, xs, values, ns) -> None:
    for x, value, n in zip(xs, values, ns):
        if value is not None and np.isfinite(value):
            ax.text(x, min(value + 1.8, 106), _rate_label(value),
                    ha="center", va="bottom", fontsize=7.5)
        ax.text(x, 2.0, f"n={n}", ha="center", va="bottom", fontsize=7.5, color="#374151")


def _set_rate_axis(ax, ylabel: str = "勝率（%）") -> None:
    ax.set_ylim(0, 108)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.set_ylabel(ylabel)


def chart_tr_history(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches.dropna(subset=["tr_after"])
    fig, ax = plt.subplots(figsize=(11.5, 4.6))
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
        line, = ax.plot(m["played_at_jst"], est_tr, linewidth=1.0, alpha=0.75, color="#38bdf8", label=f"Est. TR（{ROLLING_WINDOW}マッチローリング平均）", zorder=2)
        bg_handles.append(line)
        rating_values.append(est_tr)
    tr_line, = ax.plot(m["played_at_jst"], m["tr_after"], linewidth=1.35, label="TR", zorder=3, color="#f97316")
    _set_padded_ylim(ax, pd.concat(rating_values, ignore_index=True), pad_ratio=0.1)
    if len(m):
        peak = m.loc[m["tr_after"].idxmax()]
        ax.scatter([peak["played_at_jst"]], [peak["tr_after"]], s=36, zorder=4, color="#f97316")
        ax.annotate(f"ピーク {peak['tr_after']:,.0f}", (peak["played_at_jst"], peak["tr_after"]), xytext=(8, 10), textcoords="offset points", fontsize=9)

    # リーグランクが切り替わった地点に新ランク（例：U）を表示し、ランク推移をTR推移へ統合する。
    rank_handle = None
    transitions = bundle.summary.get("rank_journey", {}).get("transitions", [])
    rank_points = [
        (pd.to_datetime(t.get("date"), errors="coerce"), t.get("tr_after"), str(t.get("to", "")).strip())
        for t in transitions
    ]
    rank_points = [(d, y, lab) for d, y, lab in rank_points if lab and y is not None and pd.notna(d)]
    if rank_points:
        xs = [d for d, _, _ in rank_points]
        ys = [y for _, y, _ in rank_points]
        rank_handle = ax.scatter(xs, ys, s=26, marker="D", color="#7c3aed", zorder=5, label="ランク変化")
        for i, (d, y, lab) in enumerate(rank_points):
            y_off = 10 if i % 2 == 0 else -13
            va = "bottom" if i % 2 == 0 else "top"
            ax.annotate(lab.upper(), (d, y), xytext=(0, y_off), textcoords="offset points",
                        ha="center", va=va, fontsize=8, color="#7c3aed", fontweight="bold", zorder=6)

    ax.set_title("TR推移")
    ax.set_ylabel("TR")
    ax.grid(alpha=0.3)
    handles = [tr_line, *bg_handles]
    if rank_handle is not None:
        handles.append(rank_handle)
    _legend_below(ax, handles=handles, labels=[h.get_label() for h in handles], ncol=min(len(handles), 3), fontsize=8.5)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0.12, 1, 1))
    save(fig, out / "01_tr_history.png")


def chart_metric_distributions(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches
    specs = [
        (label, own, f"opponent_{own}" if own in {"apm", "pps", "vs"} else (
            "opponent_Garbage Effi." if label == "Garbage Eff." else f"opponent_{own}"
        ))
        for label, own in ABILITY_METRIC_COLUMNS
    ]
    fig, axes = plt.subplots(4, 3, figsize=(12.4, 11.2))
    axes_flat = axes.flatten()
    for ax, (label, own, opp) in zip(axes_flat, specs):
        data = [
            pd.to_numeric(m[own], errors="coerce").dropna() if own in m else pd.Series(dtype=float),
            pd.to_numeric(m[opp], errors="coerce").dropna() if opp in m else pd.Series(dtype=float),
        ]
        ax.boxplot(data, tick_labels=["自分", "相手"], showfliers=False)
        ax.set_title(label)
        ax.grid(axis="y", alpha=0.25)
    for ax in axes_flat[len(specs):]:
        ax.axis("off")
    fig.suptitle("主要指標の分布（マッチ平均）", y=1.02)
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
    base = f"直近{nm}マッチ・マッチ単位" if nm else "直近100マッチ・マッチ単位"
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
    ax.set_title(f"4スタイル推移（自分・{window}マッチローリング平均）", fontsize=13)
    ax.set_ylabel("スタイル傾向")
    ax.set_xlabel("JSTのマッチ日時")
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
    data = sorted(data, key=lambda x: x["d"] if np.isfinite(x["d"]) else -np.inf, reverse=True)
    fig, ax = plt.subplots(figsize=(9.0, 7.0))
    ax.barh([x["metric"] for x in data], [x["d"] for x in data])
    ax.invert_yaxis()
    ax.axvline(0, linewidth=1)
    ax.set_title("勝利群と敗北群の効果量（Cohen's d）")
    ax.set_xlabel("正：勝利時に高い")
    ax.grid(axis="x", alpha=0.25)
    save(fig, out / "08_relative_effect_sizes.png")


def chart_delta_vs(bundle: AnalysisBundle, out: Path) -> None:
    specs = [
        ("APM", "自分APM - 相手APM", "相対APM差と勝率", "09_delta_apm_winrate.png"),
        ("PPS", "自分PPS - 相手PPS", "相対PPS差と勝率", "09_delta_pps_winrate.png"),
        ("VS", "自分VS - 相手VS", "相対VS差と勝率", "09_delta_vs_winrate.png"),
        ("Area", "自分Area - 相手Area", "相対Area差と勝率", "09_delta_area_winrate.png"),
    ]
    all_bins = bundle.summary.get("delta_metric_bins", {"VS": bundle.summary.get("delta_vs_bins", [])})
    for metric, xlabel, title, filename in specs:
        bins = all_bins.get(metric, [])
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
        ax.set_title(title)
        ax.set_xlabel(xlabel)
        ax.set_ylabel("勝率（%）")
        ax.grid(alpha=0.25)
        save(fig, out / filename)


def chart_dominance(bundle: AnalysisBundle, out: Path) -> None:
    specs = [
        ("delta_APM", "delta_VS", "自分APM - 相手APM", "自分VS - 相手VS",
         "APM・VS相対優位による勝敗分布", "10_apm_vs_dominance_scatter.png"),
        ("delta_PPS", "delta_VS", "自分PPS - 相手PPS", "自分VS - 相手VS",
         "PPS・VS相対優位による勝敗分布", "11_pps_vs_dominance_scatter.png"),
    ]
    m = bundle.matches
    for xcol, ycol, xlabel, ylabel, title, filename in specs:
        fig, ax = plt.subplots(figsize=(8.4, 6.4))
        if xcol in m and ycol in m and "won" in m:
            d = m.dropna(subset=[xcol, ycol]).copy()
            d["won"] = d["won"].astype(bool)
            win = d[d["won"]]
            loss = d[~d["won"]]
            ax.scatter(loss[xcol], loss[ycol], s=22, alpha=0.45, color="#dc2626",
                       edgecolors="none", label="負け", zorder=2)
            ax.scatter(win[xcol], win[ycol], s=22, alpha=0.45, color="#16a34a",
                       edgecolors="none", label="勝ち", zorder=3)
            ax.legend(frameon=False, fontsize=9, loc="best")
        ax.axhline(0, color="#9ca3af", linewidth=0.8)
        ax.axvline(0, color="#9ca3af", linewidth=0.8)
        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.grid(alpha=0.2)
        fig.tight_layout()
        save(fig, out / filename)


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


def chart_tr_monthly_stability(bundle: AnalysisBundle, out: Path) -> None:
    m = bundle.matches.dropna(subset=["played_at_jst", "tr_after"]).copy()
    fig, ax = plt.subplots(figsize=(10.8, 4.8))
    if len(m):
        played_at = pd.to_datetime(m["played_at_jst"], errors="coerce")
        if played_at.dt.tz is not None:
            played_at = played_at.dt.tz_convert("Asia/Tokyo").dt.tz_localize(None)
        m["played_at_jst"] = played_at
        m = m.dropna(subset=["played_at_jst", "tr_after"]).sort_values("played_at_jst")
        m["month"] = m["played_at_jst"].dt.to_period("M").dt.to_timestamp()
        monthly = (
            m.groupby("month")["tr_after"]
            .agg(
                p10=lambda s: float(s.quantile(0.1)),
                p50=lambda s: float(s.quantile(0.5)),
                p90=lambda s: float(s.quantile(0.9)),
                n="count",
            )
            .reset_index()
        )
        if len(monthly):
            ax.fill_between(
                monthly["month"], monthly["p10"], monthly["p90"],
                color="#6366f1", alpha=0.18, label="P10-P90", zorder=1,
            )
            ax.plot(
                monthly["month"], monthly["p50"],
                color="#4f46e5", marker="o", markersize=3.8, linewidth=1.9,
                label="P50", zorder=3,
            )
            ax.plot(
                monthly["month"], monthly["p10"],
                color="#64748b", linestyle="--", linewidth=1.15,
                label="P10", zorder=2,
            )
            ax.plot(
                monthly["month"], monthly["p90"],
                color="#8b5cf6", linestyle="--", linewidth=1.15,
                label="P90", zorder=2,
            )
            _set_padded_ylim(ax, pd.concat([monthly["p10"], monthly["p90"]], ignore_index=True), pad_ratio=0.08)
            if len(monthly) == 1:
                center = monthly.loc[0, "month"]
                ax.set_xlim(center - pd.Timedelta(days=15), center + pd.Timedelta(days=15))
    ax.set_title("TR推移：月次TRの分位帯")
    ax.set_ylabel("TR")
    ax.grid(alpha=0.25)
    handles, labels = ax.get_legend_handles_labels()
    if handles:
        ax.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, -0.2),
                  ncol=min(len(handles), 4), frameon=False, fontsize=9)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    save(fig, out / "07_tr_monthly_stability.png")


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
    ax.set_xlabel("連勝・連敗マッチ数")
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
        actual = [r["win_rate"] * 100 for r in routes]
        expected = [r["expected"] * 100 for r in routes]
        ax.bar(x - width / 2, actual, width, label="実績")
        ax.bar(x + width / 2, expected, width, label="期待")
        ax.set_xticks(x, [_wrap_label(str(r["route"]), width=9) for r in routes], rotation=0, ha="center")
        _annotate_grouped_rate_bars(ax, x, [actual, expected], [r["n"] for r in routes], [-width / 2, width / 2])
    _set_rate_axis(ax)
    ax.axhline(50, linewidth=1, linestyle="--")
    ax.set_title("タイブレーク到達経路別の実績 vs 期待")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout(rect=(0, 0, 0.82, 1))
    save(fig, out / "15_tiebreak_analysis.png")


def chart_rivals(bundle: AnalysisBundle, out: Path) -> None:
    rivals = list(bundle.summary.get("rivals", []) or [])[:10]
    fig, ax = plt.subplots(figsize=(9.8, 5.2))
    if rivals:
        rivals = list(reversed(rivals))  # 最多を上に
        labels = [r.get("label") or r.get("opponent", "?") for r in rivals]
        ns = [r["n"] for r in rivals]
        wr = [r.get("win_rate", 0.0) for r in rivals]
        cmap = plt.get_cmap("RdYlGn")
        colors = [cmap(w if w is not None and np.isfinite(w) else 0.5) for w in wr]
        ax.barh(np.arange(len(rivals)), ns, color=colors, edgecolor="#4b5563", linewidth=0.5)
        ax.set_yticks(np.arange(len(rivals)), labels)
        nmax = max(ns)
        for i, r in enumerate(rivals):
            ax.text(r["n"] + nmax * 0.01, i, f"{r['wins']}勝{r['losses']}敗（{r.get('win_rate', 0) * 100:.0f}%）",
                    va="center", fontsize=8)
        ax.set_xlim(0, nmax * 1.28)
        ax.set_xlabel("遭遇回数（マッチ）")
        sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(0, 1))
        fig.colorbar(sm, ax=ax, label="勝率")
    ax.set_title("ライバル（遭遇回数 Top10）")
    ax.grid(axis="x", alpha=0.25)
    fig.tight_layout()
    save(fig, out / "27_rivals.png")


def chart_style_matchup_plane(bundle: AnalysisBundle, out: Path) -> None:
    p = bundle.summary.get("style_matchup_plane", {})
    labels = p.get("axis_labels", {})
    xcol, ycol = "opponent_Stride - Plonk", "opponent_Opener - Inf DS"
    m = bundle.matches
    fig, ax = plt.subplots(figsize=(8.6, 6.9))
    if xcol in m and ycol in m and "won" in m:
        d = m.dropna(subset=[xcol, ycol]).copy()
        d["won"] = d["won"].astype(bool)
        win = d[d["won"]]
        loss = d[~d["won"]]
        ax.scatter(loss[xcol], loss[ycol], s=22, alpha=0.45, color="#dc2626",
                   edgecolors="none", label="負け", zorder=2)
        ax.scatter(win[xcol], win[ycol], s=22, alpha=0.45, color="#16a34a",
                   edgecolors="none", label="勝ち", zorder=3)
        ax.legend(frameon=False, fontsize=9, loc="best")
    sp = p.get("self_pos", {})
    if sp.get("x") is not None and sp.get("y") is not None:
        ax.scatter([sp["x"]], [sp["y"]], marker="*", s=360, color="#111827",
                   edgecolors="#ffffff", linewidths=0.8, zorder=5)
        ax.annotate("自分の平均スタイル位置", (sp["x"], sp["y"]), xytext=(10, -14),
                    textcoords="offset points", fontsize=9, color="#111827",
                    fontweight="bold", zorder=5)
    ax.axhline(0, color="#9ca3af", linewidth=0.8)
    ax.axvline(0, color="#9ca3af", linewidth=0.8)
    ax.set_xlabel(labels.get("x", "Plonk ←→ Stride"))
    ax.set_ylabel(labels.get("y", "Inf DS ←→ Opener"))
    ax.set_title("プレイスタイル相性マップ（相手スタイル × 勝敗）")
    ax.grid(alpha=0.2)
    fig.tight_layout()
    save(fig, out / "25_style_matchup_plane.png")


def chart_session_decay(bundle: AnalysisBundle, out: Path) -> None:
    d = bundle.summary.get("session_decay", [])
    fig, ax = plt.subplots(figsize=(10.5, 4.6))
    if d:
        x = np.arange(len(d))
        wr = [(r["win_rate"] * 100 if r.get("win_rate") is not None and np.isfinite(r.get("win_rate")) else np.nan) for r in d]
        ax.bar(x, wr, color="#93c5fd", label="勝率")
        ax.axhline(50, linewidth=1, linestyle="--", color="#6b7280")
        _set_rate_axis(ax)
        ax.set_xticks(x, [r["label"] for r in d], rotation=20, ha="right")
        _annotate_single_rate_bars(ax, x, wr, [r["n"] for r in d])
        # 副軸：各指標を1マッチ目（先頭位置）=100で正規化した4本線。
        ax2 = ax.twinx()
        series = [
            ("APM", "apm", METRIC_COLORS["APM"]),
            ("PPS", "pps", METRIC_COLORS["PPS"]),
            ("VS", "vs", METRIC_COLORS["VS"]),
            ("Area", "area", METRIC_COLORS["Area"]),
        ]
        for label, key, color in series:
            vals = np.array([r.get(key) if r.get(key) is not None else np.nan for r in d], dtype=float)
            finite = vals[np.isfinite(vals)]
            base = finite[0] if len(finite) and finite[0] != 0 else np.nan
            norm = vals / base * 100 if np.isfinite(base) else vals * np.nan
            ax2.plot(x, norm, marker="o", linewidth=1.6, label=label, color=color)
        ax2.set_ylabel("能力指標（1マッチ目=100）")
        ax2.axhline(100, linewidth=0.8, linestyle=":", color="#9ca3af")
        h1, l1 = ax.get_legend_handles_labels()
        h2, l2 = ax2.get_legend_handles_labels()
        ax.legend(h1 + h2, l1 + l2, frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=5, fontsize=9)
    ax.set_title("セッション内のマッチ位置別 勝率と能力指標（正規化）")
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    save(fig, out / "29_session_decay.png")


def chart_comeback(bundle: AnalysisBundle, out: Path) -> None:
    c = bundle.summary.get("comeback", {})
    fr = c.get("by_first_round", {})
    deficit = c.get("by_max_deficit", [])
    fig, axes = plt.subplots(1, 2, figsize=(11.4, 4.6))

    # 左: 第1ラウンド勝敗別の実績 vs 期待マッチ勝率。
    ax = axes[0]
    groups = [("第1R勝利", fr.get("won_first", {})), ("第1R敗北", fr.get("lost_first", {}))]
    x = np.arange(len(groups))
    width = 0.36
    actual = [(g.get("win_rate") if g.get("win_rate") is not None else np.nan) for _, g in groups]
    expected = [(g.get("expected") if g.get("expected") is not None else np.nan) for _, g in groups]
    actual = [v * 100 if v is not None and np.isfinite(v) else np.nan for v in actual]
    expected = [v * 100 if v is not None and np.isfinite(v) else np.nan for v in expected]
    ax.bar(x - width / 2, actual, width, label="実績")
    ax.bar(x + width / 2, expected, width, label="期待")
    ax.set_xticks(x, [g[0] for g in groups])
    _annotate_grouped_rate_bars(ax, x, [actual, expected], [g.get("n", 0) for _, g in groups], [-width / 2, width / 2])
    ax.axhline(50, linewidth=1, linestyle="--")
    _set_rate_axis(ax, "マッチ勝率（%）")
    ax.set_title("第1ラウンドの勝敗別マッチ勝率")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax.grid(axis="y", alpha=0.25)

    # 右: マッチ中の最大ビハインド別の勝率。
    ax2 = axes[1]
    if deficit:
        xd = np.arange(len(deficit))
        rates = [(d.get("win_rate") * 100 if d.get("win_rate") is not None and np.isfinite(d.get("win_rate")) else np.nan) for d in deficit]
        ax2.bar(xd, rates, color="#ef4444")
        ax2.set_xticks(xd, [d["deficit"] for d in deficit])
        _annotate_single_rate_bars(ax2, xd, rates, [d["n"] for d in deficit])
    ax2.axhline(50, linewidth=1, linestyle="--")
    _set_rate_axis(ax2, "マッチ勝率（%）")
    ax2.set_xlabel("マッチ中の最大ビハインド")
    ax2.set_title("最大ビハインド別のマッチ勝率")
    ax2.grid(axis="y", alpha=0.25)

    fig.suptitle("逆転・リバーススイープ", y=1.02)
    fig.tight_layout()
    save(fig, out / "28_comeback.png")


def chart_session_position(bundle: AnalysisBundle, out: Path) -> None:
    d = bundle.summary["session_positions"]
    x = np.arange(len(d))
    fig, ax = plt.subplots(figsize=(10.5, 4.5))
    width = 0.36
    if d:
        actual = [r["actual"] * 100 for r in d]
        expected = [r["expected"] * 100 for r in d]
        ax.bar(x - width / 2, actual, width, label="実績")
        ax.bar(x + width / 2, expected, width, label="期待")
        ax.set_xticks(x, [r["label"] for r in d], rotation=20, ha="right")
        _annotate_grouped_rate_bars(ax, x, [actual, expected], [r["n"] for r in d], [-width / 2, width / 2])
    _set_rate_axis(ax)
    ax.set_title("セッション内のマッチ位置別勝率")
    ax.axhline(50, linewidth=1, linestyle="--")
    ax.legend(frameon=False)
    ax.grid(axis="y", alpha=0.25)
    save(fig, out / "16_session_position.png")


def _chart_excess_breakdown(rows: list[dict], title: str, output: Path) -> None:
    x = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(10.5, 4.5))
    width = 0.36
    if rows:
        actual = [r["actual"] * 100 for r in rows]
        expected = [r["expected"] * 100 for r in rows]
        ax.bar(x - width / 2, actual, width, label="実績")
        ax.bar(x + width / 2, expected, width, label="期待")
        ax.set_xticks(x, [r["label"] for r in rows], rotation=0, ha="center")
        _annotate_grouped_rate_bars(ax, x, [actual, expected], [r["n"] for r in rows], [-width / 2, width / 2])
    _set_rate_axis(ax)
    ax.set_title(title)
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
        _annotate_single_rate_bars(ax, x, rates, [s["n"] for s in states])
    ax.axhline(50, linewidth=1, linestyle="--")
    _set_rate_axis(ax)
    ax.set_title("スコア状況別・次ラウンド勝率（ラウンド開始前スコアで分類）")
    ax.grid(axis="y", alpha=0.25)
    fig.tight_layout()
    save(fig, out / "18_score_state_next_round.png")


def chart_duration_deltas(bundle: AnalysisBundle, out: Path) -> None:
    d = [r for r in bundle.summary["duration_bins"] if r["n"] >= 20]
    metrics = [(f"delta_{label}", label) for label in ABILITY_METRICS] + [
        (f"delta_{style}", style) for style in STYLE_ORDER
    ]
    style_colors = {
        "Opener": "#d62728",
        "Plonk": "#16a34a",
        "Stride": "#eab308",
        "Inf DS": "#2563eb",
    }
    fig, axes = plt.subplots(4, 4, figsize=(14.2, 10.8), sharex=True)
    axes_flat = axes.flatten()
    if d:
        x = np.arange(len(d))
        labels = [r["label"] for r in d]
        for ax, (key, label) in zip(axes_flat, metrics):
            y = np.array([r.get(key, np.nan) for r in d], dtype=float)
            color = METRIC_COLORS.get(label, style_colors.get(label, "#2563eb"))
            ax.plot(x, y, marker="o", linewidth=1.6, color=color)
            ax.axhline(0, linewidth=1, linestyle="--", color="#6b7280")
            finite = y[np.isfinite(y)]
            if len(finite):
                low, high = float(finite.min()), float(finite.max())
                span = high - low
                pad = span * 0.18 if span > 0 else max(abs(high) * 0.12, 0.05)
                ax.set_ylim(low - pad, high + pad)
            ax.set_title(f"Δ{label}", fontsize=10)
            ax.grid(alpha=0.25)
        for ax in axes_flat[-4:]:
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
        "APM":    ("apm",            METRIC_COLORS["APM"], "-"),
        "PPS":    ("pps",            METRIC_COLORS["PPS"], "-"),
        "VS":     ("vs",             METRIC_COLORS["VS"], "-"),
        "APP":    ("APP",            METRIC_COLORS["APP"], "-"),
        "DS/Second": ("DS/Second",   METRIC_COLORS["DS/Second"], "-"),
        "DS/Piece": ("DS/Piece",     METRIC_COLORS["DS/Piece"], "-"),
        "APP+DS/Piece": ("APP+DS/Piece", METRIC_COLORS["APP+DS/Piece"], "-"),
        "VS/APM": ("VS/APM",         METRIC_COLORS["VS/APM"], "-"),
        "Cheese Index": ("Cheese Index", METRIC_COLORS["Cheese Index"], "-"),
        "Garbage Eff.": ("Garbage Effi.", METRIC_COLORS["Garbage Eff."], "-"),
        "Area":   ("Area",           METRIC_COLORS["Area"], "-"),
        "Est. TR": ("Est. TR",        METRIC_COLORS["Est. TR"], "-"),
    }
    groups = [
        ("APM / PPS / VS / VS/APM", ["VS/APM", "APM", "PPS", "VS"]),
        ("DS/Second / DS/Piece", ["DS/Second", "DS/Piece"]),
        ("APP / APP+DS/Piece / Garbage Eff.", ["APP", "APP+DS/Piece", "Garbage Eff."]),
        ("Cheese Index", ["Cheese Index"]),
        ("Area / Est. TR", ["Area", "Est. TR"]),
    ]
    window = ROLLING_WINDOW
    min_periods = max(3, window // 2)
    fig, axes = plt.subplots(5, 1, figsize=(11.4, 13.2), sharex=True)
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
            zorder = 1 if metric == "VS/APM" else 2
            ax.plot(m["played_at_jst"], series / first * 100, linewidth=1.8, label=metric, color=color, linestyle=linestyle, zorder=zorder)
        ax.axhline(100, linewidth=1, linestyle="--", color="#6b7280")
        ax.set_title(title, fontsize=12)
        ax.set_ylabel("指数")
        ax.grid(alpha=0.3)
        ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), frameon=False, fontsize=9.5)
        if len(m):
            ax.set_xlim(m["played_at_jst"].min(), m["played_at_jst"].max())
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=10))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    axes[-1].set_xlabel("JSTのマッチ日時")
    fig.suptitle(f"指標推移（初期ローリング平均＝100、{window}マッチ窓）", y=0.995, fontsize=13)
    fig.autofmt_xdate()
    fig.tight_layout(rect=(0, 0, 0.9, 0.965), h_pad=3.4)
    save(fig, out / "05_monthly_normalized_trends.png")


def generate_all_charts(bundle: AnalysisBundle, output_dir: Path) -> None:
    set_japanese_font()
    funcs = [
        chart_tr_history, chart_metric_distributions, chart_capability_radar, chart_style_radar,
        chart_style_trend, chart_monthly_trends, chart_effect_sizes,
        chart_tr_monthly_stability, chart_delta_vs, chart_dominance, chart_tr_gap,
        chart_style_matchup_plane, chart_rivals,
        chart_drawdown, chart_streaks, chart_tiebreak, chart_comeback,
        chart_session_position, chart_session_decay,
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
