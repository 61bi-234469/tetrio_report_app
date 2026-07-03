#!/usr/bin/env python3
"""入力ファイルのハッシュとキャッシュの整合性を確認する。"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="確認するCSV/JSON")
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input not found: {args.input}")

    manifest = json.loads(
        (PROJECT_ROOT / "cache" / "manifest.json").read_text(encoding="utf-8")
    )
    cached = manifest.get("source_data", {}).get("sha256")
    current = sha256_file(args.input)

    print(f"input : {args.input}")
    print(f"hash  : {current}")
    print(f"cache : {cached or '(not recorded)'}")
    if cached == current:
        print("status: CACHE HIT — 集計・グラフ・文章を再利用できます。")
    else:
        print("status: CACHE MISS — データ集計から更新が必要です。")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
