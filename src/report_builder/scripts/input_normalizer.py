#!/usr/bin/env python3
"""Normalize supported TETR.IO inputs to the round CSV schema used by the report."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pandas as pd


EST_TR_COLUMN = "Est. TR"
LEGACY_EST_TR_COLUMNS = [
    "Est. TR " + "(TetraStats)",
    "Est. TR(" + "S2 " + "sheet" + "Bot)",
]

REQUIRED_ROUND_COLUMNS = [
    "match_number",
    "played_at_jst",
    "match_result",
    "round",
    "round_won",
    "apm",
    "pps",
    "vs",
    "opponent_apm",
    "opponent_pps",
    "opponent_vs",
]

MATCH_METADATA_COLUMNS = [
    "match_number",
    "match_id",
    "replay_id",
    "ts_utc",
    "played_at_jst",
    "gamemode",
    "match_result",
    "target_score",
    "opponent_score",
    "target_id",
    "target_username",
    "opponent",
    "opponent_id",
    "tr_before",
    "tr_after",
    "tr_delta",
    "glicko_before",
    "glicko_after",
    "glicko_delta",
    "rd_before",
    "rd_after",
    "rd_delta",
    "league_rank_before",
    "league_rank_after",
    "placement_before",
    "placement_after",
    "placement_delta",
    "league_metrics_json",
    "results_leaderboard_json",
    "target_leaderboard_active",
    "opponent_leaderboard_active",
    "opponent_tr_before",
    "opponent_tr_after",
    "opponent_tr_delta",
    "opponent_glicko_before",
    "opponent_glicko_after",
    "opponent_glicko_delta",
    "opponent_rd_before",
    "opponent_rd_after",
    "opponent_rd_delta",
    "opponent_league_rank_before",
    "opponent_league_rank_after",
    "opponent_placement_before",
    "opponent_placement_after",
    "opponent_placement_delta",
    "opponent_league_metrics_json",
]

PARAM_COLUMNS = [
    "APP",
    "DS/Piece",
    "APP+DS/Piece",
    "DS/Second",
    "VS/APM",
    "Garbage Effi.",
    "Cheese Index",
    "Weighted APP",
    "Area",
    EST_TR_COLUMN,
    "Opener",
    "Plonk",
    "Stride",
    "Inf DS",
    "Stride - Plonk",
    "Opener - Inf DS",
]

MATCH_TO_ROUND_COLUMNS = {
    "target_match_apm": "apm",
    "target_match_pps": "pps",
    "target_match_vs": "vs",
    "target_match_pieces": "pieces",
    "target_match_inputs": "inputs",
    "target_match_lines": "lines",
    "target_match_attack": "attack",
    "target_match_garbage_sent": "garbage_sent",
    "target_match_garbage_received": "garbage_received",
    "target_match_garbage_cleared": "garbage_cleared",
    "target_match_singles": "singles",
    "target_match_doubles": "doubles",
    "target_match_triples": "triples",
    "target_match_quads": "quads",
    "target_match_tspins": "tspins",
    "target_match_mini_tspins": "mini_tspins",
    "target_match_kills": "kills",
    "target_match_altitude": "altitude",
    "target_match_rank": "rank",
    "target_match_targeting_factor": "targeting_factor",
    "target_match_targeting_grace": "targeting_grace",
    "target_match_btb": "btb",
    "target_match_revives": "revives",
    "target_match_blockrationing_app": "blockrationing_app",
    "target_match_blockrationing_final": "blockrationing_final",
    "target_match_escape_artist": "escape_artist",
    "target_match_stats_json": "stats_json",
    "opponent_match_apm": "opponent_apm",
    "opponent_match_pps": "opponent_pps",
    "opponent_match_vs": "opponent_vs",
    "opponent_match_pieces": "opponent_pieces",
    "opponent_match_inputs": "opponent_inputs",
    "opponent_match_lines": "opponent_lines",
    "opponent_match_attack": "opponent_attack",
    "opponent_match_garbage_sent": "opponent_garbage_sent",
    "opponent_match_garbage_received": "opponent_garbage_received",
    "opponent_match_garbage_cleared": "opponent_garbage_cleared",
    "opponent_match_singles": "opponent_singles",
    "opponent_match_doubles": "opponent_doubles",
    "opponent_match_triples": "opponent_triples",
    "opponent_match_quads": "opponent_quads",
    "opponent_match_tspins": "opponent_tspins",
    "opponent_match_mini_tspins": "opponent_mini_tspins",
    "opponent_match_kills": "opponent_kills",
    "opponent_match_altitude": "opponent_altitude",
    "opponent_match_rank": "opponent_rank",
    "opponent_match_targeting_factor": "opponent_targeting_factor",
    "opponent_match_targeting_grace": "opponent_targeting_grace",
    "opponent_match_btb": "opponent_btb",
    "opponent_match_revives": "opponent_revives",
    "opponent_match_blockrationing_app": "opponent_blockrationing_app",
    "opponent_match_blockrationing_final": "opponent_blockrationing_final",
    "opponent_match_escape_artist": "opponent_escape_artist",
    "opponent_match_stats_json": "opponent_stats_json",
}

for name in PARAM_COLUMNS:
    MATCH_TO_ROUND_COLUMNS[f"target_match_{name}"] = name
    MATCH_TO_ROUND_COLUMNS[f"opponent_match_{name}"] = f"opponent_{name}"


def read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, low_memory=False)
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    raise ValueError(f"Unsupported input format: {path.suffix}")


def _normalize_est_tr_columns(df: pd.DataFrame) -> pd.DataFrame:
    for legacy in LEGACY_EST_TR_COLUMNS:
        legacy_pairs = {
            legacy: EST_TR_COLUMN,
            f"opponent_{legacy}": f"opponent_{EST_TR_COLUMN}",
            f"target_match_{legacy}": f"target_match_{EST_TR_COLUMN}",
            f"opponent_match_{legacy}": f"opponent_match_{EST_TR_COLUMN}",
        }
        for old, new in legacy_pairs.items():
            if new not in df and old in df:
                df[new] = df[old]
    return df


def _merge_key(rounds: pd.DataFrame, matches: pd.DataFrame) -> list[str]:
    if "match_id" in rounds.columns and "match_id" in matches.columns:
        return ["match_id"]
    if "match_number" in rounds.columns and "match_number" in matches.columns:
        return ["match_number"]
    raise ValueError("Cannot merge matches: no shared match_id or match_number column.")


def _is_empty(series: pd.Series) -> pd.Series:
    if series.dtype == object or str(series.dtype).startswith("string"):
        return series.isna() | series.astype("string").str.strip().isin(["", "None", "nan", "NaN"])
    return series.isna()


def _fill_from_matches(rounds: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    key = _merge_key(rounds, matches)
    fill_pairs: dict[str, str] = {}

    for column in MATCH_METADATA_COLUMNS:
        if column in matches.columns:
            fill_pairs[column] = column
    for source, target in MATCH_TO_ROUND_COLUMNS.items():
        if source in matches.columns:
            fill_pairs[target] = source

    needed_sources = sorted(set(fill_pairs.values()) - set(key))
    if not needed_sources:
        return rounds

    source = matches[key + needed_sources].drop_duplicates(key, keep="first").copy()
    rename = {column: f"__match_{column}" for column in needed_sources}
    source = source.rename(columns=rename)
    merged = rounds.merge(source, on=key, how="left")

    for target, source_column in fill_pairs.items():
        helper = f"__match_{source_column}"
        if helper not in merged.columns:
            continue
        if target not in merged.columns:
            merged[target] = merged[helper]
        else:
            empty = _is_empty(merged[target])
            merged.loc[empty, target] = merged.loc[empty, helper]

    return merged.drop(columns=[c for c in merged.columns if c.startswith("__match_")])


def _append_missing_match_rows(rounds: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    key = _merge_key(rounds, matches)
    existing = rounds[key].drop_duplicates()
    missing = matches.merge(existing, on=key, how="left", indicator=True)
    missing = missing[missing["_merge"].eq("left_only")].drop(columns=["_merge"])
    if missing.empty:
        return rounds

    rows = []
    for _, match in missing.iterrows():
        result = str(match.get("match_result", "")).strip().lower()
        row = {column: pd.NA for column in rounds.columns}
        for column in key:
            if column in match.index:
                row[column] = match[column]
        for column in MATCH_METADATA_COLUMNS:
            if column in match.index:
                row[column] = match[column]
        for source, target in MATCH_TO_ROUND_COLUMNS.items():
            if source in match.index:
                row[target] = match[source]
        if "round" in row:
            row["round"] = 1
        if "round_won" in row:
            row["round_won"] = result in {"win", "victory", "dqvictory", "dqwin"}
        if "opponent_round_won" in row:
            row["opponent_round_won"] = result in {"loss", "defeat", "dqdefeat", "dqloss"}
        if "synthetic_round" in rounds.columns:
            row["synthetic_round"] = True
        rows.append(row)

    if not rows:
        return rounds
    additions = pd.DataFrame(rows)
    for column in additions.columns:
        if column not in rounds.columns:
            rounds[column] = pd.NA
    for column in rounds.columns:
        if column not in additions.columns:
            additions[column] = pd.NA
    return pd.concat([rounds, additions[rounds.columns]], ignore_index=True)


def _numeric_candidates(columns: Iterable[str]) -> list[str]:
    exact = {
        "match_number",
        "round",
        "target_score",
        "opponent_score",
        "round_count",
        "lifetime_ms",
        "opponent_lifetime_ms",
        "apm",
        "pps",
        "vs",
        "opponent_apm",
        "opponent_pps",
        "opponent_vs",
        "tr_before",
        "tr_after",
        "tr_delta",
        "glicko_before",
        "glicko_after",
        "glicko_delta",
        "rd_before",
        "rd_after",
        "rd_delta",
        "placement_before",
        "placement_after",
        "placement_delta",
        "opponent_tr_before",
        "opponent_tr_after",
        "opponent_tr_delta",
        "opponent_glicko_before",
        "opponent_glicko_after",
        "opponent_glicko_delta",
        "opponent_rd_before",
        "opponent_rd_after",
        "opponent_rd_delta",
        "opponent_placement_before",
        "opponent_placement_after",
        "opponent_placement_delta",
    }
    exact.update(PARAM_COLUMNS)
    exact.update(f"opponent_{name}" for name in PARAM_COLUMNS)
    stat_suffixes = (
        "_pieces",
        "_inputs",
        "_lines",
        "_attack",
        "_garbage_sent",
        "_garbage_received",
        "_garbage_cleared",
        "_singles",
        "_doubles",
        "_triples",
        "_quads",
        "_tspins",
        "_mini_tspins",
        "_kills",
        "_altitude",
        "_rank",
        "_targeting_factor",
        "_targeting_grace",
        "_btb",
        "_revives",
        "_blockrationing_app",
        "_blockrationing_final",
        "_escape_artist",
    )
    return [
        column
        for column in columns
        if column in exact
        or column.endswith(stat_suffixes)
        or column.startswith("target_match_")
        or column.startswith("opponent_match_")
    ]


def _coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for column in _numeric_candidates(df.columns):
        df[column] = pd.to_numeric(df[column], errors="coerce")

    for column in ["round_won", "opponent_round_won"]:
        if column in df.columns and df[column].dtype != bool:
            lowered = df[column].astype("string").str.strip().str.lower()
            df[column] = lowered.isin(["true", "1", "win", "won", "victory"])

    if "opponent_round_won" not in df.columns and "round_won" in df.columns:
        df["opponent_round_won"] = ~df["round_won"].astype(bool)

    if "played_at_jst" in df.columns:
        parsed = pd.to_datetime(df["played_at_jst"], errors="coerce")
        df["played_at_jst"] = parsed.dt.strftime("%Y-%m-%d %H:%M:%S")
        df.loc[parsed.isna(), "played_at_jst"] = pd.NA

    sort_columns = [c for c in ["played_at_jst", "match_number", "round"] if c in df.columns]
    if sort_columns:
        df = df.sort_values(sort_columns, kind="stable").reset_index(drop=True)
    return df


def normalize_to_round_csv(data_file: Path, output_csv: Path, matches_file: Path | None = None) -> Path:
    data_file = data_file.resolve()
    if not data_file.is_file():
        raise FileNotFoundError(f"Input file not found: {data_file}")

    rounds = _normalize_est_tr_columns(read_table(data_file))
    if matches_file is not None:
        matches_file = matches_file.resolve()
        if not matches_file.is_file():
            raise FileNotFoundError(f"Matches file not found: {matches_file}")
        matches = _normalize_est_tr_columns(read_table(matches_file))
        if "synthetic_round" not in rounds.columns:
            rounds["synthetic_round"] = False
        rounds = _fill_from_matches(rounds, matches)
        rounds = _append_missing_match_rows(rounds, matches)

    rounds = _coerce_types(rounds)
    missing = [column for column in REQUIRED_ROUND_COLUMNS if column not in rounds.columns]
    if missing:
        raise ValueError(f"Normalized round data is missing required columns: {missing}")

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    rounds.to_csv(output_csv, index=False, encoding="utf-8")
    return output_csv
