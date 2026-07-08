#!/usr/bin/env python3
"""検証済みの②AI考察レポート本文JSONを固定HTMLへレンダリングする。"""

from __future__ import annotations

import argparse
import json
import re
from html import unescape
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def text_or_dash(value: object) -> str:
    if value is None:
        return "-"
    text = str(value).strip()
    return text if text else "-"


def plain_text(html: str) -> str:
    text = re.sub(r"<br\s*/?>", " / ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def player_from_report(report_data: dict) -> str:
    title = str(report_data.get("title", ""))
    if "—" in title:
        return text_or_dash(title.rsplit("—", 1)[1])
    subtitle = plain_text(str(report_data.get("subtitle_html", "")))
    match = re.search(r"対象プレイヤー[:：]\s*([^/／\s]+)", subtitle)
    return text_or_dash(match.group(1) if match else "")


def period_from_report(report_data: dict) -> str:
    subtitle = plain_text(str(report_data.get("subtitle_html", "")))
    match = re.search(r"対象期間[:：]\s*([^/／]+)", subtitle)
    return text_or_dash(match.group(1).strip() if match else "")


def normalize_regular(section: dict) -> dict:
    return {
        "key": text_or_dash(section.get("key")),
        "bullets": [str(item) for item in section.get("bullets", []) if str(item).strip()],
        "summary": text_or_dash(section.get("summary")),
    }


def normalize_replays(section: dict) -> dict:
    rows = []
    for row in section.get("rows", []):
        if not isinstance(row, dict):
            continue
        condition = text_or_dash(row.get("condition"))
        viewpoint = text_or_dash(row.get("viewpoint"))
        if condition == "-" and viewpoint == "-":
            continue
        rows.append(
            {
                "priority": text_or_dash(row.get("priority")),
                "condition": condition,
                "viewpoint": viewpoint,
            }
        )
    if not rows:
        rows.append({"priority": "-", "condition": "-", "viewpoint": "-"})
    return {
        "key": text_or_dash(section.get("key")),
        "rows": rows,
        "summary": text_or_dash(section.get("summary")),
    }


def build_context(text: dict, report_data: dict) -> dict:
    meta = text.get("_meta", {}) if isinstance(text.get("_meta"), dict) else {}
    return {
        "ai_model": text_or_dash(meta.get("ai_model")),
        "player_name": text_or_dash(meta.get("player_name") or player_from_report(report_data)),
        "source_period": text_or_dash(meta.get("source_period") or period_from_report(report_data)),
        "generated_date": text_or_dash(
            meta.get("generated_date") or report_data.get("generated_date")
        ),
        "overview": normalize_regular(text.get("overview", {})),
        "growth_stability": normalize_regular(text.get("growth_stability", {})),
        "capability": normalize_regular(text.get("capability", {})),
        "win_factors": normalize_regular(text.get("win_factors", {})),
        "style_matchup": normalize_regular(text.get("style_matchup", {})),
        "opponent_expectation": normalize_regular(text.get("opponent_expectation", {})),
        "rivals": normalize_regular(text.get("rivals", {})),
        "clutch": normalize_regular(text.get("clutch", {})),
        "comeback": normalize_regular(text.get("comeback", {})),
        "round_time": normalize_regular(text.get("round_time", {})),
        "session_flow": normalize_regular(text.get("session_flow", {})),
        "replays": normalize_replays(text.get("replays", {})),
        "summary": {
            "key": text_or_dash(text.get("summary", {}).get("key")),
            "body": text_or_dash(text.get("summary", {}).get("body")),
        },
        "method": {
            "key": text_or_dash(text.get("method", {}).get("key")),
            "bullets": [
                str(item) for item in text.get("method", {}).get("bullets", []) if str(item).strip()
            ],
        },
        "evidence": {"body": text_or_dash(text.get("evidence", {}).get("body"))},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai" / "report_text.json",
    )
    parser.add_argument(
        "--report-data",
        type=Path,
        default=PROJECT_ROOT / "cache" / "report_data.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="出力HTML。省略時は output/<元ファイル名>_ai_report.html。",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"本文JSONが見つかりません: {args.input}")

    text = json.loads(args.input.read_text(encoding="utf-8"))
    report_data = {}
    if args.report_data.is_file():
        report_data = json.loads(args.report_data.read_text(encoding="utf-8"))

    output_path = args.output
    if output_path is None:
        base = report_data.get("output_filename", "tetrio_report.html")
        stem = Path(base).stem
        output_path = PROJECT_ROOT / "output" / f"{stem}_ai_report.html"
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    env = Environment(
        loader=FileSystemLoader(PROJECT_ROOT),
        autoescape=select_autoescape(["html", "xml"]),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
    template = env.get_template("template/ai_sections/ai_report.html")
    rendered = template.render(**build_context(text, report_data))

    unresolved = [token for token in ("{{", "{%") if token in rendered]
    if unresolved:
        raise SystemExit(f"Unresolved Jinja token(s): {unresolved}")

    output_path.write_text(rendered, encoding="utf-8")
    print(f"Built: {output_path}")
    print(f"Size : {output_path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
