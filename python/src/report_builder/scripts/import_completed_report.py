#!/usr/bin/env python3
"""同じ構成の完成済み自己完結HTMLを、テンプレート資産へ再分解する。"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup, Tag


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    args = parser.parse_args()

    if not args.html.is_file():
        raise SystemExit(f"HTML not found: {args.html}")

    backup_root = PROJECT_ROOT / "cache" / "import_backups" / datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_root.mkdir(parents=True)
    for relative in ["template/report.css", "content", "charts", "cache/generated", "cache/report_data.json"]:
        source = PROJECT_ROOT / relative
        if source.exists():
            destination = backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copy2(source, destination)

    soup = BeautifulSoup(args.html.read_text(encoding="utf-8"), "html.parser")
    style = soup.find("style")
    if not style:
        raise SystemExit("style tag not found")
    (PROJECT_ROOT / "template" / "report.css").write_text(
        style.get_text().strip() + "\n", encoding="utf-8"
    )

    manifest = json.loads(
        (PROJECT_ROOT / "cache" / "manifest.json").read_text(encoding="utf-8")
    )
    chart_names = [x["filename"] for x in manifest["charts"]]
    images = soup.find_all("img")
    if len(images) != len(chart_names):
        raise SystemExit(
            f"Chart count differs: expected {len(chart_names)}, got {len(images)}. "
            "新しいグラフを追加した場合はmanifestのchart一覧も更新してください。"
        )

    for img, filename in zip(images, chart_names):
        src = img.get("src", "")
        match = re.fullmatch(r"data:image/[^;]+;base64,(.+)", src, re.S)
        if not match:
            raise SystemExit(f"Embedded Base64 image required: {filename}")
        (PROJECT_ROOT / "charts" / filename).write_bytes(
            base64.b64decode(match.group(1))
        )
        img["src"] = '{{ chart_uri("' + filename + '") }}'

    wrap = soup.select_one("div.wrap")
    direct = [x for x in wrap.children if isinstance(x, Tag)]
    header, kpis, note, toc = direct[:4]

    report = json.loads(
        (PROJECT_ROOT / "cache" / "report_data.json").read_text(encoding="utf-8")
    )
    report.update({
        "title": soup.title.get_text(strip=True),
        "heading": header.find("h1").get_text(" ", strip=True),
        "subtitle_html": "".join(str(x) for x in header.select_one(".sub").contents),
        "kpis": [
            {
                "label": k.select_one(".lab").get_text(" ", strip=True),
                "value": k.select_one(".val").get_text(" ", strip=True),
                "note": k.select_one(".note").get_text(" ", strip=True),
            }
            for k in kpis.select(".kpi")
        ],
        "note_box_html": "".join(str(x) for x in note.contents),
        "toc_html": "".join(str(x) for x in toc.contents),
    })
    (PROJECT_ROOT / "cache" / "report_data.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    index = json.loads(
        (PROJECT_ROOT / "cache" / "chapter_index.json").read_text(encoding="utf-8")
    )
    for entry in index:
        h2 = wrap.find("h2", id=entry["id"])
        if h2 is None:
            raise SystemExit(f"Chapter not found: {entry['id']}")
        tags = [h2]
        node = h2.find_next_sibling()
        while node and not (
            node.name == "h2" and "chap" in (node.get("class") or [])
        ) and node.name not in ("details", "footer"):
            tags.append(node)
            node = node.find_next_sibling()
        (PROJECT_ROOT / entry["file"]).write_text(
            "\n".join(str(x) for x in tags) + "\n", encoding="utf-8"
        )

    appendices = wrap.find_all("details", recursive=False)
    appendices_path = PROJECT_ROOT / "cache/generated/appendices.html"
    appendices_path.parent.mkdir(parents=True, exist_ok=True)
    appendices_path.write_text("\n".join(str(x) for x in appendices) + "\n", encoding="utf-8")
    footer = wrap.find("footer", recursive=False)
    (PROJECT_ROOT / "content/partials/footer.html").write_text(
        (str(footer) + "\n") if footer else "", encoding="utf-8"
    )
    print(f"Imported: {args.html}")
    print(f"Backup  : {backup_root}")


if __name__ == "__main__":
    main()
