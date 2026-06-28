#!/usr/bin/env python3
"""AI等で作成した章HTMLを、対象章だけ安全に差し替える。"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("chapter", type=int, choices=range(1, 13))
    parser.add_argument("input", type=Path)
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input not found: {args.input}")

    index = json.loads(
        (PROJECT_ROOT / "cache" / "chapter_index.json").read_text(encoding="utf-8")
    )
    entry = next(x for x in index if x["number"] == args.chapter)
    target = PROJECT_ROOT / entry["file"]

    new_html = args.input.read_text(encoding="utf-8")
    soup = BeautifulSoup(new_html, "html.parser")
    first_h2 = soup.find("h2")
    expected_id = entry["id"]
    if first_h2 is None or first_h2.get("id") != expected_id:
        raise SystemExit(
            f"Chapter validation failed: first h2 id must be {expected_id!r}"
        )

    backup_dir = PROJECT_ROOT / "cache" / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(target, backup_dir / f"{target.stem}_{stamp}.html")
    target.write_text(new_html.rstrip() + "\n", encoding="utf-8")
    print(f"Updated: {target}")
    print(f"Backup : {backup_dir}")


if __name__ == "__main__":
    main()
