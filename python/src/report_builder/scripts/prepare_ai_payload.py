#!/usr/bin/env python3
"""必要な章だけを画像・CSSなしの軽量JSONとして書き出す。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def clean_chapter_html(html: str) -> dict:
    # Jinjaのchart_uri式を、BeautifulSoupで扱える仮文字列へ置換する。
    chart_pattern = re.compile(
        r"""\{\{\s*chart_uri\(["']([^"']+)["']\)\s*\}\}"""
    )
    chart_names = chart_pattern.findall(html)
    safe_html = chart_pattern.sub(
        lambda m: f"CHART_FILE_{m.group(1)}",
        html,
    )
    soup = BeautifulSoup(safe_html, "html.parser")

    for img in soup.find_all("img"):
        src = img.get("src", "")
        img.replace_with(f"\n[CHART: {src.replace('CHART_FILE_', '')}]\n")

    title = soup.find(["h2", "h3"])
    return {
        "title": title.get_text(" ", strip=True) if title else "",
        "chart_files": chart_names,
        "plain_text": soup.get_text("\n", strip=True),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chapters",
        nargs="*",
        type=int,
        help="章番号。省略時は全章。",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai_payload.json",
    )
    parser.add_argument(
        "--include-html",
        action="store_true",
        help="章HTMLも含める。通常はトークン節約のため不要。",
    )
    args = parser.parse_args()

    report = json.loads(
        (PROJECT_ROOT / "cache" / "report_data.json").read_text(encoding="utf-8")
    )
    index = json.loads(
        (PROJECT_ROOT / "cache" / "chapter_index.json").read_text(encoding="utf-8")
    )

    available = {entry["number"] for entry in index}
    selected = set(args.chapters or available)
    missing = sorted(selected - available)
    if missing:
        available_label = ", ".join(str(x) for x in sorted(available))
        missing_label = ", ".join(str(x) for x in missing)
        raise SystemExit(
            f"Unknown or inactive chapter(s): {missing_label}. "
            f"Available chapters: {available_label}"
        )
    payload = {
        "report": {
            "title": report["title"],
            "heading": report["heading"],
            "subtitle_text": BeautifulSoup(
                report["subtitle_html"], "html.parser"
            ).get_text(" ", strip=True),
            "kpis": report["kpis"],
        },
        "chapters": [],
    }

    for entry in index:
        if entry["number"] not in selected:
            continue
        path = PROJECT_ROOT / entry["file"]
        html = path.read_text(encoding="utf-8")
        cleaned = clean_chapter_html(html)
        item = {**entry, **cleaned}
        if args.include_html:
            item["html"] = html
        payload["chapters"].append(item)

    output = args.output
    if not output.is_absolute():
        output = PROJECT_ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Created: {output}")
    print(f"Size   : {output.stat().st_size:,} bytes")
    print(f"Chapters: {', '.join(str(x) for x in sorted(selected))}")


if __name__ == "__main__":
    main()
