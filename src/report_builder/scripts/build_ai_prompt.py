#!/usr/bin/env python3
"""②AI考察レポート用のプロンプトと本文JSONスキーマを生成する。

手動AIチャット向けは prompts/prompt_recommendations.md と同じHTMLテンプレート込みの
従来手順を使う。AIエージェントCLI向けは同じ分析指示を使い、HTMLテンプレートだけを
ローカルレンダリングへ移すため本文JSONだけを返させる。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASE_PROMPT = PROJECT_ROOT / "prompts" / "prompt_recommendations.md"

AI_INPUT_JSON = "ai_appendix_data.json"
REASONING_LEVELS = ("standard", "high", "low")

REASONING_LEVEL_ALIASES = {
    "high_quality": "high",
    "low_cost": "low",
}

REASONING_LEVEL_LABEL = {
    "standard": "標準",
    "high": "高",
    "low": "低",
}

REGULAR_SECTION_IDS = [
    "overview",
    "growth_stability",
    "capability",
    "win_factors",
    "style_matchup",
    "opponent_expectation",
    "rivals",
    "clutch",
    "comeback",
    "round_time",
    "session_flow",
]

SECTION_IDS = [
    *REGULAR_SECTION_IDS,
    "replays",
    "summary",
    "method",
    "evidence",
]

DATA_MAP_LEGACY = """### データマップ（添付JSONの主な集計項目）

`ai_appendix_data.json` を使います。各章で必要な項目を選んで使います。固定の対応はありません。JSONにない項目は触れず短く保留します。

