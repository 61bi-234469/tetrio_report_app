#!/usr/bin/env python3
"""ai_analysis_payload.json を品質別の章別サマリへ整形する薄い整形層。

役割は次の3点に限定する。

1. 指標ドメイン別の payload を、章対応表に基づき章別へ振り分ける
2. 品質に応じて数値を丸め、配列を制限してトークンを抑える
3. 本文化のための固定ヒントと、高品質時の生JSON参照フラグを足す

本文そのものは生成しない。本文と解釈はAI側の担当とする。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]

# 章 id -> ai_analysis_payload.json のトップキー対応表。
# 実物のトップキーは指標ドメイン別（kpis / metrics / ...）であり章別ではない。
# この対応表が本整形層の核となるため、ここで明示的に固定する。
CHAPTER_KEY_MAP: dict[str, list[str]] = {
    "c1": ["meta", "kpis", "tr_change", "records"],
    "c2": ["recent_windows", "growth", "stability", "growth_window_n", "drawdown"],
    "c3": ["metrics", "metrics_recent", "styles", "styles_recent", "model"],
    "c4": ["effect_sizes", "delta_vs_bins", "dominance"],
    "c5": ["tr_gap", "model", "recent_scope"],
    "c6": ["tiebreak", "score_states", "streaks"],
    "c7": ["duration_bins", "duration_by_result", "pps_bins"],
    "c8": [
        "streak_states",
        "session_positions",
        "session_dynamics",
        "excess_by_weekday",
        "excess_by_hour",
    ],
}

# 章別evidenceから落とす冗長・識別子フィールド（本文化に不要）。
# 出所情報や試合ID、対戦相手名などは考察本文には使わないため一律に除く。
DROP_FIELDS = {
    "sha256",
    "filename",
    "input",
    "rows",
    "source_rounds",
    "synthetic_rounds",
    "input_rounds",
    "match_id",
    "opponent",
    "note",
    "scope",
    "unit",
    "session_gap_basis",
    "peak_date",
    "max_drawdown_date",
}

# 章ごとの固定ヒント。本文の観点を揃えるためのもので、数値の断定はしない。
CHAPTER_HINTS: dict[str, list[str]] = {
    "c1": [
        "matches（試合数）と round_wins / round_losses（ラウンド数）は集計単位が違うため混同しない",
        "TRの増減は始点と終点だけでなく、ピークと最大ドローダウンも合わせて触れる",
    ],
    "c2": [
        "直近ウィンドウの推移は短期の上下より持続的な変化に注目する",
        "サンプル数が少ないウィンドウは断定しない",
    ],
    "c3": [
        "レーダーとスタイルは直近100試合の試合単位であることを保つ",
        "相手平均との差は形状と実数値の両方で触れる",
    ],
    "c4": [
        "効果量dは勝敗との関係の強さの目安であり因果ではない",
        "差が小さい指標は無理に結論づけない",
    ],
    "c5": [
        "期待値は対戦前Glicko/RDを使った標準Glicko期待スコアで評価している",
        "TR差の区分ごとに件数を確認し、少ない区分は参考値とする",
    ],
    "c6": [
        "接戦・決着局面はサンプルが偏りやすいので件数を明示する",
        "連勝・連敗の states はラウンド単位か試合単位かを保つ",
    ],
    "c7": [
        "試合時間とラウンド展開は区分（bin）ごとの件数を確認する",
        "PPS区分は速度の傾向であり勝敗の因果ではない",
    ],
    "c8": [
        "セッション内の試合位置は試合単位の集計であることを保つ",
        "曜日・時間帯の偏りはサンプル数が少ない区分を断定しない",
    ],
}

# 品質モードごとの整形パラメータ。トークン削減を主目的に、配列・桁を絞る。
QUALITY_PROFILES: dict[str, dict[str, Any]] = {
    "rich": {
        "float_decimals": 3,
        "list_limit": 12,
        "writing_hints": True,
        "raw_flags": True,
    },
    "standard": {
        "float_decimals": 2,
        "list_limit": 6,
        "writing_hints": True,
        "raw_flags": False,
    },
    "compact": {
        "float_decimals": 1,
        "list_limit": 3,
        "writing_hints": False,
        "raw_flags": False,
    },
}

# GUI/CLI の品質内部値 -> サマリ profile 名。
QUALITY_TO_PROFILE = {
    "standard": "standard",
    "high_quality": "rich",
    "low_cost": "compact",
    "legacy_appendix": "legacy",
}


def compact_value(value: Any, decimals: int, list_limit: int) -> Any:
    """数値を丸め、配列を制限して再帰的にトークンを抑える。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        rounded = round(value, decimals)
        # 0.0 のような末尾を避けるため整数化できれば整数にする。
        if rounded == int(rounded):
            return int(rounded)
        return rounded
    if isinstance(value, dict):
        return {
            key: compact_value(sub, decimals, list_limit)
            for key, sub in value.items()
            if key not in DROP_FIELDS
        }
    if isinstance(value, list):
        trimmed = value[:list_limit]
        result = [compact_value(item, decimals, list_limit) for item in trimmed]
        if len(value) > list_limit:
            result.append({"_truncated": len(value) - list_limit})
        return result
    return value


