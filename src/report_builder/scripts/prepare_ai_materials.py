#!/usr/bin/env python3
"""②AI考察レポート用の素材だけを軽量生成する。

通常の①HTML生成に必要なグラフ、章HTML、付録HTML、自己完結HTMLは作らない。
"""
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

from input_normalizer import normalize_to_round_csv
from render_report import render_chapter_index, render_report_data
from report_analysis import analyze_csv, file_sha256, write_analysis_outputs


CACHE_DEPENDENCIES = [
    PROJECT_ROOT / "scripts" / "prepare_ai_materials.py",
    PROJECT_ROOT / "scripts" / "report_analysis.py",
    PROJECT_ROOT / "scripts" / "render_report.py",
    PROJECT_ROOT / "scripts" / "input_normalizer.py",
    PROJECT_ROOT / "scripts" / "prepare_ai_summary.py",
    PROJECT_ROOT / "scripts" / "build_ai_prompt.py",
    PROJECT_ROOT / "prompts" / "prompt_recommendations.md",
]


def combined_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path).encode("utf-8"))
        digest.update(file_sha256(path).encode("ascii"))
    return digest.hexdigest()


def existing_paths(paths: list[Path]) -> list[Path]:
    return [path for path in paths if path.is_file()]


def run(cmd: list[str]) -> None:
    proc = subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if proc.stdout:
        print(proc.stdout.strip())
    if proc.returncode:
        if proc.stderr:
            print(proc.stderr.strip(), file=sys.stderr)
        raise SystemExit(proc.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_file", type=Path, help="rounds parquet or round CSV")
    parser.add_argument("--matches", type=Path, help="optional matches parquet/csv for metadata fill")
    parser.add_argument("--player", default="your_username")
    parser.add_argument("--session-gap", type=int, default=10)
    parser.add_argument("--window", type=int, default=300)
    parser.add_argument(
        "--reasoning-level",
        choices=["standard", "high", "low"],
        default="standard",
    )
    parser.add_argument(
        "--quality",
        dest="reasoning_level",
        choices=["standard", "high", "low", "high_quality", "low_cost"],
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()
    reasoning_level = {
        "high_quality": "high",
        "low_cost": "low",
    }.get(args.reasoning_level, args.reasoning_level)

    cache_dir = PROJECT_ROOT / "cache"
    ai_dir = cache_dir / "ai"
    cache_dir.mkdir(parents=True, exist_ok=True)
    ai_dir.mkdir(parents=True, exist_ok=True)

    data_path = args.data_file.resolve()
    if not data_path.is_file():
        raise SystemExit(f"Input not found: {data_path}")

    matches_path = args.matches.resolve() if args.matches is not None else None
    if matches_path is not None and not matches_path.is_file():
        raise SystemExit(f"Matches input not found: {matches_path}")

    print("1/4 parquet/CSV正規化・集計...")
    if data_path.suffix.lower() == ".csv" and matches_path is None:
        csv_path = data_path
    else:
        csv_path = normalize_to_round_csv(
            data_path,
            cache_dir / "normalized_rounds.csv",
            matches_file=matches_path,
        )

    source_paths = [data_path]
    if matches_path is not None:
        source_paths.append(matches_path)
    source_hash = combined_sha256(source_paths)

    bundle = analyze_csv(csv_path, args.player, args.session_gap, args.window)
    bundle.summary["source"].update({
        "filename": data_path.name,
        "input": str(data_path),
        "matches": str(matches_path) if matches_path is not None else None,
        "normalized_csv": str(csv_path),
        "sha256": source_hash,
    })
    write_analysis_outputs(bundle, cache_dir)

    print("2/4 レポート文脈データ生成...")
    render_report_data(bundle, PROJECT_ROOT, args.player)
    render_chapter_index(PROJECT_ROOT)

    print("3/4 AI用JSON生成...")
    run([
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "prepare_ai_summary.py"),
        "--reasoning-level",
        reasoning_level,
    ])

    print("4/4 プロンプト生成...")
    run([
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "build_ai_prompt.py"),
        "--reasoning-level",
        reasoning_level,
    ])

    pipeline_paths = existing_paths(CACHE_DEPENDENCIES)
    manifest = {
        "schema_version": 1,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_input": str(data_path),
        "source_matches": str(matches_path) if matches_path is not None else None,
        "normalized_csv": str(csv_path),
        "source_sha256": source_hash,
        "pipeline_sha256": combined_sha256(pipeline_paths),
        "pipeline_files": [str(path) for path in pipeline_paths],
        "player": args.player,
        "session_gap_minutes": args.session_gap,
        "window": args.window,
        "reasoning_level": reasoning_level,
        "matches": bundle.summary["meta"]["matches"],
        "rounds": bundle.summary["meta"]["rounds"],
    }
    manifest_path = cache_dir / "ai_materials_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("AI素材準備完了")
    print(f"素材: {ai_dir}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