- 全体像と基本指標: `meta`、`kpis`、`tr_change`、`recent_windows`、`recent_scope`、`rank_journey`
- 成長推移と安定性: `growth`、`growth_window_n`、`growth_windows`、`drawdown`
- 能力バランス: `metrics`、`metrics_recent`、`styles`、`styles_recent`
- 勝敗に関係しやすい指標: `effect_sizes`、`delta_vs_bins`、`dominance`、`pps_vs_dominance`、`model`、`pps_bins`
- プレイスタイル相性: `style_matchup_plane`（相手スタイル2軸平面、4分類別勝率・期待超過）
- 対戦相手の強さと期待値: `tr_gap`
- ライバル: `rivals`（プレイヤーID、遭遇回数、勝敗、最終対戦日）
- 接戦・決着局面: `score_states`（同点・リード・ビハインド・各MP）、`tiebreak`（経路と指標変化）
- 逆転・ビハインド展開: `comeback`（第1ラウンド勝敗別、最大ビハインド別、逆転件数）
- ラウンド展開とマッチ時間: `duration_bins`・`duration_by_result`（決着時間別）
- 連戦の流れ: `streaks`（連勝後・連敗後・3連敗以降。すべてマッチ単位）、`streak_states`（段階別の勝率・期待超過・能力指標差）、`session_positions`、`session_decay`
- 次に見るべきリプレイ条件: 上記各章の勝率差・期待超過・能力差が分かれる区分
- セッション定義: `session_definition`（前マッチ完了直後から次マッチ開始まで10分以内なら同一セッション。マッチ完了時刻はラウンド時間から推定）
- セッション内のマッチ位置: `session_positions`（1マッチ目〜11マッチ目以降。位置はマッチ単位）
- セッション継続傾向: `session_dynamics`（勝ち後／負け後の継続率、セッションの終わり方、セッション長別の勝率。負け後の継続率が勝ち後より高ければ「負けるほど粘る」、逆なら「勝てているから続ける」傾向。継続率はデータ末尾の打ち切りマッチを除外済み）
- 時間帯: `excess_by_weekday`、`excess_by_hour`
- 記録: `records`
"""

def replace_data_map(prompt_body: str) -> str:
    pattern = re.compile(
        r"### データマップ（添付JSONの主な集計項目）\n.*?\n\n### 1\. 出力する別紙の構成",
        re.S,
    )
    return pattern.sub(DATA_MAP_LEGACY.rstrip() + "\n\n### 1. 出力する別紙の構成", prompt_body)


def base_prompt_body() -> str:
    text = BASE_PROMPT.read_text(encoding="utf-8")
    marker = "## ===プロンプト本文==="
    if marker in text:
        text = text.split(marker, 1)[1].lstrip()
    text = replace_data_map(text)
    header = "主入力: `cache/ai/ai_appendix_data.json`\n\n"
    return header + text


def strip_html_template(prompt_body: str) -> str:
    split_at = "### 3. HTML出力ルール"
    if split_at not in prompt_body:
        return prompt_body
    return prompt_body.split(split_at, 1)[0].rstrip()


def section_schema_regular() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["key", "bullets", "summary"],
        "properties": {
            "key": {"type": "string", "minLength": 1, "maxLength": 120},
            "bullets": {
                "type": "array",
                "minItems": 1,
                "maxItems": 6,
                "items": {"type": "string", "minLength": 1},
            },
            "summary": {"type": "string", "minLength": 1},
        },
    }


def build_schema() -> dict:
    regular = section_schema_regular()
    properties = {sid: regular for sid in REGULAR_SECTION_IDS}
    properties["replays"] = {
        "type": "object",
        "additionalProperties": False,
        "required": ["key", "rows", "summary"],
        "properties": {
            "key": {"type": "string", "minLength": 1, "maxLength": 120},
            "rows": {
                "type": "array",
                "minItems": 1,
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["priority", "condition", "viewpoint"],
                    "properties": {
                        "priority": {"type": "string", "minLength": 1, "maxLength": 10},
                        "condition": {"type": "string", "minLength": 1},
                        "viewpoint": {"type": "string", "minLength": 1},
                    },
                },
            },
            "summary": {"type": "string", "minLength": 1},
        },
    }
    properties["summary"] = {
        "type": "object",
        "additionalProperties": False,
        "required": ["key", "body"],
        "properties": {
            "key": {"type": "string", "minLength": 1, "maxLength": 120},
            "body": {"type": "string", "minLength": 1},
        },
    }
    properties["method"] = {
        "type": "object",
        "additionalProperties": False,
        "required": ["key", "bullets"],
        "properties": {
            "key": {"type": "string", "minLength": 1, "maxLength": 120},
            "bullets": {
                "type": "array",
                "minItems": 1,
                "maxItems": 8,
                "items": {"type": "string", "minLength": 1},
            },
        },
    }
    properties["evidence"] = {
        "type": "object",
        "additionalProperties": False,
        "required": ["body"],
        "properties": {"body": {"type": "string", "minLength": 1}},
    }
    properties["_meta"] = {
        "type": "object",
        "additionalProperties": False,
        "required": [],
        "properties": {
            "ai_model": {"type": "string"},
            "player_name": {"type": "string"},
            "source_period": {"type": "string"},
            "generated_date": {"type": "string"},
        },
    }
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "TETR.IO AI考察レポート別紙本文",
        "type": "object",
        "additionalProperties": False,
        "required": SECTION_IDS,
        "properties": properties,
        "x_section_order": SECTION_IDS,
    }


def schema_example() -> str:
    regular_example = {
        "key": "この節の要点を1文で書きます。",
        "bullets": [
            "根拠JSONにある数値や区分を自然文で整理します。",
            "マッチ・ラウンド・セッションの単位を明示します。",
            "小標本や差が小さい項目は短く保留します。",
        ],
        "summary": "節全体の定性考察を1〜2文でまとめます。",
    }
    example = {
        "_meta": {
            "ai_model": "Claude Opus 4.8",
            "player_name": "",
            "source_period": "",
            "generated_date": "",
        },
        "overview": {
            "key": "TRは大きく伸び、直近は期待値を上回っています。",
            "bullets": [
                "対象期間のTRは開始値から現在値まで上昇しています。",
                "直近100マッチの実績勝率は対戦前期待値を上回っています。",
                "ランク推移は昇格回数と現在ランクで確認します。",
            ],
            "summary": "全体として、TR推移と期待超過が同じ向きに出ています。",
        },
        "growth_stability": regular_example,
        "capability": regular_example,
        "win_factors": regular_example,
        "style_matchup": regular_example,
        "opponent_expectation": regular_example,
        "rivals": regular_example,
        "clutch": regular_example,
        "comeback": regular_example,
        "round_time": regular_example,
        "session_flow": regular_example,
        "replays": {
            "key": "勝率差が分かれている局面から優先して確認します。",
            "rows": [
                {
                    "priority": "高",
                    "condition": "相手マッチポイントのラウンド",
                    "viewpoint": "受けが崩れてから攻撃へ寄せていないかを確認します。",
                }
            ],
            "summary": "添付JSONに区分がある条件だけを候補にしています。",
        },
        "summary": {
            "key": "勝ち筋は攻撃面の優位を結果へつなげる展開です。",
            "body": "全体を3〜5文でまとめます。",
        },
        "method": {
            "key": "勝敗差と状況別集計を対応させて読みました。",
            "bullets": ["主要な読みと根拠集計項目の対応を書きます。"],
        },
        "evidence": {
            "body": "使ったマッチ数、ラウンド数、対象期間、保留事項を書きます。"
        },
    }
    return json.dumps(example, ensure_ascii=False, indent=2)


def normalize_reasoning_level(value: str) -> str:
    return REASONING_LEVEL_ALIASES.get(value, value)


def build_agent_prompt(reasoning_level: str, out_dir: Path) -> str:
    reasoning_level = normalize_reasoning_level(reasoning_level)
    input_path = out_dir / AI_INPUT_JSON
    if not input_path.is_file():
        raise SystemExit(f"AI用JSONが見つかりません: {input_path}")

    lines = [strip_html_template(base_prompt_body()), ""]
    if reasoning_level == "high":
        lines.append(f"AIエージェント推論レベル: {REASONING_LEVEL_LABEL[reasoning_level]} (`{reasoning_level}`)")
        lines.extend(
            [
                "推論レベル高のため、各節で根拠項目の対応を確認し、表現の重複を減らしてください。",
                "重要な主張は数値・区分・サンプル数のいずれかに結びつけ、弱い根拠は断定を避けてください。",
                "summary と evidence では全体像、対象期間、読みの限界を通常より丁寧に整理してください。",
            ]
        )
    elif reasoning_level == "low":
        lines.append(f"AIエージェント推論レベル: {REASONING_LEVEL_LABEL[reasoning_level]} (`{reasoning_level}`)")
        lines.extend(
            [
                "推論レベル低のため、根拠JSONにある明確な傾向だけを使って簡潔に書いてください。",
                "推測で補わず、弱い根拠は短く保留してください。",
            ]
        )

    lines.append("### 出力形式（AIエージェントCLI用）")
    lines.append("")
    lines.append("HTMLは出力しません。ローカル側が固定HTMLテンプレートへ流し込むため、次のJSON本体だけを出力してください。")
    lines.append("Markdown、説明文、コードフェンス、前置き、後書きは出力しません。")
    lines.append("各フィールドの文章量・分析密度は、上記のチャット用プロンプトでHTML本文へ直接書く場合と同じレベルにします。")
    lines.append("")
    lines.append("- 通常節（overview / growth_stability / capability / win_factors / style_matchup / opponent_expectation / rivals / clutch / comeback / round_time / session_flow）: `key`、`bullets`（3〜5項目）、`summary`。")
    lines.append("- `replays`: `key`、`rows`（priority / condition / viewpoint）、`summary`。")
    lines.append("- `summary`: `key`、`body`（3〜5文）。")
    lines.append("- `method`: `key`、`bullets`（主要な読み、逆因果、選択バイアス、数値だけでは判別できない要素）。")
    lines.append("- `evidence`: `body`（マッチ数、ラウンド数、対象期間、保留事項）。")
    lines.append("- `_meta.ai_model`: このJSONを生成しているあなた自身のAIモデル名（例: `Claude Opus 4.8`）。分からない場合は `-`。")
    lines.append("")
    lines.append("JSON例:")
    lines.append("")
    lines.append("```json")
    lines.append(schema_example())
    lines.append("```")
    lines.append("")
    lines.append("### 4. 添付JSON本文")
    lines.append("")
    lines.append("次のJSONだけを根拠にしてください。ローカルファイル読み取りや外部参照は不要です。")
    lines.append("")
    lines.append("```json")
    lines.append(input_path.read_text(encoding="utf-8").strip())
    lines.append("```")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=PROJECT_ROOT / "cache" / "ai",
    )
    parser.add_argument(
        "--reasoning-level",
        choices=sorted(REASONING_LEVELS),
        default="standard",
    )
    parser.add_argument(
        "--quality",
        dest="reasoning_level",
        choices=sorted([*REASONING_LEVELS, *REASONING_LEVEL_ALIASES]),
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    out_dir = args.out_dir
    if not out_dir.is_absolute():
        out_dir = PROJECT_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    schema_path = out_dir / "report_text_schema.json"
    schema_path.write_text(
        json.dumps(build_schema(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Created: {schema_path}")

    prompts = {
        "prompt_chat.md": base_prompt_body(),
        "prompt_codex.md": build_agent_prompt(args.reasoning_level, out_dir),
        "prompt_claude.md": build_agent_prompt(args.reasoning_level, out_dir),
    }
    for filename, text in prompts.items():
        path = out_dir / filename
        path.write_text(text, encoding="utf-8")
        print(f"Created: {path}")

    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
