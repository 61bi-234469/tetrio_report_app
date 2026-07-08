#!/usr/bin/env python3
"""CSVから欠けのない能力レーダー・4スタイルレーダーを再生成する。"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def set_japanese_font() -> None:
    candidates = [
        "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic",
        "IPAGothic", "Yu Gothic", "Hiragino Sans",
    ]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in candidates:
        if name in available:
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False


def draw_radar(
    labels: list[str],
    self_values: np.ndarray,
    opponent_values: np.ndarray,
    output_path: Path,
    title: str,
    subtitle: str,
    radial_max: float,
    radial_ticks: list[float],
) -> None:
    n = len(labels)
    angles = np.pi / 2 - np.linspace(0, 2 * np.pi, n, endpoint=False)
    unit_x = np.cos(angles)
    unit_y = np.sin(angles)
    data_abs_max = float(np.nanmax(np.abs(np.r_[self_values, opponent_values])))
    radial_max = max(radial_max, data_abs_max * 1.1, 1e-6)

    def signed_xy(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x = values * unit_x
        y = values * unit_y
        return np.r_[x, x[0]], np.r_[y, y[0]]

    fig, ax = plt.subplots(figsize=(9.4, 8.4))
    closed_x = np.r_[unit_x, unit_x[0]]
    closed_y = np.r_[unit_y, unit_y[0]]
    for r in radial_ticks:
        if r <= radial_max:
            ax.plot(closed_x * r, closed_y * r, color="#9ca3af", linewidth=0.9, alpha=0.65, zorder=0)
    for x, y in zip(unit_x, unit_y):
        ax.plot([-x * radial_max, x * radial_max], [-y * radial_max, y * radial_max], color="#9ca3af", linewidth=0.8, alpha=0.55, zorder=0)
    ax.scatter([0], [0], s=12, color="#6b7280", zorder=2)

    self_x, self_y = signed_xy(self_values)
    opponent_x, opponent_y = signed_xy(opponent_values)
    self_line, = ax.plot(self_x, self_y, linewidth=2.8, marker="o", markersize=4)
    opp_line, = ax.plot(
        opponent_x, opponent_y, linewidth=2.3, linestyle="--", marker="o", markersize=3
    )
    ax.fill(self_x, self_y, alpha=0.18)
    ax.fill(opponent_x, opponent_y, alpha=0.08)
    label_radius = radial_max * 1.08
    for label, x, y in zip(labels, unit_x, unit_y):
        ax.text(x * label_radius, y * label_radius, label, ha="center", va="center", fontsize=12)
    ax.set_title(f"{title}\n{subtitle}" if subtitle else title, fontsize=16, fontweight="bold", pad=28)
    ax.legend(
        [self_line, opp_line], ["自分", "相手平均"],
        loc="upper right", bbox_to_anchor=(1.23, 1.13),
        frameon=False, fontsize=11,
    )
    limit = radial_max * 1.18
    ax.set_xlim(-limit, limit)
    ax.set_ylim(-limit, limit)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.subplots_adjust(left=0.08, right=0.84, top=0.82, bottom=0.08)
    fig.savefig(output_path, dpi=160, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()

    if not args.csv.is_file():
        raise SystemExit(f"CSV not found: {args.csv}")

    set_japanese_font()
    df = pd.read_csv(args.csv)
    with np.errstate(divide="ignore", invalid="ignore"):
        df["APP_calc"] = df["apm"] / (df["pps"] * 60)
        df["DS_Piece_calc"] = df["DS/Second"] / df["pps"]
        df["opponent_APP_calc"] = (
            df["opponent_apm"] / (df["opponent_pps"] * 60)
        )
        df["opponent_DS_Piece_calc"] = (
            df["opponent_DS/Second"] / df["opponent_pps"]
        )

    cols = [
        "apm", "pps", "vs", "APP_calc", "DS/Second", "DS_Piece_calc",
        "APP+DS/Piece", "VS/APM", "Cheese Index", "Garbage Effi.",
        "opponent_apm", "opponent_pps", "opponent_vs", "opponent_APP_calc",
        "opponent_DS/Second", "opponent_DS_Piece_calc",
        "opponent_APP+DS/Piece", "opponent_VS/APM",
        "opponent_Cheese Index", "opponent_Garbage Effi.",
        "Opener", "Stride", "Inf DS", "Plonk",
        "opponent_Opener", "opponent_Stride",
        "opponent_Inf DS", "opponent_Plonk",
    ]
    means = df.groupby("match_number")[cols].mean().mean()

    capability_labels = [
        "APM", "PPS", "VS", "APP", "DS/Second", "DS/Piece",
        "APP+DS/Piece", "VS/APM", "Cheese Index", "Garbage Eff.",
    ]
    self_raw = np.array([
        means["apm"], means["pps"], means["vs"], means["APP_calc"],
        means["DS/Second"], means["DS_Piece_calc"],
        means["APP+DS/Piece"], means["VS/APM"],
        means["Cheese Index"], means["Garbage Effi."],
    ])
    opp_raw = np.array([
        means["opponent_apm"], means["opponent_pps"],
        means["opponent_vs"], means["opponent_APP_calc"],
        means["opponent_DS/Second"], means["opponent_DS_Piece_calc"],
        means["opponent_APP+DS/Piece"], means["opponent_VS/APM"],
        means["opponent_Cheese Index"], means["opponent_Garbage Effi."],
    ])
    denominator = np.maximum(np.abs(self_raw), np.abs(opp_raw))
    denominator[denominator == 0] = 1.0

    charts = PROJECT_ROOT / "charts"
    draw_radar(
        capability_labels,
        self_raw / denominator,
        opp_raw / denominator,
        charts / "03_capability_radar.png",
        "能力レーダー",
        "各軸＝自分と相手平均の大きい方を1.0として正規化",
        1.05,
        [0.2, 0.4, 0.6, 0.8, 1.0],
    )

    self_style = np.array([
        means["Opener"], means["Stride"], means["Inf DS"], means["Plonk"]
    ])
    opp_style = np.array([
        means["opponent_Opener"], means["opponent_Stride"],
        means["opponent_Inf DS"], means["opponent_Plonk"]
    ])
    style_max = max(0.8, float(np.nanmax(np.r_[self_style, opp_style])) * 1.12)
    draw_radar(
        ["Opener", "Stride", "Inf DS", "Plonk"],
        self_style,
        opp_style,
        charts / "04_playstyle_radar.png",
        "4プレイスタイル",
        "",
        style_max,
        list(np.arange(0.1, style_max + 1e-9, 0.1)),
    )
    print("Regenerated:")
    print(charts / "03_capability_radar.png")
    print(charts / "04_playstyle_radar.png")


if __name__ == "__main__":
    main()