def find_low_sample(value: Any, threshold: int = 30) -> bool:
    """件数を表すフィールドが閾値未満なら True（生JSON参照の要否判定に使う）。"""
    sample_keys = {"n", "count", "matches", "rounds", "samples", "size"}
    if isinstance(value, dict):
        for key, sub in value.items():
            if (
                key in sample_keys
                and isinstance(sub, (int, float))
                and not isinstance(sub, bool)
                and 0 < sub < threshold
            ):
                return True
            if find_low_sample(sub, threshold):
                return True
    elif isinstance(value, list):
        return any(find_low_sample(item, threshold) for item in value)
    return False


def build_overall(payload: dict, decimals: int) -> dict:
    """章共通の最小ヘッダ。meta/kpis全体は複製せず、要点だけを抜き出す。"""
    meta = payload.get("meta", {})
    kpis = payload.get("kpis", {})

    def rnd(value: Any) -> Any:
        if isinstance(value, float):
            r = round(value, decimals)
            return int(r) if r == int(r) else r
        return value

    overall: dict[str, Any] = {}
    if meta:
        overall["player"] = meta.get("player")
        overall["period"] = {"start": meta.get("start"), "end": meta.get("end")}
        for key in ("matches", "rounds", "active_days", "opponents", "sessions"):
            if key in meta:
                overall[key] = meta[key]
        if "result_counts" in meta:
            overall["result_counts"] = meta["result_counts"]
    if kpis:
        for key in (
            "official_win_rate",
            "normal_win_rate",
            "first_tr",
            "current_tr",
            "tr_change",
            "peak_tr",
            "max_drawdown",
        ):
            if key in kpis:
                overall[key] = rnd(kpis[key])
    return {k: v for k, v in overall.items() if v is not None}


def build_summary(payload: dict, index: list[dict], profile: dict) -> dict:
    decimals = profile["float_decimals"]
    list_limit = profile["list_limit"]

    summary: dict[str, Any] = {
        "_meta": {
            "source": "cache/ai_analysis_payload.json",
            "schema_version": payload.get("schema_version"),
            "float_decimals": decimals,
            "list_limit": list_limit,
        },
        "overall": build_overall(payload, decimals),
    }

    for entry in index:
        chapter_id = entry["id"]
        keys = CHAPTER_KEY_MAP.get(chapter_id, [])
        evidence: dict[str, Any] = {}
        for key in keys:
            if key in payload:
                evidence[key] = compact_value(payload[key], decimals, list_limit)

        chapter: dict[str, Any] = {
            "number": entry["number"],
            "title": entry["title"],
            "keys": keys,
            "evidence": evidence,
        }

        if profile["writing_hints"]:
            chapter["writing_hints"] = CHAPTER_HINTS.get(chapter_id, [])

        if profile["raw_flags"]:
            needs_raw = find_low_sample(evidence)
            chapter["needs_raw_check"] = needs_raw
            if needs_raw:
                chapter["raw_reference_reason"] = (
                    "サンプル数が少ない区分が含まれるため、必要に応じて"
                    "ai_analysis_payload.json の該当キーを限定参照する"
                )
                chapter["suggested_raw_scope"] = {
                    "keys": keys,
                    "limit": 30,
                }

        summary[chapter_id] = chapter

    return summary


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
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai",
    )
    parser.add_argument(
        "--quality",
        choices=sorted(QUALITY_TO_PROFILE),
        help="指定時はその品質のサマリだけを作る。省略時は全品質。",
    )
    args = parser.parse_args()

    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    index = json.loads(args.index.read_text(encoding="utf-8"))

    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = PROJECT_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.quality:
        targets = {args.quality: QUALITY_TO_PROFILE[args.quality]}
    else:
        targets = dict(QUALITY_TO_PROFILE)

    # profile 名（rich/standard/compact/legacy）でファイル名を決める。
    written: list[Path] = []
    for profile_name in dict.fromkeys(targets.values()):
        if profile_name == "legacy":
            out_path = out_dir / "ai_appendix_data.json"
            out_path.write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            written.append(out_path)
            print(f"Created: {out_path} ({out_path.stat().st_size:,} bytes)")
            continue

        profile = QUALITY_PROFILES[profile_name]
        summary = build_summary(payload, index, profile)
        out_path = out_dir / f"summary_{profile_name}.json"
        # トークン削減のため空白を入れない最小化JSONで書き出す。
        out_path.write_text(
            json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        written.append(out_path)
        print(f"Created: {out_path} ({out_path.stat().st_size:,} bytes)")

    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
