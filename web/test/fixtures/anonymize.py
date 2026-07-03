#!/usr/bin/env python3
"""実データのTetra Leagueラウンド（parquet/CSV）を匿名化してテストfixtureを出力する。

使い方:
  python web/test/fixtures/anonymize.py <input_rounds.parquet|.csv> [-o web/test/fixtures/rounds_anonymized.csv]

方針（AGENTS.md 個人データ）:
- 実ハンドル・相手名・各種IDを安定な連番へ置換（ID順で採番し再現性を確保）
- `*_json` 列は破棄
- 匿名化前ファイルは web/test/fixtures/raw/ に置き .gitignore 済み
- コミット前に `git diff` で実ハンドル・実IDの残存がないことを目視確認
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

FIXTURE_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = FIXTURE_DIR / "rounds_anonymized.csv"


def load(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


def stable_map(values: pd.Series, prefix: str, width: int = 3) -> dict[str, str]:
    """出現値をID順（辞書順）で安定採番する。"""
    uniq = sorted({str(v) for v in values if pd.notna(v) and str(v) != ""})
    return {v: f"{prefix}{i + 1:0{width}d}" for i, v in enumerate(uniq)}


def anonymize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # `*_json` 列（board/relay等の生JSON）は破棄。
    json_cols = [c for c in df.columns if c.endswith("_json") or c == "json"]
    df = df.drop(columns=json_cols, errors="ignore")

    # 対象プレイヤー。
    if "target_username" in df.columns:
        df["target_username"] = "your_username"
    if "target_id" in df.columns:
        df["target_id"] = "your_username_id"

    # 相手：opponent_id を基準に安定採番し、表示名も同じ順序で対応付ける。
    if "opponent_id" in df.columns:
        orig_ids = df["opponent_id"].astype("object")
        id_map = stable_map(orig_ids, "opponent_id_")
        order = {oid: i for i, oid in enumerate(sorted(id_map))}
        name_map = {oid: f"opponent_{order[oid] + 1:03d}" for oid in id_map}
        if "opponent" in df.columns:
            df["opponent"] = [name_map.get(str(v), None) for v in orig_ids]
        df["opponent_id"] = [id_map.get(str(v), None) for v in orig_ids]
    elif "opponent" in df.columns:
        name_map2 = stable_map(df["opponent"], "opponent_")
        df["opponent"] = df["opponent"].map(lambda v: name_map2.get(str(v), None))

    # match_id / replay_id は出現順を保った安定連番へ。
    for col, prefix in (("match_id", "match_"), ("replay_id", "replay_")):
        if col in df.columns:
            m = stable_map(df[col], prefix, width=4)
            df[col] = df[col].map(lambda v, m=m: m.get(str(v), None))

    # 残りの `*_id` 列（target/opponent/match/replay 以外）も汎用に連番化。
    handled = {"target_id", "opponent_id", "match_id", "replay_id"}
    for col in [c for c in df.columns if c.endswith("_id") and c not in handled]:
        m = stable_map(df[col], f"{col}_")
        df[col] = df[col].map(lambda v, m=m: m.get(str(v), None) if pd.notna(v) else None)

    # その他 username 系列（opponent_username 等）。
    for col in [c for c in df.columns if "username" in c and c != "target_username"]:
        m = stable_map(df[col], f"{col.replace('username', 'user')}_")
        df[col] = df[col].map(lambda v, m=m: m.get(str(v), None) if pd.notna(v) else None)

    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="実データの rounds_with_params.parquet または CSV")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT, help="出力CSVパス")
    args = parser.parse_args()

    df = anonymize(load(args.input))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)
    print(f"wrote {len(df)} rows -> {args.output}")
    print("コミット前に git diff で実ハンドル・実IDの残存がないことを目視確認してください。")


if __name__ == "__main__":
    main()
