#!/usr/bin/env python3
"""TETR.IOラウンドCSVをマッチ・ラウンド単位で集計する中核モジュール。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import hashlib
import json
import math

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


STYLE_ORDER = ["Opener", "Stride", "Inf DS", "Plonk"]
EST_TR_COLUMN = "Est. TR"
LEGACY_EST_TR_COLUMNS = [
    "Est. TR " + "(TetraStats)",
    "Est. TR(" + "S2 " + "sheet" + "Bot)",
]
WIN_RESULTS = {"win", "victory"}
LOSS_RESULTS = {"loss", "defeat"}
DQ_WIN_RESULTS = {"dqvictory", "dqwin"}
DQ_LOSS_RESULTS = {"dqdefeat", "dqloss"}
NULLIFIED_RESULTS = {"nullified"}
NO_CONTEST_RESULTS = {"nocontest", "no contest", "no_contest"}
TIE_RESULTS = {"tie", "draw"}
EMPTY_RESULTS = {"nan", "none", ""}
OFFICIAL_RESULTS = WIN_RESULTS | LOSS_RESULTS | DQ_WIN_RESULTS | DQ_LOSS_RESULTS
BASE_METRICS = {
    "APM": "apm",
    "PPS": "pps",
    "VS": "vs",
    "APP": "APP",
    "DS/Second": "DS/Second",
    "DS/Piece": "DS/Piece",
    "APP+DS/Piece": "APP+DS/Piece",
    "VS/APM": "VS/APM",
    "Cheese Index": "Cheese Index",
    "Garbage Eff.": "Garbage Effi.",
    "Area": "Area",
    "Est. TR": EST_TR_COLUMN,
}
ABILITY_METRIC_COLUMNS = [
    ("APM", "apm"),
    ("PPS", "pps"),
    ("VS", "vs"),
    ("APP", "APP"),
    ("DS/Second", "DS/Second"),
    ("DS/Piece", "DS/Piece"),
    ("APP+DS/Piece", "APP+DS/Piece"),
    ("VS/APM", "VS/APM"),
    ("Cheese Index", "Cheese Index"),
    ("Garbage Eff.", "Garbage Effi."),
    ("Area", "Area"),
    ("Est. TR", EST_TR_COLUMN),
]
ABILITY_METRICS = [label for label, _ in ABILITY_METRIC_COLUMNS]
MODEL_METRICS = ["APM", "PPS", "VS", "APP", "DS/Piece", "Garbage Eff.", "Area", "VS/APM"]
OPPONENT_COLUMN = {
    "apm": "opponent_apm", "pps": "opponent_pps", "vs": "opponent_vs",
    "APP": "opponent_APP", "DS/Second": "opponent_DS/Second",
    "DS/Piece": "opponent_DS/Piece", "APP+DS/Piece": "opponent_APP+DS/Piece",
    "VS/APM": "opponent_VS/APM", "Garbage Effi.": "opponent_Garbage Effi.",
    "Cheese Index": "opponent_Cheese Index", "Area": "opponent_Area",
    EST_TR_COLUMN: f"opponent_{EST_TR_COLUMN}",
}
# 直近表示の主集計に使うマッチ数。サンプル数を増やすため各ラウンドを利用する。
RECENT_MATCH_WINDOW = 100
TABLE_SCOPE_WINDOWS = [10, 50, 100]
DEFAULT_SESSION_GAP_MINUTES = 10


def _metric_means(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    """rounds でも matches でも同じ列名で self/opponent 平均を算出する。"""
    out: dict[str, dict[str, float]] = {}
    for label, col in BASE_METRICS.items():
        own = float(df[col].mean()) if col in df else math.nan
        opp_col = OPPONENT_COLUMN.get(col)
        opp = float(df[opp_col].mean()) if opp_col in df else math.nan
        out[label] = {"self": own, "opponent": opp, "difference": own - opp}
    return out


def _normalize_est_tr_columns(df: pd.DataFrame) -> pd.DataFrame:
    for legacy in LEGACY_EST_TR_COLUMNS:
        legacy_pairs = {
            legacy: EST_TR_COLUMN,
            f"opponent_{legacy}": f"opponent_{EST_TR_COLUMN}",
        }
        for old, new in legacy_pairs.items():
            if new not in df and old in df:
                df[new] = df[old]
    return df


@dataclass
class AnalysisBundle:
    rounds: pd.DataFrame
    matches: pd.DataFrame
    monthly: pd.DataFrame
    tiebreak_rounds: pd.DataFrame
    summary: dict[str, Any]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finite(series: pd.Series) -> pd.Series:
    return series.where(np.isfinite(series))


def _safe_div(a: pd.Series, b: pd.Series) -> pd.Series:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = a / b
    return _finite(out)


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if not np.isfinite(value) else float(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, pd.Period):
        return str(value)
    if pd.isna(value) if not isinstance(value, (dict, list, tuple)) else False:
        return None
    return value


# TETR.IOリーグランクの昇順。昇降方向の判定に使う。
RANK_ORDER = ["d", "d+", "c-", "c", "c+", "b-", "b", "b+", "a-", "a", "a+",
              "s-", "s", "s+", "ss", "u", "x", "x+"]
_RANK_INDEX = {name: i for i, name in enumerate(RANK_ORDER)}


def _rank_order(rank: Any) -> int:
    """ランク文字列を昇順インデックスへ。未知・欠損は-1。"""
    if rank is None:
        return -1
    return _RANK_INDEX.get(str(rank).strip().lower(), -1)


def _norm_id(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip().lower()


def _leaderboard_activity(row: pd.Series) -> dict[str, bool]:
    raw = row.get("results_leaderboard_json")
    if not isinstance(raw, str) or not raw.strip():
        return {"target_inactive": False, "opponent_inactive": False}
    try:
        entries = json.loads(raw)
    except (TypeError, ValueError):
        return {"target_inactive": False, "opponent_inactive": False}
    if not isinstance(entries, list):
        return {"target_inactive": False, "opponent_inactive": False}

    target_id = _norm_id(row.get("target_id"))
    target_username = _norm_id(row.get("target_username"))
    opponent_id = _norm_id(row.get("opponent_id"))
    opponent_username = _norm_id(row.get("opponent"))

    target = None
    opponent = None
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry_id = _norm_id(entry.get("id"))
        entry_username = _norm_id(entry.get("username"))
        if target is None and ((target_id and entry_id == target_id) or (target_username and entry_username == target_username)):
            target = entry
        if opponent is None and ((opponent_id and entry_id == opponent_id) or (opponent_username and entry_username == opponent_username)):
            opponent = entry

    if target is None and opponent is not None:
        target = next((entry for entry in entries if isinstance(entry, dict) and entry is not opponent), None)
    if opponent is None and target is not None:
        opponent = next((entry for entry in entries if isinstance(entry, dict) and entry is not target), None)

    return {
        "target_inactive": bool(target is not None and target.get("active") is False),
        "opponent_inactive": bool(opponent is not None and opponent.get("active") is False),
    }


def _inactive_mask(df: pd.DataFrame, column: str) -> pd.Series:
    if column not in df.columns:
        return pd.Series(False, index=df.index)
    values = df[column]
    if values.dtype == bool:
        return ~values.fillna(True)
    lowered = values.astype("string").str.strip().str.lower()
    return lowered.isin(["false", "0", "no"])


def _first_valid(s: pd.Series) -> float:
    s = s.dropna()
    return float(s.iloc[0]) if len(s) else math.nan


def _last_valid(s: pd.Series) -> float:
    s = s.dropna()
    return float(s.iloc[-1]) if len(s) else math.nan


def _cohens_d(x: pd.Series, y: pd.Series) -> float:
    x = x.dropna().astype(float)
    y = y.dropna().astype(float)
    if len(x) < 2 or len(y) < 2:
        return math.nan
    vx, vy = x.var(ddof=1), y.var(ddof=1)
    pooled = ((len(x) - 1) * vx + (len(y) - 1) * vy) / (len(x) + len(y) - 2)
    if pooled <= 0 or not np.isfinite(pooled):
        return 0.0
    return float((x.mean() - y.mean()) / math.sqrt(pooled))


def _wilson_interval(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return math.nan, math.nan
    p = wins / n
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / den
    return center - half, center + half


def _glicko_expected_score(
    own_glicko: pd.Series,
    opponent_glicko: pd.Series,
    opponent_rd: pd.Series,
) -> pd.Series:
    q = math.log(10) / 400
    rd = pd.to_numeric(opponent_rd, errors="coerce").clip(lower=0)
    g_rd = 1 / np.sqrt(1 + (3 * q * q * rd * rd) / (math.pi * math.pi))
    diff = pd.to_numeric(own_glicko, errors="coerce") - pd.to_numeric(opponent_glicko, errors="coerce")
    exponent = (-g_rd * diff / 400).clip(lower=-20, upper=20)
    return _finite(1 / (1 + np.power(10, exponent)))


def _probability_metrics(y_true: pd.Series, prob: pd.Series) -> dict[str, float]:
    y = y_true.astype(int)
    p = pd.to_numeric(prob, errors="coerce").clip(1e-6, 1 - 1e-6)
    out = {
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
    }
    out["auc"] = float(roc_auc_score(y, p)) if y.nunique() >= 2 else math.nan
    return out


def enrich_rounds(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = _normalize_est_tr_columns(df)
    required = ["match_number", "played_at_jst", "match_result", "round", "round_won", "apm", "pps", "vs"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"CSVに必須列がありません: {missing}")

    df["played_at_jst"] = pd.to_datetime(df["played_at_jst"], errors="coerce")
    df = df.sort_values(["played_at_jst", "match_number", "round"], kind="stable").reset_index(drop=True)
    df["round_won"] = df["round_won"].astype(bool)
    if "opponent_round_won" in df:
        df["opponent_round_won"] = df["opponent_round_won"].astype(bool)
    else:
        df["opponent_round_won"] = ~df["round_won"]

    # 指標を元列に依存せず再計算する。CSV既存列は比較・互換用に残す。
    df["APP"] = _safe_div(df["apm"], df["pps"] * 60)
    df["DS/Second_calc"] = (df["vs"] / 100) - (df["apm"] / 60)
    df["DS/Second"] = df["DS/Second_calc"]
    df["DS/Piece"] = _safe_div(df["DS/Second"], df["pps"])
    df["Garbage Effi."] = _safe_div(df["APP"] * df["DS/Second"], df["pps"]) * 2
    df["APP+DS/Piece"] = df["APP"] + df["DS/Piece"]
    df["VS/APM"] = _safe_div(df["vs"], df["apm"])
    df["Area"] = (
        df["apm"]
        + df["pps"] * 45
        + df["vs"] * 0.444
        + df["APP"] * 185
        + df["DS/Second"] * 175
        + df["DS/Piece"] * 450
        + df["Garbage Effi."] * 315
    )

    df["opponent_APP"] = _safe_div(df["opponent_apm"], df["opponent_pps"] * 60)
    df["opponent_DS/Second_calc"] = (df["opponent_vs"] / 100) - (df["opponent_apm"] / 60)
    df["opponent_DS/Second"] = df["opponent_DS/Second_calc"]
    df["opponent_DS/Piece"] = _safe_div(df["opponent_DS/Second"], df["opponent_pps"])
    df["opponent_Garbage Effi."] = (
        _safe_div(df["opponent_APP"] * df["opponent_DS/Second"], df["opponent_pps"]) * 2
    )
    df["opponent_APP+DS/Piece"] = df["opponent_APP"] + df["opponent_DS/Piece"]
    df["opponent_VS/APM"] = _safe_div(df["opponent_vs"], df["opponent_apm"])
    df["opponent_Area"] = (
        df["opponent_apm"]
        + df["opponent_pps"] * 45
        + df["opponent_vs"] * 0.444
        + df["opponent_APP"] * 185
        + df["opponent_DS/Second"] * 175
        + df["opponent_DS/Piece"] * 450
        + df["opponent_Garbage Effi."] * 315
    )

    if "Cheese Index" not in df:
        df["Cheese Index"] = np.nan
    if "opponent_Cheese Index" not in df:
        df["opponent_Cheese Index"] = np.nan
    if EST_TR_COLUMN not in df:
        df[EST_TR_COLUMN] = np.nan
    if f"opponent_{EST_TR_COLUMN}" not in df:
        df[f"opponent_{EST_TR_COLUMN}"] = np.nan

    # 秒単位のラウンド時間。
    df["lifetime_s"] = pd.to_numeric(df.get("lifetime_ms"), errors="coerce") / 1000

    # B2B（連鎖）。文字列で入る場合があるため数値化する。
    for col in ("btb", "opponent_btb"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def build_match_df(rounds: pd.DataFrame, session_gap_minutes: int = DEFAULT_SESSION_GAP_MINUTES) -> pd.DataFrame:
    metadata = [
        "match_id", "replay_id", "played_at_jst", "opponent", "opponent_id", "match_result",
        "target_id", "target_username", "target_leaderboard_active", "opponent_leaderboard_active",
        "target_score", "opponent_score", "results_leaderboard_json",
        "tr_before", "tr_after", "tr_delta",
        "opponent_tr_before", "opponent_tr_after", "opponent_tr_delta",
        "glicko_before", "glicko_after", "glicko_delta", "rd_before", "rd_after", "rd_delta",
        "opponent_glicko_before", "opponent_glicko_after", "opponent_glicko_delta",
        "opponent_rd_before", "opponent_rd_after", "opponent_rd_delta",
        "league_rank_before", "league_rank_after",
        "placement_before", "placement_after", "placement_delta",
    ]
    metadata = [c for c in metadata if c in rounds.columns]

    metric_columns = [
        "apm", "pps", "vs", "APP", "DS/Second", "DS/Piece", "APP+DS/Piece",
        "VS/APM", "Garbage Effi.", "Cheese Index", "Area", EST_TR_COLUMN, "btb",
        "opponent_apm", "opponent_pps", "opponent_vs", "opponent_APP",
        "opponent_DS/Second", "opponent_DS/Piece", "opponent_APP+DS/Piece",
        "opponent_VS/APM", "opponent_Garbage Effi.", "opponent_Cheese Index",
        "opponent_Area", f"opponent_{EST_TR_COLUMN}", "opponent_btb",
    ]
    for style in STYLE_ORDER:
        if style in rounds:
            metric_columns.append(style)
        if f"opponent_{style}" in rounds:
            metric_columns.append(f"opponent_{style}")
    metric_columns = [c for c in metric_columns if c in rounds.columns]

    g = rounds.groupby("match_number", sort=False)
    meta = g[metadata].first()
    metrics = g[metric_columns].mean()
    matches = meta.join(metrics)
    matches["round_count"] = g.size()
    matches["rounds_won"] = g["round_won"].sum().astype(int)
    matches["rounds_lost"] = g["opponent_round_won"].sum().astype(int)
    duration_columns = [
        pd.to_numeric(rounds[column], errors="coerce")
        for column in ("lifetime_ms", "opponent_lifetime_ms")
        if column in rounds.columns
    ]
    if duration_columns:
        round_duration_ms = pd.concat(duration_columns, axis=1).max(axis=1)
        matches["match_duration_ms"] = round_duration_ms.groupby(rounds["match_number"], sort=False).sum(min_count=1)
    else:
        matches["match_duration_ms"] = np.nan
    matches["match_result_norm"] = matches["match_result"].astype(str).str.strip().str.lower()
    matches["nullified"] = matches["match_result_norm"].isin(NULLIFIED_RESULTS)
    matches["no_contest"] = matches["match_result_norm"].isin(NO_CONTEST_RESULTS)
    matches["tie"] = matches["match_result_norm"].isin(TIE_RESULTS)
    inferred_dq_win = _inactive_mask(matches, "opponent_leaderboard_active")
    inferred_dq_loss = _inactive_mask(matches, "target_leaderboard_active")
    if "results_leaderboard_json" in matches.columns and not (inferred_dq_win.any() or inferred_dq_loss.any()):
        activity = matches.apply(_leaderboard_activity, axis=1, result_type="expand")
        inferred_dq_win = activity["opponent_inactive"]
        inferred_dq_loss = activity["target_inactive"]
    inferred_dq_win = inferred_dq_win & matches["match_result_norm"].isin(WIN_RESULTS | DQ_WIN_RESULTS)
    inferred_dq_loss = inferred_dq_loss & matches["match_result_norm"].isin(LOSS_RESULTS | DQ_LOSS_RESULTS)
    matches["dq_win"] = matches["match_result_norm"].isin(DQ_WIN_RESULTS) | inferred_dq_win
    matches["dq_loss"] = matches["match_result_norm"].isin(DQ_LOSS_RESULTS) | inferred_dq_loss
    matches["regular_result"] = matches["match_result_norm"].isin(WIN_RESULTS | LOSS_RESULTS) & ~(matches["dq_win"] | matches["dq_loss"])
    matches["dq_result"] = matches["dq_win"] | matches["dq_loss"]
    matches["won"] = matches["match_result_norm"].isin(WIN_RESULTS | DQ_WIN_RESULTS)
    matches["official_won"] = matches["won"]
    matches["completed"] = matches["match_result_norm"].isin(OFFICIAL_RESULTS)
    matches["analysis_eligible"] = matches["completed"] & matches["regular_result"]
    matches = matches.sort_values(["played_at_jst", "match_number"], kind="stable")

    matches["date"] = matches["played_at_jst"].dt.date
    matches["month"] = matches["played_at_jst"].dt.to_period("M")
    matches["weekday"] = matches["played_at_jst"].dt.dayofweek
    matches["hour"] = matches["played_at_jst"].dt.hour
    matches["match_end_jst"] = matches["played_at_jst"] + pd.to_timedelta(matches["match_duration_ms"], unit="ms")
    previous_end = matches["match_end_jst"].shift(1)
    previous_start = matches["played_at_jst"].shift(1)
    previous_boundary = previous_end.where(previous_end.notna(), previous_start)
    gap = (matches["played_at_jst"] - previous_boundary).dt.total_seconds().div(60)
    matches["session_break_minutes"] = gap
    new_session = gap.gt(session_gap_minutes)
    if len(new_session):
        new_session.iloc[0] = True
    matches["session_id"] = new_session.fillna(True).astype(int).cumsum()
    matches["session_position"] = matches.groupby("session_id").cumcount() + 1
    matches["session_size"] = matches.groupby("session_id")["session_id"].transform("size")

    # 相対指標。
    pairs = {
        "APM": ("apm", "opponent_apm"),
        "PPS": ("pps", "opponent_pps"),
        "VS": ("vs", "opponent_vs"),
        "APP": ("APP", "opponent_APP"),
        "DS/Second": ("DS/Second", "opponent_DS/Second"),
        "DS/Piece": ("DS/Piece", "opponent_DS/Piece"),
        "APP+DS/Piece": ("APP+DS/Piece", "opponent_APP+DS/Piece"),
        "VS/APM": ("VS/APM", "opponent_VS/APM"),
        "Garbage Eff.": ("Garbage Effi.", "opponent_Garbage Effi."),
        "Cheese Index": ("Cheese Index", "opponent_Cheese Index"),
        "Area": ("Area", "opponent_Area"),
        "Est. TR": (EST_TR_COLUMN, f"opponent_{EST_TR_COLUMN}"),
    }
    for label, (own, opp) in pairs.items():
        if own in matches and opp in matches:
            matches[f"delta_{label}"] = matches[own] - matches[opp]

    # スタイル2軸（複合型対応の相性分析用）。argmaxで1スタイルに潰さず、平面位置で扱う。
    # マッチ平均は線形なので mean(Opener)-mean(Inf DS) = mean(Opener - Inf DS)。
    if all(s in matches for s in STYLE_ORDER):
        matches["Opener - Inf DS"] = matches["Opener"] - matches["Inf DS"]
        matches["Stride - Plonk"] = matches["Stride"] - matches["Plonk"]
    opp_axis_styles = [f"opponent_{s}" for s in STYLE_ORDER]
    if all(s in matches for s in opp_axis_styles):
        matches["opponent_Opener - Inf DS"] = matches["opponent_Opener"] - matches["opponent_Inf DS"]
        matches["opponent_Stride - Plonk"] = matches["opponent_Stride"] - matches["opponent_Plonk"]

    if all(s in matches for s in STYLE_ORDER):
        style_frame = matches[STYLE_ORDER]
        all_na = style_frame.isna().all(axis=1)
        matches["self_style"] = style_frame.fillna(-np.inf).idxmax(axis=1)
        matches.loc[all_na, "self_style"] = "Unknown"
    else:
        matches["self_style"] = "Unknown"
    opp_styles = [f"opponent_{s}" for s in STYLE_ORDER]
    if all(s in matches for s in opp_styles):
        opp_frame = matches[opp_styles].rename(columns={f"opponent_{s}": s for s in STYLE_ORDER})
        all_na = opp_frame.isna().all(axis=1)
        matches["opponent_style"] = opp_frame.fillna(-np.inf).idxmax(axis=1)
        matches.loc[all_na, "opponent_style"] = "Unknown"
    else:
        matches["opponent_style"] = "Unknown"

    # 直前結果と連勝・連敗状態。
    matches["previous_won"] = matches["won"].shift(1)
    streak_before = []
    current_sign = None
    current_len = 0
    for won in matches["won"].tolist():
        streak_before.append(current_len if current_sign is not None else 0)
        sign = bool(won)
        if sign == current_sign:
            current_len += 1
        else:
            current_sign = sign
            current_len = 1
    # 正は連勝中、負は連敗中。
    signed = []
    previous = None
    run = 0
    for won in matches["won"].shift(1):
        if pd.isna(won):
            signed.append(0)
            previous = None
            run = 0
            continue
        sign = bool(won)
        if sign == previous:
            run += 1
        else:
            previous = sign
            run = 1
        signed.append(run if sign else -run)
    matches["streak_before"] = signed
    return matches


def fit_expected_models(matches: pd.DataFrame) -> dict[str, Any]:
    matches["tr_diff"] = matches["tr_before"] - matches["opponent_tr_before"]
    result: dict[str, Any] = {
        "valid_n": 0,
        "baseline": {},
        "relative": {},
    }
    matches["expected_win"] = np.nan
    matches["relative_model_prob"] = np.nan
    eligible = matches["analysis_eligible"] if "analysis_eligible" in matches else matches["completed"]
    glicko_columns = ["glicko_before", "opponent_glicko_before", "opponent_rd_before"]
    has_glicko = all(column in matches.columns for column in glicko_columns)
    if has_glicko:
        valid = eligible & matches[glicko_columns].notna().all(axis=1)
        model_df = matches.loc[valid].copy()
        expected = _glicko_expected_score(
            model_df["glicko_before"],
            model_df["opponent_glicko_before"],
            model_df["opponent_rd_before"],
        )
        model_df["expected_win"] = expected
        matches.loc[valid, "expected_win"] = expected
        result["valid_n"] = int(len(model_df))
        result["baseline"] = {
            "method": "glicko_rd",
            "n": int(len(model_df)),
            "mean_expected": float(expected.mean()) if len(expected) else math.nan,
            "mean_actual": float(model_df["won"].mean()) if len(model_df) else math.nan,
            "mean_glicko_diff": float((model_df["glicko_before"] - model_df["opponent_glicko_before"]).mean()) if len(model_df) else math.nan,
            "mean_opponent_rd": float(model_df["opponent_rd_before"].mean()) if len(model_df) else math.nan,
        }
        if len(model_df) and model_df["won"].nunique() >= 2:
            result["baseline"].update(_probability_metrics(model_df["won"], expected))
    else:
        valid = eligible & matches["tr_diff"].notna()
        model_df = matches.loc[valid].copy()
        result["valid_n"] = int(len(model_df))
        result["baseline"] = {"method": "tr_logistic_fallback"}
    if len(model_df) < 100 or model_df["won"].nunique() < 2:
        result["warning"] = "期待勝率モデルに十分なデータがありません。"
        return result

    split = max(50, int(len(model_df) * 0.7))
    split = min(split, len(model_df) - 20)
    train = model_df.iloc[:split]
    test = model_df.iloc[split:]

    if not has_glicko:
        base = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(C=10.0, max_iter=3000)),
        ])
        base.fit(train[["tr_diff"]], train["won"].astype(int))
        test_p = base.predict_proba(test[["tr_diff"]])[:, 1]
        result["baseline"].update({
            "train_n": int(len(train)),
            "test_n": int(len(test)),
            **_probability_metrics(test["won"], pd.Series(test_p, index=test.index)),
        })
    if not has_glicko:
        # 全データで再学習し、比較用期待勝率を付与。
        base.fit(model_df[["tr_diff"]], model_df["won"].astype(int))
        matches.loc[valid, "expected_win"] = base.predict_proba(model_df[["tr_diff"]])[:, 1]
        result["baseline"]["standardized_coef"] = float(base.named_steps["model"].coef_[0, 0])
        result["baseline"]["intercept"] = float(base.named_steps["model"].intercept_[0])

    relative_features = [f"delta_{m}" for m in MODEL_METRICS if f"delta_{m}" in model_df]
    if len(relative_features) >= 3:
        rel = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(C=1.0, max_iter=4000)),
        ])
        if has_glicko:
            expected_for_logit = model_df["expected_win"].clip(1e-6, 1 - 1e-6)
            model_df["expected_logit"] = np.log(expected_for_logit / (1 - expected_for_logit))
            matches.loc[valid, "expected_logit"] = model_df["expected_logit"]
            train = model_df.iloc[:split]
            test = model_df.iloc[split:]
            features = ["expected_logit"] + relative_features
        else:
            features = ["tr_diff"] + relative_features
        rel.fit(train[features], train["won"].astype(int))
        rel_p = rel.predict_proba(test[features])[:, 1]
        coefficients = rel.named_steps["model"].coef_[0]
        result["relative"] = {
            "features": features,
            **_probability_metrics(test["won"], pd.Series(rel_p, index=test.index)),
            "standardized_coefficients": {
                feature: float(coef) for feature, coef in zip(features, coefficients)
            },
        }
        rel.fit(model_df[features], model_df["won"].astype(int))
        matches.loc[valid, "relative_model_prob"] = rel.predict_proba(model_df[features])[:, 1]
    return result


def _run_lengths(values: list[bool]) -> tuple[list[int], list[int]]:
    wins: list[int] = []
    losses: list[int] = []
    if not values:
        return wins, losses
    current = values[0]
    length = 1
    for value in values[1:]:
        if value == current:
            length += 1
        else:
            (wins if current else losses).append(length)
            current, length = value, 1
    (wins if current else losses).append(length)
    return wins, losses


def analyze_tiebreaks(rounds: pd.DataFrame, matches: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    tb_matches = matches[
        matches["target_score"].notna()
        & matches["opponent_score"].notna()
        & ((matches["target_score"] - matches["opponent_score"]).abs() == 1)
    ]
    rows = []
    route_counts: dict[str, dict[str, float]] = {}
    for match_number, m in tb_matches.iterrows():
        r = rounds[rounds["match_number"] == match_number].sort_values("round")
        if len(r) < 2:
            continue
        own_cum = r["round_won"].astype(int).cumsum()
        opp_cum = r["opponent_round_won"].astype(int).cumsum()
        lead_before_final = (own_cum - opp_cum).iloc[:-1]
        min_lead = float(lead_before_final.min()) if len(lead_before_final) else 0
        max_lead = float(lead_before_final.max()) if len(lead_before_final) else 0
        penultimate_won = bool(r.iloc[-2]["round_won"])
        if min_lead <= -2 and penultimate_won:
            route = "大差ビハインドから追いついた"
        elif max_lead >= 2 and not penultimate_won:
            route = "大差リードから追いつかれた"
        elif penultimate_won:
            route = "追いついた側"
        else:
            route = "追いつかれた側"
        final = r.iloc[-1]
        previous = r.iloc[:-1]
        row = {
            "match_number": int(match_number),
            "played_at_jst": m["played_at_jst"],
            "won": bool(m["won"]),
            "expected_win": m.get("expected_win", np.nan),
            "route": route,
            "penultimate_won": penultimate_won,
            "min_lead_before_final": min_lead,
            "max_lead_before_final": max_lead,
            "final_lifetime_s": final.get("lifetime_s", np.nan),
        }
        for label, col in ABILITY_METRIC_COLUMNS:
            row[f"final_{label}"] = final.get(col, np.nan)
            row[f"prior_{label}"] = previous[col].mean() if col in previous else np.nan
            row[f"change_{label}"] = row[f"final_{label}"] - row[f"prior_{label}"]
        rows.append(row)
    tb = pd.DataFrame(rows)
    if tb.empty:
        return tb, {"n": 0}
    route_summary = []
    for route, group in tb.groupby("route"):
        n = len(group)
        wins = int(group["won"].sum())
        lo, hi = _wilson_interval(wins, n)
        # 期待超過は期待勝率を算出できるマッチで実績側も揃える（win_rate/n/Wilsonは全マッチのまま）。
        gve = group[group["expected_win"].notna()]
        route_summary.append({
            "route": route,
            "n": n,
            "wins": wins,
            "win_rate": wins / n,
            "expected": float(gve["expected_win"].mean()) if len(gve) else math.nan,
            "excess": float(gve["won"].mean() - gve["expected_win"].mean()) if len(gve) else math.nan,
            "wilson_low": lo,
            "wilson_high": hi,
        })
    wins = int(tb["won"].sum())
    lo, hi = _wilson_interval(wins, len(tb))
    tb_ve = tb[tb["expected_win"].notna()]

    def _route_group(mask: pd.Series) -> dict[str, Any]:
        g = tb[mask]
        n = int(len(g))
        w = int(g["won"].sum())
        return {"n": n, "wins": w, "win_rate": float(w / n) if n else math.nan}

    summary = {
        "n": int(len(tb)),
        "wins": wins,
        "win_rate": float(tb["won"].mean()),
        "expected": float(tb_ve["expected_win"].mean()) if len(tb_ve) else math.nan,
        "excess": float(tb_ve["won"].mean() - tb_ve["expected_win"].mean()) if len(tb_ve) else math.nan,
        "wilson_low": lo,
        "wilson_high": hi,
        # 追い付いた側（最終前ラウンドを取ってタイブレークへ持ち込んだ）/ 追い付かれた側。
        "caught_up": _route_group(tb["penultimate_won"]),
        "caught_from": _route_group(~tb["penultimate_won"]),
        "routes": route_summary,
        "final_changes": {
            label: float(tb[f"change_{label}"].mean())
            for label in ABILITY_METRICS
        },
    }
    return tb, summary


SCORE_STATE_ORDER = ["同点", "リード時", "ビハインド時", "自分MP", "相手MP", "双方MP"]


def build_score_state_rounds(rounds: pd.DataFrame, matches: pd.DataFrame) -> list[dict[str, Any]]:
    """ラウンド開始前スコアで状態を分類し、その状態での次ラウンド勝率を集計する。

    同点・リード・ビハインドはラウンド開始前のスコア差から判定する。マッチポイント状態は
    target_score / opponent_score が両方あるマッチのみで判定し、欠損マッチは除外する。
    1ラウンドはスコア差分類とマッチポイント分類の両方に同時に該当しうる。
    """
    states: dict[str, dict[str, float]] = {
        label: {"n": 0, "wins": 0, "diff_sum": 0.0} for label in SCORE_STATE_ORDER
    }

    def add(label: str, won: int, diff: int) -> None:
        st = states[label]
        st["n"] += 1
        st["wins"] += won
        st["diff_sum"] += diff

    for match_number, m in matches.iterrows():
        r = rounds[rounds["match_number"] == match_number].sort_values("round")
        if r.empty:
            continue
        own_won = r["round_won"].astype(int).tolist()
        opp_won = r["opponent_round_won"].astype(int).tolist()
        target = m.get("target_score")
        opp_target = m.get("opponent_score")
        has_mp = pd.notna(target) and pd.notna(opp_target)
        win_threshold = int(max(target, opp_target)) if has_mp else None

        own_cum = 0
        opp_cum = 0
        for i in range(len(r)):
            diff = own_cum - opp_cum
            won = own_won[i]
            if diff == 0:
                add("同点", won, diff)
            elif diff > 0:
                add("リード時", won, diff)
            else:
                add("ビハインド時", won, diff)
            if has_mp and win_threshold:
                own_mp = own_cum == win_threshold - 1
                opp_mp = opp_cum == win_threshold - 1
                if own_mp and opp_mp:
                    add("双方MP", won, diff)
                elif own_mp:
                    add("自分MP", won, diff)
                elif opp_mp:
                    add("相手MP", won, diff)
            own_cum += own_won[i]
            opp_cum += opp_won[i]

    out = []
    for label in SCORE_STATE_ORDER:
        st = states[label]
        n = int(st["n"])
        out.append({
            "label": label,
            "n": n,
            "win_rate": float(st["wins"] / n) if n else math.nan,
            "score_diff_mean": float(st["diff_sum"] / n) if n else math.nan,
        })
    return out


def build_monthly(matches: pd.DataFrame) -> pd.DataFrame:
    rows = []
    metric_pairs = {
        "APM": "apm", "PPS": "pps", "VS": "vs", "APP": "APP",
        "DS/S": "DS/Second", "DS/P": "DS/Piece", "GbE": "Garbage Effi.",
        "Area": "Area", "VS/APM": "VS/APM",
    }
    for month, g in matches.groupby("month", sort=True):
        tr_series = g["tr_after"].dropna()
        if len(tr_series):
            running_peak = tr_series.cummax()
            drawdown = tr_series - running_peak
            max_dd = float(drawdown.min())
            peak = float(tr_series.max())
        else:
            max_dd = peak = math.nan
        row: dict[str, Any] = {
            "month": str(month),
            "matches": int(len(g)),
            "wins": int(g["won"].sum()),
            "losses": int((~g["won"]).sum()),
            "dq_wins": int(g["dq_win"].sum()),
            "dq_losses": int(g["dq_loss"].sum()) if "dq_loss" in g else 0,
            "official_win_rate": float(g["won"].mean()),
            "normal_win_rate": float(g.loc[~(g["dq_win"] | g["dq_loss"]), "won"].mean()) if (~(g["dq_win"] | g["dq_loss"])).any() else math.nan,
            "expected_win_rate": float(g["expected_win"].mean()),
            # 期待超過は期待勝率を算出できるマッチで実績側も揃える（official_win_rate等は全マッチのまま）。
            "expected_excess_rate": float(g.loc[g["expected_win"].notna(), "won"].mean() - g["expected_win"].mean()) if g["expected_win"].notna().any() else math.nan,
            "expected_excess_wins": float((g["won"].astype(float) - g["expected_win"]).sum()),
            "tr_start": _first_valid(g["tr_before"]),
            "tr_end": _last_valid(g["tr_after"]),
            "tr_change": _last_valid(g["tr_after"]) - _first_valid(g["tr_before"]),
            "peak_tr": peak,
            "max_drawdown": max_dd,
            "opponent_tr": float(g["opponent_tr_before"].mean()),
            "tr_diff": float(g["tr_diff"].mean()),
            "sessions": int(g["session_id"].nunique()),
            "matches_per_session": float(len(g) / max(g["session_id"].nunique(), 1)),
            "active_days": int(g["date"].nunique()),
        }
        for label, col in metric_pairs.items():
            row[label] = float(g[col].mean())
        for style in STYLE_ORDER:
            row[style] = float(g[style].mean()) if style in g else math.nan
        rows.append(row)
    return pd.DataFrame(rows)


def build_records(rounds: pd.DataFrame, matches: pd.DataFrame, summary_context: dict[str, Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    def add(name: str, value: Any, unit: str, row: pd.Series | None, scope: str, note: str = "") -> None:
        records.append({
            "name": name,
            "value": _jsonable(value),
            "unit": unit,
            "date": _jsonable(row.get("played_at_jst")) if row is not None else None,
            "match_id": row.get("match_id") if row is not None else None,
            "opponent": row.get("opponent") if row is not None else None,
            "scope": scope,
            "note": note,
        })

    valid_tr = matches.dropna(subset=["tr_after"])
    if len(valid_tr):
        row = valid_tr.loc[valid_tr["tr_after"].idxmax()]
        add("最高TR", row["tr_after"], "TR", row, "マッチ後")
    if "league_rank_after" in matches and matches["league_rank_after"].notna().any():
        ranked = matches.dropna(subset=["league_rank_after"]).copy()
        ranked["__rank_ord"] = ranked["league_rank_after"].map(_rank_order)
        ranked = ranked[ranked["__rank_ord"] >= 0]
        if len(ranked):
            row = ranked.loc[ranked["__rank_ord"].idxmax()]
            add("最高ランク", str(row["league_rank_after"]).upper(), "ランク", row, "マッチ後", "初到達日を表示")
    for col, name in [("tr_delta", "最大1マッチTR増加"), ("tr_delta", "最大1マッチTR減少")]:
        valid = matches.dropna(subset=[col])
        if len(valid):
            idx = valid[col].idxmax() if "増加" in name else valid[col].idxmin()
            add(name, valid.loc[idx, col], "TR", valid.loc[idx], "単マッチ", "初期配置期は能力PRとして解釈しない")
    if "won" in matches and "opponent_tr_before" in matches:
        won_valid = matches[matches["won"].astype(bool)].dropna(subset=["opponent_tr_before"])
        if len(won_valid):
            row = won_valid.loc[won_valid["opponent_tr_before"].idxmax()]
            add("勝利した相手最高TR", row["opponent_tr_before"], "TR", row, "単マッチ", "勝利マッチの対戦前相手TRの最大")

    match_metrics = {
        "apm": ("単マッチ最高APM", "APM"), "pps": ("単マッチ最高PPS", "PPS"),
        "vs": ("単マッチ最高VS", "VS"), "APP": ("単マッチ最高APP", "APP"),
        "DS/Second": ("単マッチ最高DS/S", "DS/S"), "DS/Piece": ("単マッチ最高DS/P", "DS/P"),
        "Garbage Effi.": ("単マッチ最高GbE", "GbE"), "Area": ("単マッチ最高Area", "Area"),
        "VS/APM": ("単マッチ最高VS/APM", "VS/APM"),
    }
    for col, (name, unit) in match_metrics.items():
        valid = matches.replace([np.inf, -np.inf], np.nan).dropna(subset=[col])
        if len(valid):
            row = valid.loc[valid[col].idxmax()]
            add(name, row[col], unit, row, "単マッチ平均")

    single_round_note = "単ラウンドPRは切断・DQ・極短ラウンドの影響を受ける場合があります。"
    round_metrics = {
        "apm": ("単ラウンド最高APM", "APM"), "pps": ("単ラウンド最高PPS", "PPS"),
        "vs": ("単ラウンド最高VS", "VS"), "APP": ("単ラウンド最高APP", "APP"),
        "Area": ("単ラウンド最高Area", "Area"),
    }
    for col, (name, unit) in round_metrics.items():
        valid = rounds.replace([np.inf, -np.inf], np.nan).dropna(subset=[col])
        if len(valid):
            row = valid.loc[valid[col].idxmax()]
            add(name, row[col], unit, row, "単ラウンド", single_round_note)

    duration = rounds.dropna(subset=["lifetime_s"])
    if len(duration):
        valid_short = duration[duration["lifetime_s"] >= 5]
        if len(valid_short):
            add("最短ラウンド", valid_short.loc[valid_short["lifetime_s"].idxmin(), "lifetime_s"], "秒", valid_short.loc[valid_short["lifetime_s"].idxmin()], "単ラウンド", "5秒未満は切断・DQ等のアーティファクト疑いとして除外。")
        add("最長ラウンド", duration.loc[duration["lifetime_s"].idxmax(), "lifetime_s"], "秒", duration.loc[duration["lifetime_s"].idxmax()], "単ラウンド")

    rolling_n = 50
    if len(matches) >= rolling_n:
        rolling = matches["won"].astype(float).rolling(rolling_n).mean()
        idx = rolling.idxmax()
        add(f"連続{rolling_n}マッチ最高勝率", rolling.loc[idx], "%", matches.loc[idx], f"{rolling_n}マッチ窓")

    add("最長連勝", summary_context["streaks"]["max_win"], "マッチ", None, "連勝・連敗")
    add("最長連敗", summary_context["streaks"]["max_loss"], "マッチ", None, "連勝・連敗")
    tb_ctx = summary_context["tiebreak"]
    add("タイブレーク勝率", tb_ctx.get("win_rate"), "%", None, "タイブレーク", f"n={tb_ctx.get('n', 0)}")
    caught_up = tb_ctx.get("caught_up", {})
    caught_from = tb_ctx.get("caught_from", {})
    add("タイブレーク勝率（追い付いたとき）", caught_up.get("win_rate"), "%", None, "タイブレーク", f"n={caught_up.get('n', 0)}")
    add("タイブレーク勝率（追い付かれたとき）", caught_from.get("win_rate"), "%", None, "タイブレーク", f"n={caught_from.get('n', 0)}")
    return records


def analyze_csv(
    csv_path: Path,
    player_name: str = "your_username",
    session_gap_minutes: int = DEFAULT_SESSION_GAP_MINUTES,
    window_n: int = 300,
) -> AnalysisBundle:
    raw = pd.read_csv(csv_path, low_memory=False)
    raw_synthetic_rounds = int(raw["synthetic_round"].fillna(False).astype(bool).sum()) if "synthetic_round" in raw else 0
    rounds = enrich_rounds(raw)
    matches = build_match_df(rounds, session_gap_minutes=session_gap_minutes)
    model = fit_expected_models(matches)

    official = matches[matches["completed"]].copy()
    completed = matches[matches["analysis_eligible"]].copy()
    rounds = rounds[rounds["match_number"].isin(completed.index)].copy()
    result_counts = matches["match_result_norm"].value_counts(dropna=False).to_dict()
    known_results = OFFICIAL_RESULTS | NULLIFIED_RESULTS | NO_CONTEST_RESULTS | TIE_RESULTS | EMPTY_RESULTS
    unknown_results = {
        str(k): int(v)
        for k, v in result_counts.items()
        if str(k) not in known_results
    }
    first_tr = _first_valid(completed["tr_before"])
    current_tr = _last_valid(completed["tr_after"])
    valid_tr = completed.dropna(subset=["tr_after"])
    if len(valid_tr):
        peak_idx = valid_tr["tr_after"].idxmax()
        peak_tr = float(valid_tr.loc[peak_idx, "tr_after"])
        peak_date = valid_tr.loc[peak_idx, "played_at_jst"]
        running_peak = valid_tr["tr_after"].cummax()
        drawdown = valid_tr["tr_after"] - running_peak
        dd_idx = drawdown.idxmin()
        max_drawdown = float(drawdown.loc[dd_idx])
        dd_date = valid_tr.loc[dd_idx, "played_at_jst"]
    else:
        peak_tr = max_drawdown = math.nan
        peak_date = dd_date = pd.NaT

    recent_windows = []
    # 直近窓は総マッチ数より小さいものだけ採用し、最後に全期間を1回だけ足す。
    # （総数が窓サイズ以下のときに全期間と同値で重複表示されるのを防ぐ）
    window_sizes = [n for n in TABLE_SCOPE_WINDOWS if n < len(completed)]
    window_sizes.append(len(completed))
    for n in window_sizes:
        n_eff = min(n, len(completed))
        g = completed.tail(n_eff)
        # n/wins/actualは窓全体（定義どおりの母集団）。expected/excessは期待勝率が
        # 算出できるマッチ（expected_win欠損を除く）で揃え、対象数をexpected_nで明示する。
        ge = g[g["expected_win"].notna()]
        recent_windows.append({
            "label": "全期間" if n == len(completed) else f"直近{n_eff}マッチ",
            "n": int(n_eff),
            "wins": int(g["won"].sum()),
            "actual": float(g["won"].mean()),
            "expected_n": int(len(ge)),
            "expected_actual": float(ge["won"].mean()) if len(ge) else math.nan,
            "expected": float(ge["expected_win"].mean()) if len(ge) else math.nan,
            "excess_rate": float(ge["won"].mean() - ge["expected_win"].mean()) if len(ge) else math.nan,
            "excess_wins": float((ge["won"].astype(float) - ge["expected_win"]).sum()) if len(ge) else math.nan,
        })

    metric_means = _metric_means(completed)

    # 直近RECENT_MATCH_WINDOWマッチ分。レーダー/スタイル/相性の主表示に使う（マッチ単位）。
    recent_n = min(RECENT_MATCH_WINDOW, len(completed))
    recent_matches = completed.tail(recent_n)
    recent_ids = set(recent_matches.index)
    recent_rounds = rounds[rounds["match_number"].isin(recent_ids)].copy()
    recent_scope = {"n_matches": int(recent_n), "n_rounds": int(len(recent_rounds))}
    metrics_recent = _metric_means(recent_matches)

    # 初期・直近Nマッチ。グラフと安定性比較用の既存スコープ。
    n_window = min(window_n, max(len(completed) // 3, 1))
    early = completed.head(n_window)
    recent = completed.tail(n_window)
    growth = {}
    stability = {}
    growth_metric_cols = dict(ABILITY_METRIC_COLUMNS)
    for label, col in growth_metric_cols.items():
        e, r = float(early[col].mean()), float(recent[col].mean())
        growth[label] = {
            "early": e, "recent": r,
            "change": r - e,
            "growth_rate": (r / e - 1) if e not in (0, np.nan) and np.isfinite(e) else math.nan,
        }
        stability[label] = {
            "early_p10": float(early[col].quantile(0.1)),
            "early_p50": float(early[col].quantile(0.5)),
            "early_p90": float(early[col].quantile(0.9)),
            "recent_p10": float(recent[col].quantile(0.1)),
            "recent_p50": float(recent[col].quantile(0.5)),
            "recent_p90": float(recent[col].quantile(0.9)),
            "early_cv": float(early[col].std(ddof=1) / early[col].mean()) if early[col].mean() else math.nan,
            "recent_cv": float(recent[col].std(ddof=1) / recent[col].mean()) if recent[col].mean() else math.nan,
        }

    growth_windows = []
    for n in window_sizes:
        n_eff = min(n, len(completed))
        g = completed.tail(n_eff)
        row: dict[str, Any] = {
            "label": "全期間" if n == len(completed) else f"直近{n_eff}マッチ",
            "n": int(n_eff),
        }
        for label, col in growth_metric_cols.items():
            row[label] = float(g[col].mean()) if col in g else math.nan
        growth_windows.append(row)

    effect_sizes = []
    effect_metric_cols = dict(ABILITY_METRIC_COLUMNS)
    effect_metric_cols.update({style: style for style in STYLE_ORDER if style in completed})
    for label, col in effect_metric_cols.items():
        effect_sizes.append({
            "metric": label,
            "d": _cohens_d(completed.loc[completed["won"], col], completed.loc[~completed["won"], col]),
            "win_mean": float(completed.loc[completed["won"], col].mean()),
            "loss_mean": float(completed.loc[~completed["won"], col].mean()),
        })
    effect_sizes.sort(key=lambda x: x["d"] if np.isfinite(x["d"]) else -math.inf, reverse=True)

    def _expected_group(g: pd.DataFrame) -> dict[str, Any]:
        ge = g[g["expected_win"].notna()]
        return {
            "n": int(len(ge)),
            "actual": float(ge["won"].mean()) if len(ge) else math.nan,
            "expected": float(ge["expected_win"].mean()) if len(ge) else math.nan,
            "excess": float(ge["won"].mean() - ge["expected_win"].mean()) if len(ge) else math.nan,
            "all_n": int(len(g)),
        }

    def _dominance_table(metric_label: str, delta_col: str) -> list[dict[str, Any]]:
        rows = []
        for metric_adv in [False, True]:
            for vs_adv in [False, True]:
                g = completed[(completed[delta_col] >= 0) == metric_adv]
                g = g[(g["delta_VS"] >= 0) == vs_adv]
                stats = _expected_group(g)
                rows.append({
                    "metric": metric_label,
                    "metric_adv": metric_adv,
                    "vs_adv": vs_adv,
                    "label": f"{metric_label}{'優位' if metric_adv else '劣位'}・VS{'優位' if vs_adv else '劣位'}",
                    "win_rate": stats["actual"],
                    **stats,
                })
        return rows

    # APM/VS・PPS/VS優劣4分類。期待勝率があるマッチで実績・期待・超過を揃える。
    dominance = _dominance_table("APM", "delta_APM")
    pps_vs_dominance = _dominance_table("PPS", "delta_PPS")

    # Δ指標の分位ビン。
    delta_metric_bins = {}
    for metric_label, delta_col in {
        "APM": "delta_APM",
        "PPS": "delta_PPS",
        "VS": "delta_VS",
        "Area": "delta_Area",
    }.items():
        bins = []
        dvalid = completed.dropna(subset=[delta_col])
        if len(dvalid) >= 20:
            try:
                dvalid = dvalid.copy()
                bin_col = f"{delta_col}_bin"
                dvalid[bin_col] = pd.qcut(dvalid[delta_col], q=min(8, dvalid[delta_col].nunique()), duplicates="drop")
                for interval, g in dvalid.groupby(bin_col, observed=True):
                    bins.append({
                        "label": str(interval), "n": int(len(g)),
                        "delta_mean": float(g[delta_col].mean()), "win_rate": float(g["won"].mean()),
                    })
            except ValueError:
                pass
        delta_metric_bins[metric_label] = bins
    delta_vs_bins = delta_metric_bins["VS"]

    # プレイスタイル。
    style_means = {
        style: {
            "self": float(completed[style].mean()),
            "opponent": float(completed[f"opponent_{style}"].mean()),
        }
        for style in STYLE_ORDER
    }
    style_matchups = []
    for own in STYLE_ORDER:
        for opp in STYLE_ORDER:
            g = completed[(completed["self_style"] == own) & (completed["opponent_style"] == opp)]
            # 実績・期待・超過・nを期待勝率を算出できるマッチへ揃える。
            g = g[g["expected_win"].notna()]
            style_matchups.append({
                "self_style": own, "opponent_style": opp, "n": int(len(g)),
                "actual": float(g["won"].mean()) if len(g) else math.nan,
                "expected": float(g["expected_win"].mean()) if len(g) else math.nan,
                "excess": float(g["won"].mean() - g["expected_win"].mean()) if len(g) else math.nan,
            })

    # 直近表示用スタイル（マッチ単位）。
    style_means_recent = {
        style: {
            "self": float(recent_matches[style].mean()) if style in recent_matches else math.nan,
            "opponent": float(recent_matches[f"opponent_{style}"].mean()) if f"opponent_{style}" in recent_matches else math.nan,
        }
        for style in STYLE_ORDER
    }
    # 相性表もマッチ単位。代表スタイル別に実績勝率・期待勝率を集計する。
    style_matchups_recent = []
    for own in STYLE_ORDER:
        for opp in STYLE_ORDER:
            g = recent_matches[(recent_matches["self_style"] == own) & (recent_matches["opponent_style"] == opp)]
            # 実績・期待・超過・nを期待勝率を算出できるマッチへ揃える。
            g = g[g["expected_win"].notna()]
            actual = float(g["won"].mean()) if len(g) else math.nan
            expected = float(g["expected_win"].mean()) if len(g) else math.nan
            style_matchups_recent.append({
                "self_style": own, "opponent_style": opp, "n": int(len(g)),
                "actual": actual, "expected": expected,
                "excess": (actual - expected) if len(g) else math.nan,
            })
    representative_recent = max(style_means_recent, key=lambda s: (style_means_recent[s]["self"] if np.isfinite(style_means_recent[s]["self"]) else -np.inf))

    # TR差ビン。
    tr_edges = [-np.inf, -2000, -1000, -500, 0, 500, 1000, 2000, np.inf]
    tr_labels = ["≤-2000", "-2000~-1000", "-1000~-500", "-500~0", "0~500", "500~1000", "1000~2000", "≥2000"]
    tr_gap = []
    tr_valid = completed.dropna(subset=["tr_diff"]).copy()
    tr_valid["tr_gap_bin"] = pd.cut(tr_valid["tr_diff"], bins=tr_edges, labels=tr_labels, right=False)
    for label, g in tr_valid.groupby("tr_gap_bin", observed=False):
        # 実績・期待・超過・nを期待勝率を算出できるマッチへ揃える。
        g = g[g["expected_win"].notna()]
        if len(g):
            tr_gap.append({
                "label": str(label), "n": int(len(g)), "tr_diff": float(g["tr_diff"].mean()),
                "actual": float(g["won"].mean()), "expected": float(g["expected_win"].mean()),
                "excess": float(g["won"].mean() - g["expected_win"].mean()),
            })

    win_runs, loss_runs = _run_lengths(completed["won"].tolist())
    streaks = {
        "max_win": max(win_runs, default=0), "max_loss": max(loss_runs, default=0),
        "win_runs": win_runs, "loss_runs": loss_runs,
        "after_win_rate": float(completed.loc[completed["previous_won"] == True, "won"].mean()),
        "after_win_n": int((completed["previous_won"] == True).sum()),
        "after_loss_rate": float(completed.loc[completed["previous_won"] == False, "won"].mean()),
        "after_loss_n": int((completed["previous_won"] == False).sum()),
        "after_3_losses_rate": float(completed.loc[completed["streak_before"] <= -3, "won"].mean()),
        "after_3_losses_n": int((completed["streak_before"] <= -3).sum()),
    }

    # 逆転。
    comeback_0_2 = 0
    comeback_two = 0
    for match_number, m in completed[completed["won"]].iterrows():
        r = rounds[rounds["match_number"] == match_number].sort_values("round")
        lead = r["round_won"].astype(int).cumsum() - r["opponent_round_won"].astype(int).cumsum()
        if len(lead) >= 2 and lead.iloc[1] == -2:
            comeback_0_2 += 1
        if len(lead) and lead.min() <= -2:
            comeback_two += 1

    tiebreak_rounds, tiebreak = analyze_tiebreaks(rounds, completed)
    psychology = {
        "after_win_rate": streaks["after_win_rate"],
        "after_win_n": streaks["after_win_n"],
        "after_loss_rate": streaks["after_loss_rate"],
        "after_loss_n": streaks["after_loss_n"],
        "after_3_losses_rate": streaks["after_3_losses_rate"],
        "after_3_losses_n": streaks["after_3_losses_n"],
        "comeback_0_2": comeback_0_2,
        "comeback_two_points": comeback_two,
    }

    # 直前の連勝・連敗段階別。相手強度を期待超過で補正し、能力指標は全完了マッチ平均との差分で出す。
    base_apm = float(completed["apm"].mean()) if "apm" in completed else float("nan")
    base_pps = float(completed["pps"].mean()) if "pps" in completed else float("nan")
    base_vs = float(completed["vs"].mean()) if "vs" in completed else float("nan")
    base_area = float(completed["Area"].mean()) if "Area" in completed else float("nan")
    streak_state_defs = [
        ("3連勝以降", lambda s: s >= 3),
        ("2連勝", lambda s: s == 2),
        ("1連勝", lambda s: s == 1),
        ("初戦", lambda s: s == 0),
        ("1連敗", lambda s: s == -1),
        ("2連敗", lambda s: s == -2),
        ("3連敗以降", lambda s: s <= -3),
    ]
    streak_states = []
    for label, cond in streak_state_defs:
        # 期待勝率を算出できるマッチに揃える（実績・期待・超過・nを同一母集団にする）。
        g = completed[cond(completed["streak_before"])]
        g = g[g["expected_win"].notna()]
        if len(g):
            streak_states.append({
                "label": label, "n": int(len(g)),
                "win_rate": float(g["won"].mean()),
                "excess": float(g["won"].mean() - g["expected_win"].mean()),
                "d_apm": float(g["apm"].mean() - base_apm),
                "d_pps": float(g["pps"].mean() - base_pps),
                "d_vs": float(g["vs"].mean() - base_vs),
                "d_area": float(g["Area"].mean() - base_area),
            })

    # セッション位置。1〜10マッチ目は1マッチずつ、11マッチ目以降をまとめる。
    pos_edges = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, np.inf]
    pos_labels = ["1マッチ目", "2マッチ目", "3マッチ目", "4マッチ目", "5マッチ目", "6マッチ目", "7マッチ目", "8マッチ目", "9マッチ目", "10マッチ目", "11マッチ目以降"]
    completed["session_position_bin"] = pd.cut(completed["session_position"], bins=pos_edges, labels=pos_labels, right=False)
    session_positions = []
    for label, g in completed.groupby("session_position_bin", observed=False):
        # 期待勝率を算出できるマッチに揃える（実績・期待・超過・nを同一母集団にする）。
        g = g[g["expected_win"].notna()]
        if len(g):
            session_positions.append({
                "label": str(label), "n": int(len(g)), "actual": float(g["won"].mean()),
                "expected": float(g["expected_win"].mean()),
                "excess": float(g["won"].mean() - g["expected_win"].mean()),
                "d_apm": float(g["apm"].mean() - base_apm),
                "d_pps": float(g["pps"].mean() - base_pps),
                "d_vs": float(g["vs"].mean() - base_vs),
                "d_area": float(g["Area"].mean() - base_area),
            })

    # セッション継続傾向。直前結果と「同一セッションで次のマッチを続けたか」の関係から、
    # 「負けているほど粘る」のか「勝てているから続ける」のかを読み取る。
    # 継続判定は除外マッチ（DQ・無効・no contest・tie）も含む全マッチの時系列で行い、通常マッチの
    # 直後に除外マッチを挟んでも「セッションを続けた」と数える。勝敗での条件づけのみ通常分析対象マッチ。
    mt = matches.sort_values(["played_at_jst", "match_number"], kind="stable")
    continued_full = mt["session_id"].shift(-1).eq(mt["session_id"])
    last_match_idx = mt.index[-1] if len(mt) else None
    last_session_id = mt["session_id"].iloc[-1] if len(mt) else None
    sc = completed.sort_values(["played_at_jst", "match_number"], kind="stable").copy()
    sc["continued"] = continued_full.reindex(sc.index)
    # データ末尾の最終マッチは「続けたか」が観測できない（右側打ち切り）ため継続率から除外。
    cont_obs = sc[sc.index != last_match_idx] if last_match_idx is not None else sc
    after_win = cont_obs[cont_obs["won"] == True]
    after_loss = cont_obs[cont_obs["won"] == False]
    # セッションの終わり方。最終（打ち切り）セッションは「やめた」と確定できないため除外。
    # 各セッションの最後の通常分析対象マッチの勝敗で集計する。
    session_last = sc[sc["session_id"] != last_session_id].groupby("session_id").tail(1)
    # セッション長（全マッチ数）別の勝率。長いセッションで勝率が落ちるかを確認する。
    len_edges = [1, 4, 8, np.inf]
    len_labels = ["1〜3マッチ", "4〜7マッチ", "8マッチ以上"]
    sc["session_len_bin"] = pd.cut(sc["session_size"], bins=len_edges, labels=len_labels, right=False)
    length_winrate = []
    for label, g in sc.groupby("session_len_bin", observed=False):
        ge = g[g["expected_win"].notna()]
        if len(ge):
            length_winrate.append({
                "label": str(label),
                "sessions": int(g["session_id"].nunique()), "n": int(len(ge)),
                "win_rate": float(ge["won"].mean()),
                "expected": float(ge["expected_win"].mean()),
                "excess": float(ge["won"].mean() - ge["expected_win"].mean()),
            })
    session_dynamics = {
        "after_win_continue_rate": float(after_win["continued"].mean()) if len(after_win) else None,
        "after_win_n": int(len(after_win)),
        "after_loss_continue_rate": float(after_loss["continued"].mean()) if len(after_loss) else None,
        "after_loss_n": int(len(after_loss)),
        "session_end_on_loss_rate": float((session_last["won"] == False).mean()) if len(session_last) else None,
        "session_end_on_win_rate": float((session_last["won"] == True).mean()) if len(session_last) else None,
        "sessions_closed_n": int(len(session_last)),
        "length_winrate": length_winrate,
    }

    # 付録C用。曜日別・時間帯別の期待値調整後成績。列はセッション位置表に準拠
    # （区分・実績・期待・期待超過・ΔAPM・ΔPPS・ΔVS・ΔArea・標本）。
    def _excess_breakdown(row_col: str, row_defs: list[tuple[Any, str]]) -> list[dict[str, Any]]:
        rows_out = []
        for key, label in row_defs:
            # 期待勝率を算出できるマッチに揃える（実績・期待・超過・nを同一母集団にする）。
            g = completed[completed[row_col] == key]
            g = g[g["expected_win"].notna()]
            if not len(g):
                continue
            rows_out.append({
                "label": label, "n": int(len(g)), "actual": float(g["won"].mean()),
                "expected": float(g["expected_win"].mean()),
                "excess": float(g["won"].mean() - g["expected_win"].mean()),
                "d_apm": float(g["apm"].mean() - base_apm),
                "d_pps": float(g["pps"].mean() - base_pps),
                "d_vs": float(g["vs"].mean() - base_vs),
                "d_area": float(g["Area"].mean() - base_area),
            })
        return rows_out

    weekday_defs = [(0, "月"), (1, "火"), (2, "水"), (3, "木"), (4, "金"), (5, "土"), (6, "日")]
    hour_band_edges = [0, 4, 8, 12, 16, 20, 24]
    hour_band_labels = ["0–3時", "4–7時", "8–11時", "12–15時", "16–19時", "20–23時"]
    completed["hour_band"] = pd.cut(
        completed["hour"], bins=hour_band_edges, labels=hour_band_labels, right=False
    )
    excess_by_weekday = _excess_breakdown("weekday", weekday_defs)
    excess_by_hour = _excess_breakdown("hour_band", [(lbl, lbl) for lbl in hour_band_labels])

    # ラウンド時間30秒ビン。
    duration_rounds = rounds.dropna(subset=["lifetime_s"]).copy()
    max_duration = max(30, int(math.ceil(duration_rounds["lifetime_s"].quantile(0.995) / 30) * 30))
    duration_edges = list(range(0, max_duration + 30, 30)) + [np.inf]
    duration_labels = [f"{a}–{b}秒" for a, b in zip(duration_edges[:-2], duration_edges[1:-1])] + [f"{duration_edges[-2]}秒以上"]
    duration_rounds["duration_bin"] = pd.cut(duration_rounds["lifetime_s"], bins=duration_edges, labels=duration_labels, right=False)
    # ラウンド単位の能力差分（自分−相手）。表示名はGbEに統一する。
    duration_delta_pairs = {
        f"delta_{label}": (col, OPPONENT_COLUMN.get(col))
        for label, col in ABILITY_METRIC_COLUMNS
    }
    duration_delta_pairs.update({
        f"delta_{style}": (style, f"opponent_{style}")
        for style in STYLE_ORDER
    })
    duration_bins = []
    for label, g in duration_rounds.groupby("duration_bin", observed=False):
        if len(g):
            row = {
                "label": str(label), "n": int(len(g)), "win_rate": float(g["round_won"].mean()),
                "duration_mean": float(g["lifetime_s"].mean()),
            }
            for key, (own, opp) in duration_delta_pairs.items():
                if own in g and opp in g:
                    row[key] = float((g[own] - g[opp]).mean())
                else:
                    row[key] = math.nan
            duration_bins.append(row)

    # 勝敗別の決着時間分布（ラウンド単位）。
    def _duration_stats(sub: pd.DataFrame) -> dict[str, Any]:
        vals = sub["lifetime_s"].dropna()
        return {
            "n": int(len(vals)),
            "mean": float(vals.mean()) if len(vals) else math.nan,
            "median": float(vals.median()) if len(vals) else math.nan,
            "p75": float(vals.quantile(0.75)) if len(vals) else math.nan,
        }
    duration_by_result = {
        "win": _duration_stats(duration_rounds[duration_rounds["round_won"]]),
        "loss": _duration_stats(duration_rounds[~duration_rounds["round_won"]]),
    }

    score_states = build_score_state_rounds(rounds, completed)

    monthly = build_monthly(completed)

    # 速度と効率（プレイング提言用）。
    pps_bins = []
    pvalid = completed.dropna(subset=["pps"]).copy()
    try:
        pvalid["pps_bin"] = pd.qcut(pvalid["pps"], q=6, duplicates="drop")
        for interval, g in pvalid.groupby("pps_bin", observed=True):
            pps_bins.append({
                "label": str(interval), "n": int(len(g)), "pps": float(g["pps"].mean()),
                "APP": float(g["APP"].mean()), "GbE": float(g["Garbage Effi."].mean()),
                "Area": float(g["Area"].mean()), "win_rate": float(g["won"].mean()),
                "expected": float(g["expected_win"].mean()),
            })
    except ValueError:
        pass

    summary_context = {"streaks": streaks, "tiebreak": tiebreak, "psychology": psychology}
    records = build_records(rounds, completed, summary_context)

    # 月次変化点は最大月間差の簡易表現。
    monthly_changes = {}
    if len(monthly) >= 2:
        for metric in ["APM", "PPS", "VS", "APP", "Area"]:
            diff = monthly[metric].diff()
            if diff.notna().any():
                idx = diff.abs().idxmax()
                monthly_changes[metric] = {
                    "month": monthly.loc[idx, "month"], "change": float(diff.loc[idx])
                }

    # ===== レポート拡張（2026-07計画 Phase 1）の集計 =====
    # ⑥ ランク推移。ランク昇降イベントをTR推移へ重ねるための遷移点。
    rank_journey: dict[str, Any] = {"transitions": [], "current": None}
    if "league_rank_after" in completed and completed["league_rank_after"].notna().any():
        rseries = completed.dropna(subset=["league_rank_after"])
        prev = None
        for _, row in rseries.iterrows():
            cur = str(row["league_rank_after"]).strip()
            if prev is not None and cur != prev:
                rank_journey["transitions"].append({
                    "date": row["played_at_jst"],
                    "from": prev, "to": cur,
                    "direction": "up" if _rank_order(cur) > _rank_order(prev) else "down",
                    "tr_after": float(row["tr_after"]) if pd.notna(row.get("tr_after")) else None,
                })
            prev = cur
        rank_journey["current"] = prev

    # ⑧ セッション内の失速曲線。位置別の勝率と能力指標（APM/PPS/VS/Area）。
    session_decay = []
    for label, g in completed.groupby("session_position_bin", observed=False):
        if not len(g):
            continue
        ge = g[g["expected_win"].notna()]
        session_decay.append({
            "label": str(label), "n": int(len(g)),
            "win_rate": float(g["won"].mean()),
            "expected": float(ge["expected_win"].mean()) if len(ge) else math.nan,
            "excess": float(ge["won"].mean() - ge["expected_win"].mean()) if len(ge) else math.nan,
            "apm": float(g["apm"].mean()) if "apm" in g else math.nan,
            "pps": float(g["pps"].mean()) if "pps" in g else math.nan,
            "vs": float(g["vs"].mean()) if "vs" in g else math.nan,
            "area": float(g["Area"].mean()) if "Area" in g else math.nan,
        })

    # ⑨ 逆転・リバーススイープ。第1ラウンドの価値、最大ビハインド別勝率、逆転件数。
    first_won_ids, first_lost_ids = [], []
    deficit_buckets: dict[int, list[bool]] = {1: [], 2: [], 3: [], 4: []}
    reverse_sweeps = []
    for match_number, mm in completed.iterrows():
        r = rounds[rounds["match_number"] == match_number].sort_values("round")
        if r.empty:
            continue
        own = r["round_won"].astype(int).tolist()
        opp = r["opponent_round_won"].astype(int).tolist()
        (first_won_ids if own[0] == 1 else first_lost_ids).append(match_number)
        ow = oc = 0
        min_lead = 0
        for i in range(len(own)):
            ow += own[i]
            oc += opp[i]
            min_lead = min(min_lead, ow - oc)
        max_deficit = -min_lead
        if max_deficit >= 1:
            deficit_buckets[min(max_deficit, 4)].append(bool(mm["won"]))
        if max_deficit >= 2 and bool(mm["won"]):
            reverse_sweeps.append({
                "match_id": mm.get("match_id"), "opponent": mm.get("opponent"),
                "date": mm["played_at_jst"], "max_deficit": int(max_deficit),
            })

    def _first_round_group(ids: list) -> dict[str, Any]:
        g = completed.loc[completed.index.isin(ids)]
        ge = g[g["expected_win"].notna()]
        return {
            "n": int(len(g)),
            "win_rate": float(g["won"].mean()) if len(g) else math.nan,
            "expected": float(ge["expected_win"].mean()) if len(ge) else math.nan,
            "excess": float(ge["won"].mean() - ge["expected_win"].mean()) if len(ge) else math.nan,
        }

    comeback = {
        "by_first_round": {
            "won_first": _first_round_group(first_won_ids),
            "lost_first": _first_round_group(first_lost_ids),
        },
        "by_max_deficit": [
            {"deficit": ("4点以上" if k == 4 else f"{k}点"), "n": len(v),
             "win_rate": (float(np.mean(v)) if v else math.nan)}
            for k, v in sorted(deficit_buckets.items())
        ],
        "reverse_sweeps_n": len(reverse_sweeps),
        "reverse_sweeps": reverse_sweeps[-10:],
    }

    # 案A プレイスタイル相性マップ。相手の2軸平面にマッチ単位で配置し、勝敗で色分け。
    # 縦=Opener−Inf DS、横=Stride−Plonk。散布の個票はチャートが matches を直接参照する。
    style_matchup_plane: dict[str, Any] = {}
    axis_x, axis_y = "opponent_Stride - Plonk", "opponent_Opener - Inf DS"
    if axis_x in completed and axis_y in completed:
        sp = completed.dropna(subset=[axis_x, axis_y])
        if len(sp) >= 30:
            quadrants = []
            for yname, ymask in [("Opener", sp[axis_y] >= 0), ("Inf DS", sp[axis_y] < 0)]:
                for xname, xmask in [("Stride", sp[axis_x] >= 0), ("Plonk", sp[axis_x] < 0)]:
                    q = sp[ymask & xmask]
                    stats = _expected_group(q)
                    quadrants.append({
                        "label": f"相手{yname}・{xname}寄り",
                        "n": stats["n"],
                        "actual": stats["actual"],
                        "expected": stats["expected"],
                        "excess": stats["excess"],
                        "win_rate": stats["actual"],
                        "all_n": stats["all_n"],
                    })
            style_matchup_plane = {
                "n": int(len(sp)),
                "quadrants": quadrants,
                "self_pos": {
                    "x": float(completed["Stride - Plonk"].mean()) if "Stride - Plonk" in completed else None,
                    "y": float(completed["Opener - Inf DS"].mean()) if "Opener - Inf DS" in completed else None,
                },
                "axis_labels": {"x": "Plonk ←→ Stride", "y": "Inf DS ←→ Opener"},
            }

    # ⑤ ライバル（遭遇回数と対戦結果）。相手はTETR.IOのプレイヤーIDで表示する。
    rivals = []
    if "opponent_id" in completed or "opponent" in completed:
        key = completed["opponent_id"] if "opponent_id" in completed else completed["opponent"]
        if "opponent" in completed:
            key = key.where(key.notna() & (key.astype(str).str.len() > 0), completed["opponent"])
        for oid, g in completed.groupby(key, sort=False):
            if oid is None or (isinstance(oid, float) and math.isnan(oid)) or str(oid).strip() == "":
                continue
            n = int(len(g))
            wins = int(g["won"].sum())
            name = str(g["opponent"].dropna().iloc[0]) if ("opponent" in g and g["opponent"].notna().any()) else str(oid)
            label = name.strip() or str(oid)
            rivals.append({
                "opponent": label, "label": label, "n": n, "wins": wins, "losses": n - wins,
                "win_rate": float(wins / n) if n else math.nan,
                "last_played": g["played_at_jst"].max(),
            })
        rivals.sort(key=lambda r: (r["n"], r["wins"]), reverse=True)
        rivals = rivals[:20]

    summary = {
        "schema_version": "1.0.0",
        "source": {"filename": csv_path.name, "sha256": file_sha256(csv_path), "rows": int(len(raw))},
        "session_definition": {
            "gap_minutes": int(session_gap_minutes),
            "gap_basis": "previous_match_end_to_next_match_start",
            "same_session_rule": f"前マッチ完了直後から次マッチ開始までの間隔が{int(session_gap_minutes)}分以内なら同一セッションです。",
            "match_end_estimate": "played_at_jstに、各ラウンドのmax(lifetime_ms, opponent_lifetime_ms)合計を足してマッチ完了時刻を推定しています。",
            "fallback": "マッチ時間を推定できない境界では、前マッチのplayed_at_jstを基準にします。",
        },
        "meta": {
            "player": player_name,
            "start": completed["played_at_jst"].min(), "end": completed["played_at_jst"].max(),
            "matches": int(len(official)), "analysis_matches": int(len(completed)),
            "rounds": int(len(rounds)), "source_rounds": int(len(raw)),
            "synthetic_rounds": raw_synthetic_rounds,
            "input_rounds": int(len(raw) - raw_synthetic_rounds),
            "active_days": int(completed["date"].nunique()),
            "opponents": int(completed["opponent_id"].nunique()) if "opponent_id" in completed else int(completed["opponent"].nunique()),
            "sessions": int(completed["session_id"].nunique()),
            "session_gap_minutes": int(session_gap_minutes),
            "session_gap_basis": "previous_match_end_to_next_match_start",
            "result_counts": {str(k): int(v) for k, v in result_counts.items()},
            "nullified_matches": int(matches["nullified"].sum()),
            "no_contest_matches": int(matches["no_contest"].sum()),
            "tie_matches": int(matches["tie"].sum()),
            "unknown_result_counts": unknown_results,
            "dq_wins": int(matches["dq_win"].sum()),
            "dq_losses": int(matches["dq_loss"].sum()),
        },
        "kpis": {
            "wins": int(official["won"].sum()), "losses": int((~official["won"]).sum()),
            "official_win_rate": float(official["won"].mean()),
            "normal_win_rate": float(completed["won"].mean()),
            "dq_wins": int(official["dq_win"].sum()),
            "dq_losses": int(official["dq_loss"].sum()),
            "nullified": int(matches["nullified"].sum()),
            "no_contest": int(matches["no_contest"].sum()),
            "ties": int(matches["tie"].sum()),
            "analysis_matches": int(len(completed)),
            "first_tr": first_tr, "current_tr": current_tr, "tr_change": current_tr - first_tr,
            "peak_tr": peak_tr, "peak_date": peak_date,
            "max_drawdown": max_drawdown, "max_drawdown_date": dd_date,
        },
        "recent_windows": recent_windows,
        "metrics": metric_means,
        "metrics_recent": metrics_recent,
        "recent_scope": recent_scope,
        "growth_window_n": int(n_window),
        "growth": growth,
        "growth_windows": growth_windows,
        "stability": stability,
        "monthly_changes": monthly_changes,
        "effect_sizes": effect_sizes,
        "delta_metric_bins": delta_metric_bins,
        "delta_vs_bins": delta_vs_bins,
        "dominance": dominance,
        "pps_vs_dominance": pps_vs_dominance,
        "model": model,
        "styles": {"means": style_means, "representative": max(style_means, key=lambda s: style_means[s]["self"]), "matchups": style_matchups},
        "styles_recent": {"means": style_means_recent, "representative": representative_recent, "matchups": style_matchups_recent},
        "tr_gap": tr_gap,
        "drawdown": {"max": max_drawdown, "date": dd_date},
        "streaks": streaks,
        "streak_states": streak_states,
        "psychology": psychology,
        "tiebreak": tiebreak,
        "session_positions": session_positions,
        "session_dynamics": session_dynamics,
        "excess_by_weekday": excess_by_weekday,
        "excess_by_hour": excess_by_hour,
        "duration_bins": duration_bins,
        "duration_by_result": duration_by_result,
        "score_states": score_states,
        "pps_bins": pps_bins,
        "records": records,
        "rank_journey": rank_journey,
        "session_decay": session_decay,
        "comeback": comeback,
        "style_matchup_plane": style_matchup_plane,
        "rivals": rivals,
    }
    return AnalysisBundle(rounds=rounds, matches=completed, monthly=monthly, tiebreak_rounds=tiebreak_rounds, summary=_jsonable(summary))


def write_analysis_outputs(bundle: AnalysisBundle, cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "analysis_summary.json").write_text(
        json.dumps(bundle.summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    bundle.monthly.to_csv(cache_dir / "monthly_summary.csv", index=False, encoding="utf-8-sig")
    (cache_dir / "records.json").write_text(
        json.dumps(bundle.summary["records"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    ai_rivals = [
        {
            "label": r.get("label") or r.get("opponent", ""),
            "n": r.get("n"),
            "wins": r.get("wins"),
            "losses": r.get("losses"),
            "win_rate": r.get("win_rate"),
            "last_played": r.get("last_played"),
        }
        for r in bundle.summary.get("rivals", []) or []
    ]
    comeback = dict(bundle.summary.get("comeback", {}) or {})
    comeback.pop("reverse_sweeps", None)
    # AIへ渡す最小ペイロード。生データやBase64を含めない。
    ai_payload = {
        "schema_version": bundle.summary["schema_version"],
        "source": bundle.summary["source"],
        "session_definition": bundle.summary["session_definition"],
        "meta": bundle.summary["meta"],
        "kpis": bundle.summary["kpis"],
        "tr_change": bundle.summary["kpis"]["tr_change"],
        "recent_windows": bundle.summary["recent_windows"],
        "metrics": bundle.summary["metrics"],
        "metrics_recent": bundle.summary["metrics_recent"],
        "recent_scope": bundle.summary["recent_scope"],
        "growth_window_n": bundle.summary["growth_window_n"],
        "growth": bundle.summary["growth"],
        "growth_windows": bundle.summary["growth_windows"],
        "stability": bundle.summary["stability"],
        "effect_sizes": bundle.summary["effect_sizes"],
        "delta_vs_bins": bundle.summary["delta_vs_bins"],
        "dominance": bundle.summary["dominance"],
        "pps_vs_dominance": bundle.summary["pps_vs_dominance"],
        "model": bundle.summary["model"],
        "styles": {"means": bundle.summary["styles"]["means"]},
        "styles_recent": {"means": bundle.summary["styles_recent"]["means"]},
        "style_matchup_plane": bundle.summary["style_matchup_plane"],
        "tr_gap": bundle.summary["tr_gap"],
        "drawdown": bundle.summary["drawdown"],
        "rank_journey": bundle.summary["rank_journey"],
        "streaks": {k: v for k, v in bundle.summary["streaks"].items() if k not in ["win_runs", "loss_runs"]},
        "streak_states": bundle.summary["streak_states"],
        "tiebreak": bundle.summary["tiebreak"],
        "session_positions": bundle.summary["session_positions"],
        "session_dynamics": bundle.summary["session_dynamics"],
        "session_decay": bundle.summary["session_decay"],
        "excess_by_weekday": bundle.summary["excess_by_weekday"],
        "excess_by_hour": bundle.summary["excess_by_hour"],
        "duration_bins": bundle.summary["duration_bins"],
        "duration_by_result": bundle.summary["duration_by_result"],
        "score_states": bundle.summary["score_states"],
        "comeback": comeback,
        "rivals": ai_rivals,
        "pps_bins": bundle.summary["pps_bins"],
        "records": bundle.summary["records"],
    }
    (cache_dir / "ai_analysis_payload.json").write_text(
        json.dumps(ai_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
