#!/usr/bin/env python3
"""AI出力の本文JSONを report_text_schema.json に対して検証する。

責務はスキーマ検証だけに限定する。レンダリングや章HTML生成は行わない。
外部依存を避けるため、必要な範囲の検証を手書きで行う。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def validate(data: object, schema: dict) -> list[str]:
    errors: list[str] = []

    if not isinstance(data, dict):
        return ["ルートはオブジェクトである必要があります。"]

    required = schema.get("required", [])
    properties = schema.get("properties", {})
    allow_additional = schema.get("additionalProperties", True)

    for chapter_id in required:
        if chapter_id not in data:
            errors.append(f"章 {chapter_id} がありません。")

    if allow_additional is False:
        for key in data:
            if key not in properties:
                errors.append(f"未知の章キー: {key}")

    for chapter_id, chapter in data.items():
        chapter_schema = properties.get(chapter_id)
        if chapter_schema is None:
            continue
        errors.extend(_validate_chapter(chapter_id, chapter, chapter_schema))

    return errors


def _validate_chapter(chapter_id: str, chapter: object, schema: dict) -> list[str]:
    errors: list[str] = []
    prefix = f"[{chapter_id}]"

    if not isinstance(chapter, dict):
        return [f"{prefix} オブジェクトである必要があります。"]

    errors.extend(_validate_object(prefix, chapter, schema))
    return errors


def _validate_object(prefix: str, value: dict, schema: dict) -> list[str]:
    errors: list[str] = []
    props = schema.get("properties", {})
    required = schema.get("required", [])
    allow_additional = schema.get("additionalProperties", True)

    for field in required:
        if field not in value:
            errors.append(f"{prefix} 必須フィールド {field} がありません。")

    if allow_additional is False:
        for key in value:
            if key not in props:
                errors.append(f"{prefix} 未知のフィールド: {key}")

    for field, spec in props.items():
        if field not in value:
            continue
        errors.extend(_validate_value(f"{prefix}.{field}", value[field], spec))

    return errors


def _validate_value(path: str, value: object, spec: dict) -> list[str]:
    errors: list[str] = []
    expected = spec.get("type")
    if expected == "string":
        if not isinstance(value, str):
            return [f"{path} は文字列である必要があります。"]
        if len(value) < spec.get("minLength", 0):
            errors.append(f"{path} が空です。")
        max_len = spec.get("maxLength")
        if max_len is not None and len(value) > max_len:
            errors.append(f"{path} が長すぎます（{len(value)} > {max_len}）。")
    elif expected == "array":
        if not isinstance(value, list):
            return [f"{path} は配列である必要があります。"]
        min_items = spec.get("minItems")
        if min_items is not None and len(value) < min_items:
            errors.append(f"{path} の項目数が少なすぎます（{len(value)} < {min_items}）。")
        max_items = spec.get("maxItems")
        if max_items is not None and len(value) > max_items:
            errors.append(f"{path} の項目数が多すぎます（{len(value)} > {max_items}）。")
        item_spec = spec.get("items", {})
        for idx, item in enumerate(value):
            errors.extend(_validate_value(f"{path}[{idx}]", item, item_spec))
    elif expected == "object":
        if not isinstance(value, dict):
            return [f"{path} はオブジェクトである必要があります。"]
        errors.extend(_validate_object(path, value, spec))
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai" / "report_text.json",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai" / "report_text_schema.json",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"本文JSONが見つかりません: {args.input}")
    if not args.schema.is_file():
        raise SystemExit(f"スキーマが見つかりません: {args.schema}")

    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"本文JSONが不正です: {exc}") from exc

    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    errors = validate(data, schema)

    if errors:
        print("検証に失敗しました:")
        for err in errors:
            print(f"  - {err}")
        raise SystemExit(1)

    print(f"OK: {args.input} はスキーマ検証を通りました。")


if __name__ == "__main__":
    main()
