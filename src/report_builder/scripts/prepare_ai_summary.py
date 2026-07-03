#!/usr/bin/env python3
"""Write the single AI report input JSON.

AI chat and AI agent CLI flows both use cache/ai/ai_appendix_data.json.
Reasoning level options are accepted only for CLI compatibility; they do not
change this JSON.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REASONING_LEVEL_CHOICES = ("standard", "high", "low", "high_quality", "low_cost")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--payload",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai_analysis_payload.json",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=PROJECT_ROOT / "cache" / "chapter_index.json",
        help="Compatibility argument. Not used for the single JSON output.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai",
    )
    parser.add_argument(
        "--reasoning-level",
        choices=("standard", "high", "low"),
        help="Compatibility argument. Output JSON is always ai_appendix_data.json.",
    )
    parser.add_argument(
        "--quality",
        dest="reasoning_level",
        choices=REASONING_LEVEL_CHOICES,
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    if not args.payload.is_file():
        raise SystemExit(f"Payload not found: {args.payload}")

    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = PROJECT_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    for stale_name in [f"summary_{suffix}.json" for suffix in ("standard", "rich", "compact")]:
        stale_path = out_dir / stale_name
        if stale_path.exists():
            stale_path.unlink()
            print(f"Removed deprecated: {stale_path}")

    out_path = out_dir / "ai_appendix_data.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Created: {out_path} ({out_path.stat().st_size:,} bytes)")
    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
