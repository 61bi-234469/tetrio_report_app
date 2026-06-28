#!/usr/bin/env python3
"""新CSVを集計し、軽量JSON・月別CSV・PR JSONを生成する。"""
from __future__ import annotations
import argparse
from pathlib import Path
from report_analysis import DEFAULT_SESSION_GAP_MINUTES, analyze_csv, write_analysis_outputs

PROJECT_ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("csv", type=Path)
    p.add_argument("--player", default="your_username")
    p.add_argument("--session-gap", type=int, default=DEFAULT_SESSION_GAP_MINUTES)
    p.add_argument("--window", type=int, default=300)
    p.add_argument("--cache-dir", type=Path, default=PROJECT_ROOT / "cache")
    args = p.parse_args()
    bundle = analyze_csv(args.csv, args.player, args.session_gap, args.window)
    write_analysis_outputs(bundle, args.cache_dir)
    print(f"分析完了: {args.csv}")
    print(f"試合: {bundle.summary['meta']['matches']:,} / ラウンド: {bundle.summary['meta']['rounds']:,}")
    print(f"AI用ペイロード: {args.cache_dir / 'ai_analysis_payload.json'}")

if __name__ == "__main__":
    main()
