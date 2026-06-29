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

QUALITY_TO_SUMMARY = {
    "standard": "summary_standard.json",
    "high_quality": "summary_rich.json",
    "low_cost": "summary_compact.json",
    "legacy_appendix": "ai_appendix_data.json",
}

QUALITY_LABEL = {
    "standard": "標準",
    "high_quality": "高品質",
    "low_cost": "低コスト",
    "legacy_appendix": "従来JSON（ai_appendix_data）",
}

SECTION_IDS = [
    "overview",
    "strengths",
    "weaknesses",
    "style",
    "round_states",
    "streak",
    "session",
    "replays",
    "summary",
    "method",
    "evidence",
]

DATA_MAP_LEGACY = """### データマップ（添付JSONの主な集計項目）

従来形式の `ai_appendix_data.json` を使います。各章で必要な項目を選んで使います。固定の対応はありません。JSONにない項目は触れず短く保留します。

- 全体・推移: `meta`、`kpis`、`tr_change`、`recent_windows`、`recent_scope`、`growth`、`growth_window_n`、`drawdown`、`tr_gap`
- 試合単位の指標: `metrics`、`metrics_recent`、`stability`、`effect_sizes`、`delta_vs_bins`、`dominance`、`model`、`pps_bins`
- プレイスタイル: `styles`、`styles_recent`
- ラウンド単位の局面: `score_states`（同点・リード・ビハインド・各MP）、`tiebreak`（経路と指標変化）、`duration_bins`・`duration_by_result`（決着時間別）
- 試合単位の連続性: `streaks`（連勝後・連敗後・3連敗以降。すべて試合単位）、`streak_states`（段階別の勝率・期待超過・能力指標差）
- セッション定義: `session_definition`（前試合完了直後から次試合開始まで10分以内なら同一セッション。試合完了時刻はラウンド時間から推定）
- セッション内の試合位置: `session_positions`（1試合目〜11試合目以降。位置は試合単位）
- セッション継続傾向: `session_dynamics`（勝ち後／負け後の継続率、セッションの終わり方、セッション長別の勝率。負け後の継続率が勝ち後より高ければ「負けるほど粘る」、逆なら「勝てているから続ける」傾向。継続率はデータ末尾の打ち切り試合を除外済み）
- 時間帯: `excess_by_weekday`、`excess_by_hour`
- 記録: `records`
"""

DATA_MAP_SUMMARY = """### データマップ（添付JSONの主な集計項目）

品質別サマリJSON（`summary_standard.json` / `summary_rich.json` / `summary_compact.json`）を使います。`overall` は全体の要点、`c1`〜`c8` は①戦績レポートの章に対応する evidence です。各章で必要な項目を選んで使います。固定の対応はありません。JSONにない項目は触れず短く保留します。

- 全体・推移: `overall`、`c1.evidence.meta`、`c1.evidence.kpis`、`c1.evidence.tr_change`、`c2.evidence.recent_windows`、`c2.evidence.growth`、`c2.evidence.stability`、`c2.evidence.drawdown`
- 試合単位の指標: `c3.evidence.metrics`、`c3.evidence.metrics_recent`、`c4.evidence.effect_sizes`、`c4.evidence.delta_vs_bins`、`c4.evidence.dominance`、`c3.evidence.model`、`c5.evidence.model`
- プレイスタイル: `c3.evidence.styles`、`c3.evidence.styles_recent`
- ラウンド単位の局面: `c6.evidence.score_states`（同点・リード・ビハインド・各MP）、`c6.evidence.tiebreak`、`c7.evidence.duration_bins`、`c7.evidence.duration_by_result`、`c7.evidence.pps_bins`
- 試合単位の連続性: `c6.evidence.streaks`、`c8.evidence.streak_states`
- セッション内の試合位置: `c8.evidence.session_positions`
- セッション継続傾向: `c8.evidence.session_dynamics`
- 曜日・時間帯: `c8.evidence.excess_by_weekday`、`c8.evidence.excess_by_hour`
- 記録: `c1.evidence.records`
- 高品質サマリでは、`needs_raw_check` が true の章だけ `suggested_raw_scope` の範囲で `ai_analysis_payload.json` を限定参照できます。標準・低コストでは添付JSONだけを根拠にします。
"""


def replace_data_map(prompt_body: str, quality: str) -> str:
    data_map = DATA_MAP_LEGACY if quality == "legacy_appendix" else DATA_MAP_SUMMARY
    pattern = re.compile(
        r"### データマップ（添付JSONの主な集計項目）\n.*?\n\n### 1\. 出力する別紙の構成",
        re.S,
    )
    return pattern.sub(data_map.rstrip() + "\n\n### 1. 出力する別紙の構成", prompt_body)


