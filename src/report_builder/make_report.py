#!/usr/bin/env python3
"""Python entry point for building a TETR.IO HTML report."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
APP_ROOT = PROJECT_ROOT.parents[1]


def latest_input(input_dir: Path) -> Path:
    candidates = [
        path
        for pattern in ("*.parquet", "*.pq", "*.csv")
        for path in input_dir.glob(pattern)
        if path.is_file()
    ]
    if not candidates:
        raise SystemExit(f"No parquet/csv input found in {input_dir}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def infer_matches_path(rounds_path: Path) -> Path | None:
    name = rounds_path.name
    candidates = []
    for old, new in [
        ("rounds_with_params", "matches_with_params"),
        ("tetra_league_rounds", "tetra_league_matches"),
        ("rounds", "matches"),
    ]:
        if old in name:
            candidates.append(rounds_path.with_name(name.replace(old, new, 1)))
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def resolve_existing_file(path: Path, description: str) -> Path:
    if path.is_absolute():
        candidates = [path]
    else:
        candidates = [
            Path.cwd() / path,
            APP_ROOT / path,
            PROJECT_ROOT / path,
            PROJECT_ROOT / "input" / path,
        ]

    seen: set[Path] = set()
    checked_candidates: list[Path] = []
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen:
            continue
        seen.add(candidate)
        checked_candidates.append(candidate)
        if candidate.is_file():
            return candidate

    checked = "\n".join(f" - {candidate}" for candidate in checked_candidates)
    raise SystemExit(f"{description} not found: {path}\nChecked:\n{checked}")


def run_checked(args: list[str]) -> None:
    proc = subprocess.run(args, cwd=PROJECT_ROOT, text=True)
    if proc.returncode:
        raise SystemExit(proc.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-i", "--input", dest="data_file", type=Path, help="rounds parquet/csv")
    parser.add_argument("-m", "--matches", type=Path, help="optional matches parquet/csv")
    parser.add_argument("--player", default="your_username")
    parser.add_argument("--session-gap", type=int, default=10)
    parser.add_argument("--window", type=int, default=300)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--external-images", action="store_true")
    parser.add_argument("--prepare-ai", action="store_true")
    parser.add_argument("--chapter", type=int, nargs="*", choices=range(1, 13))
    args = parser.parse_args()

    data_file = (
        resolve_existing_file(args.data_file, "Input")
        if args.data_file
        else latest_input(PROJECT_ROOT / "input")
    )

    matches_file = (
        resolve_existing_file(args.matches, "Matches")
        if args.matches
        else infer_matches_path(data_file)
    )

    update_args = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "full_update.py"),
        str(data_file),
        "--player",
        args.player,
        "--session-gap",
        str(args.session_gap),
        "--window",
        str(args.window),
    ]
    if matches_file is not None:
        update_args += ["--matches", str(matches_file)]
    if args.force:
        update_args.append("--force")
    if args.external_images:
        update_args.append("--external-images")

    print(f"Input: {data_file}")
    if matches_file is not None:
        print(f"Matches: {matches_file}")
    run_checked(update_args)

    cache_dir = PROJECT_ROOT / "cache"
    output_dir = PROJECT_ROOT / "output"
    report_data = json.loads((cache_dir / "report_data.json").read_text(encoding="utf-8"))
    report_path = output_dir / report_data["output_filename"]

    if args.prepare_ai:
        if args.chapter:
            label = "_".join(str(chapter) for chapter in sorted(set(args.chapter)))
            payload_path = output_dir / f"ai_payload_chapter_{label}.json"
            payload_args = [
                sys.executable,
                str(PROJECT_ROOT / "scripts" / "prepare_ai_payload.py"),
                "--chapters",
                *[str(chapter) for chapter in sorted(set(args.chapter))],
                "--output",
                str(payload_path),
            ]
            run_checked(payload_args)
        else:
            payload_path = output_dir / "ai_payload.json"
            shutil.copy2(cache_dir / "ai_analysis_payload.json", payload_path)
        print(f"AI payload: {payload_path}")

    print(f"HTML: {report_path}")


if __name__ == "__main__":
    main()
