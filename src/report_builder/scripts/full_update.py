#!/usr/bin/env python3
"""新CSVから集計・グラフ・本文・付録・自己完結HTMLを一括生成する。"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MPLCONFIGDIR", str(PROJECT_ROOT / "cache" / "matplotlib"))

from charts import generate_all_charts
from input_normalizer import normalize_to_round_csv
from render_report import render_all
from report_analysis import analyze_csv, apply_opponent_display, file_sha256, write_analysis_outputs

EXPECTED_CHARTS = [
    "01_tr_history.png", "02_metric_distributions.png", "03_capability_radar.png",
    "04_playstyle_radar.png", "20_playstyle_trend.png", "05_monthly_normalized_trends.png",
    "06_stability_windows.png", "08_relative_effect_sizes.png", "09_delta_vs_winrate.png",
    "09_delta_pps_winrate.png", "09_delta_apm_winrate.png", "09_delta_area_winrate.png",
    "10_apm_vs_dominance_scatter.png", "11_pps_vs_dominance_scatter.png",
    "12_tr_gap_expected_vs_actual.png", "13_tr_drawdown.png",
    "14_streak_distribution.png", "15_tiebreak_analysis.png",
    "28_comeback.png",
    "16_session_position.png", "29_session_decay.png", "17_round_duration.png",
    "18_score_state_next_round.png", "19_duration_metric_deltas.png",
    "20_excess_weekday.png", "21_excess_hour.png",
    "25_style_matchup_plane.png", "27_rivals.png",
]

CACHE_DEPENDENCIES = [
    PROJECT_ROOT / "scripts" / "full_update.py",
    PROJECT_ROOT / "scripts" / "charts.py",
    PROJECT_ROOT / "scripts" / "report_analysis.py",
    PROJECT_ROOT / "scripts" / "render_report.py",
    PROJECT_ROOT / "scripts" / "input_normalizer.py",
    PROJECT_ROOT / "scripts" / "build_report.py",
    PROJECT_ROOT / "template" / "base.html",
    PROJECT_ROOT / "template" / "report.css",
]


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def combined_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path).encode("utf-8"))
        digest.update(file_sha256(path).encode("ascii"))
    return digest.hexdigest()


def existing_paths(paths: list[Path]) -> list[Path]:
    return [path for path in paths if path.is_file()]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("data_file", type=Path, help="rounds parquet or round CSV")
    p.add_argument("--matches", type=Path, help="optional matches parquet/csv for metadata fill")
    p.add_argument("--player", default="your_username")
    p.add_argument("--session-gap", type=int, default=10)
    p.add_argument("--window", type=int, default=300)
    p.add_argument("--force", action="store_true", help="同じCSVでも再分析する")
    p.add_argument("--external-images", action="store_true", help="確認用HTMLは画像を外部参照にする")
    p.add_argument("--show-opponent-names", action="store_true", help="ライバル章で対戦相手の実名を表示する（既定は匿名ラベル）")
    args = p.parse_args()

    cache_dir = PROJECT_ROOT / "cache"
    charts_dir = PROJECT_ROOT / "charts"
    output_dir = PROJECT_ROOT / "output"
    cache_dir.mkdir(exist_ok=True)
    charts_dir.mkdir(exist_ok=True)
    output_dir.mkdir(exist_ok=True)

    data_path = args.data_file.resolve()
    if not data_path.is_file():
        raise SystemExit(f"Input not found: {data_path}")

    if data_path.suffix.lower() == ".csv" and args.matches is None:
        csv_path = data_path
    else:
        csv_path = normalize_to_round_csv(
            data_path,
            cache_dir / "normalized_rounds.csv",
            matches_file=args.matches,
        )

    source_paths = [data_path]
    if args.matches is not None:
        source_paths.append(args.matches.resolve())
    source_hash = combined_sha256(source_paths)
    pipeline_paths = existing_paths(CACHE_DEPENDENCIES)
    pipeline_hash = combined_sha256(pipeline_paths)
    state_path = cache_dir / "analysis_manifest.json"
    state = read_json(state_path)
    chart_ok = all((charts_dir / x).is_file() for x in EXPECTED_CHARTS)
    report_data = read_json(cache_dir / "report_data.json")
    output_ok = bool(report_data.get("output_filename")) and (output_dir / report_data["output_filename"]).is_file()

    if (
        not args.force
        and state.get("source_sha256") == source_hash
        and state.get("pipeline_sha256") == pipeline_hash
        and state.get("session_gap_minutes") == args.session_gap
        and state.get("window") == args.window
        and state.get("show_opponent_names") == args.show_opponent_names
        and chart_ok
        and output_ok
    ):
        print(f"CACHE HIT: 入力データ・{len(EXPECTED_CHARTS)}グラフ・完成HTMLが一致しています。再分析を省略します。")
        print(output_dir / report_data["output_filename"])
        return

    print("1/5 parquet/CSV正規化・集計...")
    bundle = analyze_csv(csv_path, args.player, args.session_gap, args.window)
    bundle.summary["source"].update({
        "filename": data_path.name,
        "input": str(data_path),
        "matches": str(args.matches.resolve()) if args.matches is not None else None,
        "normalized_csv": str(csv_path),
        "sha256": source_hash,
    })
    apply_opponent_display(bundle.summary, show_names=args.show_opponent_names)
    write_analysis_outputs(bundle, cache_dir)

    print(f"2/5 {len(EXPECTED_CHARTS)}グラフ生成...")
    generate_all_charts(bundle, charts_dir)

    print("3/5 12章・付録・KPI生成...")
    render_all(bundle, PROJECT_ROOT, args.player)

    print("4/5 自己完結HTML生成...")
    report_data = read_json(cache_dir / "report_data.json")
    output_path = output_dir / report_data["output_filename"]
    cmd = [sys.executable, str(PROJECT_ROOT / "scripts" / "build_report.py"), "--output", str(output_path)]
    if args.external_images:
        cmd.append("--external-images")
    proc = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if proc.returncode:
        raise SystemExit(proc.stdout + "\n" + proc.stderr)
    print(proc.stdout.strip())

    print("5/5 検証・キャッシュ保存...")
    missing = [x for x in EXPECTED_CHARTS if not (charts_dir / x).is_file()]
    html = output_path.read_text(encoding="utf-8")
    validation = {
        "source_input": str(data_path),
        "source_matches": str(args.matches.resolve()) if args.matches is not None else None,
        "normalized_csv": str(csv_path),
        "source_sha256": source_hash,
        "pipeline_sha256": pipeline_hash,
        "pipeline_files": [str(path) for path in pipeline_paths],
        "session_gap_minutes": args.session_gap,
        "window": args.window,
        "show_opponent_names": args.show_opponent_names,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "matches": bundle.summary["meta"]["matches"],
        "rounds": bundle.summary["meta"]["rounds"],
        "chart_count": len(EXPECTED_CHARTS) - len(missing),
        "missing_charts": missing,
        "embedded_images": html.count("data:image/png;base64,"),
        "chapter_count": html.count('class="chap"'),
        "appendix_count": html.count('id="appendix-'),
        "unresolved_jinja": any(token in html for token in ["{{", "{%"]),
        "output_html": str(output_path),
        "output_bytes": output_path.stat().st_size,
        "ai_payload_bytes": (cache_dir / "ai_analysis_payload.json").stat().st_size,
    }
    state_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    if missing or validation["chapter_count"] != 12 or validation["appendix_count"] != 3 or validation["unresolved_jinja"]:
        raise SystemExit(f"Validation failed: {json.dumps(validation, ensure_ascii=False)}")
    if not args.external_images and validation["embedded_images"] != len(EXPECTED_CHARTS):
        raise SystemExit(f"Expected {len(EXPECTED_CHARTS)} embedded images, got {validation['embedded_images']}")

    print("更新完了")
    print(f"HTML: {output_path}")
    print(f"AI用軽量JSON: {cache_dir / 'ai_analysis_payload.json'}")
    print(f"月別集計: {cache_dir / 'monthly_summary.csv'}")
    print(f"PR: {cache_dir / 'records.json'}")


if __name__ == "__main__":
    main()