def base_prompt_body(quality: str) -> str:
    text = BASE_PROMPT.read_text(encoding="utf-8")
    marker = "## ===プロンプト本文==="
    if marker in text:
        text = text.split(marker, 1)[1].lstrip()
    text = replace_data_map(text, quality)
    summary_file = QUALITY_TO_SUMMARY[quality]
    quality_label = QUALITY_LABEL[quality]
    header = (
        f"品質モード: **{quality_label}** (`{quality}`)\n"
        f"主入力: `cache/ai/{summary_file}`\n\n"
    )
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
    properties = {sid: regular for sid in SECTION_IDS}
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
    example = {
        "overview": {
            "key": "TRは大きく伸び、直近は攻撃面の底上げが見えます。",
            "bullets": [
                "対象期間のTRは開始値から現在値まで上昇しています。",
                "直近100試合ではAPMとVSが全期間平均より高く出ています。",
                "最大ドローダウン後の戻り方は、直近窓の勝率と合わせて確認します。",
            ],
            "summary": "全体として、短期の揺れを含みつつも攻撃面の伸びが結果に結びついています。",
        },
        "replays": {
            "key": "勝率差が分かれている局面から優先して確認します。",
            "rows": [
                {
                    "priority": "高",
                    "condition": "相手マッチポイントのラウンド",
                    "viewpoint": "攻撃へ寄せる前に受けが崩れていないかを確認します。",
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
            "body": "使った試合数、ラウンド数、対象期間、保留事項を書きます。"
        },
    }
    return json.dumps(example, ensure_ascii=False, indent=2)


def build_agent_prompt(quality: str, out_dir: Path) -> str:
    summary_file = QUALITY_TO_SUMMARY[quality]
    summary_path = out_dir / summary_file
    if not summary_path.is_file():
        raise SystemExit(f"AI用JSONが見つかりません: {summary_path}")

    if quality == "low_cost":
        lines = [
            "あなたはTETR.IO戦績データの分析担当者です。",
            "次のJSONだけを根拠に、②AI考察レポート本文JSONを作成してください。",
            "HTML、Markdown、コードフェンス、前置き、後書きは出力せず、JSON本体だけを返してください。",
            "対象プレイヤー以外の具体的な相手名は出さず、簡潔なdesu/masu体の日本語で書いてください。",
            "",
            "低コストCLIモードのため、各節は短くします。",
            "- 通常節は key 1文、bullets 1〜2項目、summary 1文。",
            "- replays は rows 1〜3件。",
            "- summary.body は2〜3文。",
            "- method.bullets は2〜4項目。",
            "- evidence.body は試合数・期間・保留事項を1〜2文。",
            "- JSONにない値は推測せず、省略または短く保留してください。",
            "",
            "必須キー:",
            ", ".join(SECTION_IDS),
            "",
        ]
    else:
        lines = [strip_html_template(base_prompt_body(quality)), ""]

    lines.append("### 出力形式（AIエージェントCLI用）")
    lines.append("")
    lines.append("HTMLは出力しません。ローカル側が固定HTMLテンプレートへ流し込むため、次のJSON本体だけを出力してください。")
    lines.append("Markdown、説明文、コードフェンス、前置き、後書きは出力しません。")
    lines.append("各フィールドの文章量・分析密度は、上記の従来プロンプトでHTML本文へ直接書く場合と同じレベルにします。")
    lines.append("")
    lines.append("- 通常節（overview / strengths / weaknesses / style / round_states / streak / session）: `key`、`bullets`（3〜5項目）、`summary`。")
    lines.append("- `replays`: `key`、`rows`（priority / condition / viewpoint）、`summary`。")
    lines.append("- `summary`: `key`、`body`（3〜5文）。")
    lines.append("- `method`: `key`、`bullets`（主要な読み、逆因果、選択バイアス、数値だけでは判別できない要素）。")
    lines.append("- `evidence`: `body`（試合数、ラウンド数、対象期間、保留事項）。")
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
    lines.append(summary_path.read_text(encoding="utf-8").strip())
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
        "--quality",
        choices=sorted(QUALITY_TO_SUMMARY),
        default="standard",
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
        "prompt_chat.md": base_prompt_body(args.quality),
        "prompt_codex.md": build_agent_prompt(args.quality, out_dir),
        "prompt_claude.md": build_agent_prompt(args.quality, out_dir),
    }
    for filename, text in prompts.items():
        path = out_dir / filename
        path.write_text(text, encoding="utf-8")
        print(f"Created: {path}")

    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
