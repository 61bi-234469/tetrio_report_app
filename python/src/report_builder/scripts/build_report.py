#!/usr/bin/env python3
"""Jinja2テンプレートからTETR.IOレポートを生成する。"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
from typing import Callable

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {path}: {exc}") from exc


def make_chart_uri(embed: bool, output_path: Path) -> Callable[[str], str]:
    charts_dir = PROJECT_ROOT / "charts"

    def chart_uri(filename: str) -> str:
        chart_path = charts_dir / filename
        if not chart_path.is_file():
            raise FileNotFoundError(f"Chart not found: {chart_path}")
        if embed:
            encoded = base64.b64encode(chart_path.read_bytes()).decode("ascii")
            return f"data:image/png;base64,{encoded}"
        return Path("../charts", filename).as_posix()

    return chart_uri


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        help="出力HTML。省略時はcache/report_data.jsonのoutput_filenameを使用。",
    )
    parser.add_argument(
        "--external-images",
        action="store_true",
        help="Base64埋め込みを行わず、charts/への相対パスを使う。",
    )
    args = parser.parse_args()

    report = load_json(PROJECT_ROOT / "cache" / "report_data.json")
    output_path = args.output or (PROJECT_ROOT / "output" / report["output_filename"])
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    env = Environment(
        loader=FileSystemLoader(PROJECT_ROOT),
        autoescape=select_autoescape(["html", "xml"]),
        undefined=StrictUndefined,
        keep_trailing_newline=True,
    )
    env.globals["chart_uri"] = make_chart_uri(
        embed=not args.external_images,
        output_path=output_path,
    )

    template = env.get_template("template/base.html")
    rendered = template.render(report=report)

    unresolved = [token for token in ("{{", "{%") if token in rendered]
    if unresolved:
        raise SystemExit(f"Unresolved Jinja token(s): {unresolved}")

    output_path.write_text(rendered, encoding="utf-8")
    print(f"Built: {output_path}")
    print(f"Size : {output_path.stat().st_size:,} bytes")
    print(f"Mode : {'external images' if args.external_images else 'self-contained Base64'}")


if __name__ == "__main__":
    main()
