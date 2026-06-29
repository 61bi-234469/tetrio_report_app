#!/usr/bin/env python3
"""複数の入力ファイル間の概算トークン量と削減率を比較する。

旧来の --html / --payload の2入力比較に加え、--input で名前付き入力を複数登録し、
--pair で任意の比較ペアを指定できる。--preset は本設計の標準比較セットを
キャッシュから自動構成する。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# 文字/token の概算幅。Base64主体HTMLとテキスト/JSONで分ける。
RATIOS = {
    "html": (1.2, 2.0),
    "text": (1.5, 3.0),
}


def kind_for(path: Path, explicit: str | None) -> str:
    if explicit:
        return explicit
    return "html" if path.suffix.lower() in {".html", ".htm"} else "text"


def token_range(chars: int, kind: str) -> tuple[int, int]:
    low_ratio, high_ratio = RATIOS[kind]
    # chars/token が大きいほどトークン数は少ない。
    return round(chars / high_ratio), round(chars / low_ratio)


def measure(path: Path, kind: str) -> dict:
    chars = len(path.read_text(encoding="utf-8"))
    low, high = token_range(chars, kind)
    return {
        "path": str(path),
        "kind": kind,
        "chars": chars,
        "estimated_tokens": {"low": low, "high": high},
    }


def reduction(base: dict, compare: dict) -> dict:
    base_low = base["estimated_tokens"]["low"]
    base_high = base["estimated_tokens"]["high"]
    cmp_low = compare["estimated_tokens"]["low"]
    cmp_high = compare["estimated_tokens"]["high"]
    return {
        "conservative_percent": round((1 - cmp_high / base_low) * 100, 1),
        "optimistic_percent": round((1 - cmp_low / base_high) * 100, 1),
    }


def parse_input(token: str) -> tuple[str, Path, str | None]:
    # 形式: NAME=PATH または NAME=PATH:kind
    if "=" not in token:
        raise SystemExit(f"--input は NAME=PATH 形式で指定してください: {token}")
    name, rest = token.split("=", 1)
    explicit_kind = None
    # 末尾 :html / :text をkind指定として扱う（Windowsドライブの : と区別）。
    if rest.endswith(":html") or rest.endswith(":text"):
        rest, explicit_kind = rest.rsplit(":", 1)
    return name, Path(rest), explicit_kind


def resolve(path: Path) -> Path:
    return path if path.is_absolute() else PROJECT_ROOT / path


def preset_inputs() -> dict[str, tuple[Path, str | None]]:
    cache = PROJECT_ROOT / "cache"
    report = {}
    report_data_path = cache / "report_data.json"
    inputs: dict[str, tuple[Path, str | None]] = {}
    if report_data_path.is_file():
        report = json.loads(report_data_path.read_text(encoding="utf-8"))
        html_path = PROJECT_ROOT / "output" / report.get("output_filename", "")
        if html_path.is_file():
            inputs["completed_html"] = (html_path, "html")
    candidates = {
        "ai_payload": cache / "ai_analysis_payload.json",
        "summary_standard": cache / "ai" / "summary_standard.json",
        "summary_rich": cache / "ai" / "summary_rich.json",
        "summary_compact": cache / "ai" / "summary_compact.json",
        "report_text": cache / "ai" / "report_text.json",
    }
    for name, path in candidates.items():
        if path.is_file():
            inputs[name] = (path, None)
    return inputs


PRESET_PAIRS = [
    ("completed_html", "ai_payload"),
    ("ai_payload", "summary_standard"),
    ("summary_standard", "summary_rich"),
    ("ai_payload", "summary_compact"),
    ("completed_html", "report_text"),
]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", action="append", default=[], help="NAME=PATH[:html|:text]")
    p.add_argument("--pair", action="append", default=[], help="BASE:COMPARE")
    p.add_argument("--preset", action="store_true", help="標準比較セットを自動構成する。")
    # 旧来互換オプション。
    p.add_argument("--html", type=Path)
    p.add_argument("--payload", type=Path)
    p.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "cache" / "token_savings_estimate.json",
    )
    args = p.parse_args()

    measured: dict[str, dict] = {}
    pairs: list[tuple[str, str]] = []

    if args.preset:
        for name, (path, kind) in preset_inputs().items():
            measured[name] = measure(path, kind_for(path, kind))
        pairs = [(b, c) for b, c in PRESET_PAIRS if b in measured and c in measured]

    for token in args.input:
        name, path, kind = parse_input(token)
        path = resolve(path)
        measured[name] = measure(path, kind_for(path, kind))

    for token in args.pair:
        if ":" not in token:
            raise SystemExit(f"--pair は BASE:COMPARE 形式で指定してください: {token}")
        base, compare = token.split(":", 1)
        pairs.append((base, compare))

    # 入力も preset もない場合は旧来の html vs payload 比較に落とす。
    if not measured:
        html = args.html
        if html is None:
            report = json.loads(
                (PROJECT_ROOT / "cache" / "report_data.json").read_text(encoding="utf-8")
            )
            html = PROJECT_ROOT / "output" / report["output_filename"]
        payload = args.payload or (PROJECT_ROOT / "cache" / "ai_analysis_payload.json")
        measured["completed_html"] = measure(resolve(Path(html)), "html")
        measured["ai_payload"] = measure(resolve(Path(payload)), "text")
        pairs = [("completed_html", "ai_payload")]

    comparisons = []
    for base, compare in pairs:
        if base not in measured or compare not in measured:
            continue
        comparisons.append(
            {
                "base": base,
                "compare": compare,
                "reduction": reduction(measured[base], measured[compare]),
            }
        )

    result = {
        "inputs": measured,
        "comparisons": comparisons,
        "note": (
            "モデルのトークナイザーで変わる概算。reductionは base から compare への"
            "推定トークン削減率（負値は増加）。"
        ),
    }

    out = resolve(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
