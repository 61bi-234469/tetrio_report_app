from __future__ import annotations

import argparse
import csv
import json
import math
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests


USERNAME = "your_username"
BASE_URL = "https://ch.tetr.io/api"
PAGE_SIZE = 100
USER_AGENT = "tetrio-report-app/1.0 (+https://github.com/61bi-234469/tetrio_report_app)"
SESSION_ID_FILENAME = ".tetrio_api_session.json"
SESSION_ID_TTL_SECONDS = 24 * 60 * 60
API_RETRY_STATUSES = {429, 500, 502, 503, 504}
API_MAX_RETRIES = 4
API_BACKOFF_SECONDS = 2.0

RAW_OUTPUT = Path(f"{USERNAME}_tetra_league_raw.json")
MATCH_CSV_OUTPUT = Path(f"{USERNAME}_tetra_league_matches.csv")
ROUND_CSV_OUTPUT = Path(f"{USERNAME}_tetra_league_rounds.csv")
MATCH_PARQUET_OUTPUT = Path(f"{USERNAME}_tetra_league_matches.parquet")
ROUND_PARQUET_OUTPUT = Path(f"{USERNAME}_tetra_league_rounds.parquet")
MATCH_PARAMS_CSV_OUTPUT = Path(f"{USERNAME}_tetra_league_matches_with_params.csv")
MATCH_PARAMS_PARQUET_OUTPUT = Path(f"{USERNAME}_tetra_league_matches_with_params.parquet")
ROUND_PARAMS_CSV_OUTPUT = Path(f"{USERNAME}_tetra_league_rounds_with_params.csv")
ROUND_PARAMS_PARQUET_OUTPUT = Path(f"{USERNAME}_tetra_league_rounds_with_params.parquet")

JST = timezone(timedelta(hours=9))
DEFAULT_GLICKO_SIGMA = 60.9
DEFAULT_EST_TR_GAMES_WON = 16

# The derived metric formulas in this module are derived from TetraStats.
METRIC_FORMULA_NOTICE = (
    "Derived metric formulas are derived from TetraStats. "
    "They are not official TETR.IO calculations."
)


def build_output_paths(
    username: str,
    output_dir: str | Path | None = None,
    output_layout: str = "flat",
) -> dict[str, Path]:
    """Build the set of output file paths for a given username and directory."""
    base = Path(output_dir) if output_dir else Path(".")
    if output_layout == "grouped":
        user_base = base / username
        raw_base = user_base / "raw"
        csv_base = user_base / "csv"
        parquet_base = user_base / "parquet"
    elif output_layout == "flat":
        raw_base = csv_base = parquet_base = base
    else:
        raise ValueError(f"Unknown output layout: {output_layout}")

    return {
        "raw": raw_base / f"{username}_tetra_league_raw.json",
        "match_csv": csv_base / f"{username}_tetra_league_matches.csv",
        "round_csv": csv_base / f"{username}_tetra_league_rounds.csv",
        "match_parquet": parquet_base / f"{username}_tetra_league_matches.parquet",
        "round_parquet": parquet_base / f"{username}_tetra_league_rounds.parquet",
        "match_params_csv": csv_base / f"{username}_tetra_league_matches_with_params.csv",
        "match_params_parquet": parquet_base / f"{username}_tetra_league_matches_with_params.parquet",
        "round_params_csv": csv_base / f"{username}_tetra_league_rounds_with_params.csv",
        "round_params_parquet": parquet_base / f"{username}_tetra_league_rounds_with_params.parquet",
    }

STAT_FIELDS = {
    "apm": ("apm",),
    "pps": ("pps",),
    "vs": ("vsscore",),
    "pieces": ("pieceplaced",),
    "inputs": ("inputs",),
    "lines": ("lines",),
    "attack": ("attack", ("garbage", "attack")),
    "garbage_sent": ("garbagesent", ("garbage", "sent")),
    "garbage_received": ("garbagereceived", ("garbage", "received")),
    "garbage_cleared": ("garbagecleared", ("garbage", "cleared")),
    "singles": ("singles", ("clears", "singles")),
    "doubles": ("doubles", ("clears", "doubles")),
    "triples": ("triples", ("clears", "triples")),
    "quads": ("quads", ("clears", "quads")),
    "tspins": ("realtspins", ("clears", "realtspins")),
    "mini_tspins": ("minitspins", ("clears", "minitspins")),
    "kills": ("kills",),
    "altitude": ("altitude",),
    "rank": ("rank",),
    "targeting_factor": ("targetingfactor",),
    "targeting_grace": ("targetinggrace",),
    "btb": ("btb",),
    "revives": ("revives",),
    "blockrationing_app": ("blockrationing_app",),
    "blockrationing_final": ("blockrationing_final",),
    "escape_artist": ("escapeartist",),
}

BASE_PARAM_COLUMNS = [
    "APP",
    "DS/Piece",
    "APP+DS/Piece",
    "DS/Second",
    "VS/APM",
    "Garbage Effi.",
    "Cheese Index",
    "Weighted APP",
    "Area",
    "Est. TR",
    "Opener",
    "Plonk",
    "Stride",
    "Inf DS",
    "Stride - Plonk",
    "Opener - Inf DS",
]
OPPONENT_PARAM_COLUMNS = [f"opponent_{column}" for column in BASE_PARAM_COLUMNS]
PARAM_COLUMNS = BASE_PARAM_COLUMNS + OPPONENT_PARAM_COLUMNS
MATCH_PARAM_COLUMNS = (
    [f"target_match_{column}" for column in BASE_PARAM_COLUMNS]
    + [f"opponent_match_{column}" for column in BASE_PARAM_COLUMNS]
)

BASE_PARAM_ROUNDING = {
    "APP": 4,
    "DS/Piece": 4,
    "APP+DS/Piece": 4,
    "DS/Second": 5,
    "VS/APM": 4,
    "Garbage Effi.": 4,
    "Cheese Index": 4,
    "Weighted APP": 4,
    "Area": 4,
    "Est. TR": 2,
    "Opener": 2,
    "Plonk": 4,
    "Stride": 4,
    "Inf DS": 4,
    "Stride - Plonk": 4,
    "Opener - Inf DS": 4,
}


def nested(data: dict[str, Any], *keys: str, default=None):
    current: Any = data

    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)

    return default if current is None else current


def first_nested(data: dict[str, Any], *paths: str | tuple[str, ...]):
    for path in paths:
        keys = (path,) if isinstance(path, str) else path
        value = nested(data, *keys)
        if value is not None:
            return value
    return None


def json_cell(value: Any) -> str:
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def metric_delta(before: object, after: object) -> float | None:
    try:
        return float(after) - float(before)
    except (TypeError, ValueError):
        return None


def parse_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def fmt(value: float | None, places: int) -> str:
    if value is None or not math.isfinite(value):
        return ""
    return f"{round(value, places):.{places}f}"


def safe_div(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def require_number(name: str, value: float | None) -> float:
    if value is None:
        raise ValueError(f"{name} is blank or not numeric")
    return value


def glicko_sigma_for_row(
    row: dict[str, Any],
    source_prefix: str,
    override: float | None,
) -> float:
    if override is not None:
        return override

    return DEFAULT_GLICKO_SIGMA


def estimate_tr_tetrastats(
    pps: float,
    app: float,
    ds_piece: float,
    vs_apm: float,
    glicko_sigma: float,
    games_won: float,
) -> float:
    ntemp = pps * (150 + ((vs_apm - 1.66) * 35)) + app * 290 + ds_piece * 700
    est_glicko_old = (0.000013 * ntemp**3) - (0.0196 * ntemp**2) + (12.645 * ntemp) - 1005.4
    est_glicko_tetrastats = (est_glicko_old * 0.9211) - 49.086

    games_factor = min(1.0, 0.5 + 0.5 * (games_won / 18))
    deviation_factor = 1 + (60 - glicko_sigma) / 1500
    bq = 1.56
    br = 0.86
    bs = 0.87646605
    bt = 0.25

    first_denom = 1 + math.exp(-deviation_factor * bq * ((est_glicko_tetrastats - 1500) / 500))
    second_denom = 1 + math.exp(-deviation_factor * br * ((est_glicko_tetrastats - 2000) / 500))
    return (22000 / (first_denom ** (1 / (bs * games_factor)))) + (
        3000 / (second_denom ** (1 / (bt * games_factor**2)))
    )


def calculate_params(
    row: dict[str, Any],
    glicko_sigma: float,
    games_won: float,
    source_prefix: str = "",
    output_prefix: str = "",
) -> dict[str, str]:
    apm = require_number(f"{source_prefix}apm", parse_float(row.get(f"{source_prefix}apm")))
    pps = require_number(f"{source_prefix}pps", parse_float(row.get(f"{source_prefix}pps")))
    vs = require_number(f"{source_prefix}vs", parse_float(row.get(f"{source_prefix}vs")))

    eff = safe_div(apm, pps)
    vs_apm = safe_div(vs, apm)
    if eff is None or vs_apm is None:
        raise ValueError("apm and pps must be non-zero")

    ds_second = (vs / 100) - (apm / 60)
    ds_piece = safe_div(ds_second, pps)
    app = eff / 60
    if ds_piece is None:
        raise ValueError("pps must be non-zero")

    app_ds_piece = ds_piece + app
    garbage_eff = safe_div((apm / 30) * ds_second, pps**2)
    if garbage_eff is None:
        raise ValueError("pps must be non-zero")

    cheese_index = (ds_piece * 150) + ((vs_apm - 2) * 50) + ((0.6 - app) * 125)
    weighted_app = app - 5 * math.tan(math.radians((cheese_index / -30) + 1))
    area = (
        apm
        + pps * 45
        + vs * 0.444
        + app * 185
        + ds_second * 175
        + ds_piece * 450
        + garbage_eff * 315
    )

    sr_area = 135 * pps + 290 * app + 700 * ds_piece
    if sr_area == 0:
        raise ValueError("SRArea is zero")

    st_rank = 11.2 * math.atan((sr_area - 93) / 130) + 1
    if st_rank <= 0:
        st_rank = 0.001

    n_apm = (apm / sr_area) / ((0.069 * 1.0017 ** ((st_rank**5) / 4700)) + st_rank / 360)
    n_pps = (pps / sr_area) / (
        0.0084264 * (2.14 ** (-2 * (st_rank / 2.7 + 1.03))) - st_rank / 5750 + 0.0067
    )
    n_app = app / (0.1368803292 * 1.0024 ** ((st_rank**5) / 2800) + st_rank / 54)
    n_ds_piece = ds_piece / (
        0.02136327583 * (14 ** ((st_rank - 14.75) / 3.9)) + st_rank / 152 + 0.022
    )
    n_garbage_eff = garbage_eff / (
        st_rank / 350 + 0.005948424455 * 3.8 ** ((st_rank - 6.1) / 4) + 0.006
    )
    n_ds = vs_apm / (-(((st_rank - 16) / 36) ** 2) + 2.133)

    opener = (
        ((n_apm - 1) + ((n_pps - 1) * 0.75) + ((n_ds - 1) * -10) + ((n_app - 1) * 0.75) + ((n_ds_piece - 1) * -0.25))
        / 3.5
    ) + 0.5
    stride = ((n_apm - 1) * -0.25 + (n_pps - 1) + (n_app - 1) * -2 + (n_ds_piece - 1) * -0.5) * 0.79 + 0.5
    plonk = ((n_garbage_eff - 1) + (n_app - 1) + (n_ds_piece - 1) * 0.75 + (n_pps - 1) * -1) / 2.73 + 0.5
    inf_ds = ((n_ds_piece - 1) + (n_app - 1) * -0.75 + (n_apm - 1) * 0.5 + (n_ds - 1) * 1.5 + (n_pps - 1) * 0.5) * 0.9 + 0.5
    est_tr = estimate_tr_tetrastats(pps, app, ds_piece, vs_apm, glicko_sigma, games_won)

    raw = {
        "APP": app,
        "DS/Piece": ds_piece,
        "APP+DS/Piece": app_ds_piece,
        "DS/Second": ds_second,
        "VS/APM": vs_apm,
        "Garbage Effi.": garbage_eff,
        "Cheese Index": cheese_index,
        "Weighted APP": weighted_app,
        "Area": area,
        "Est. TR": est_tr,
        "Opener": opener,
        "Plonk": plonk,
        "Stride": stride,
        "Inf DS": inf_ds,
        "Stride - Plonk": stride - plonk,
        "Opener - Inf DS": opener - inf_ds,
    }
    return {
        f"{output_prefix}{name}": fmt(raw[name], BASE_PARAM_ROUNDING[name])
        for name in BASE_PARAM_COLUMNS
    }


def cumulative_match_wins(rows: list[dict[str, Any]], win_result: str) -> dict[int, int]:
    cumulative_by_index: dict[int, int] = {}
    seen_match_ids: set[str] = set()
    wins = 0

    for index, row in enumerate(rows):
        match_id = str(row.get("match_id") or "").strip()
        if not match_id:
            match_id = f"__row_{index}"

        if match_id not in seen_match_ids:
            seen_match_ids.add(match_id)
            if str(row.get("match_result") or "").strip().lower() == win_result:
                wins += 1

        cumulative_by_index[index] = wins

    return cumulative_by_index


def enrich_round_rows(
    rows: list[dict[str, Any]],
    glicko_sigma_override: float | None = None,
    est_tr_games_won: float = DEFAULT_EST_TR_GAMES_WON,
) -> tuple[list[dict[str, Any]], tuple[int, int, int, int]]:
    return enrich_param_rows(
        rows,
        glicko_sigma_override,
        est_tr_games_won,
        target_source_prefix="",
        target_output_prefix="",
        opponent_source_prefix="opponent_",
        opponent_output_prefix="opponent_",
        target_blank_columns=BASE_PARAM_COLUMNS,
        opponent_blank_columns=OPPONENT_PARAM_COLUMNS,
    )


def enrich_match_rows(
    rows: list[dict[str, Any]],
    glicko_sigma_override: float | None = None,
    est_tr_games_won: float = DEFAULT_EST_TR_GAMES_WON,
) -> tuple[list[dict[str, Any]], tuple[int, int, int, int]]:
    return enrich_param_rows(
        rows,
        glicko_sigma_override,
        est_tr_games_won,
        target_source_prefix="target_match_",
        target_output_prefix="target_match_",
        opponent_source_prefix="opponent_match_",
        opponent_output_prefix="opponent_match_",
        target_blank_columns=[f"target_match_{column}" for column in BASE_PARAM_COLUMNS],
        opponent_blank_columns=[f"opponent_match_{column}" for column in BASE_PARAM_COLUMNS],
    )


def enrich_param_rows(
    rows: list[dict[str, Any]],
    glicko_sigma_override: float | None,
    est_tr_games_won: float,
    target_source_prefix: str,
    target_output_prefix: str,
    opponent_source_prefix: str,
    opponent_output_prefix: str,
    target_blank_columns: list[str],
    opponent_blank_columns: list[str],
) -> tuple[list[dict[str, Any]], tuple[int, int, int, int]]:
    updated = 0
    skipped = 0
    opponent_updated = 0
    opponent_skipped = 0

    enriched_rows = [dict(row) for row in rows]
    for index, row in enumerate(enriched_rows):
        try:
            row.update(
                calculate_params(
                    row,
                    glicko_sigma_for_row(row, "", glicko_sigma_override),
                    est_tr_games_won,
                    source_prefix=target_source_prefix,
                    output_prefix=target_output_prefix,
                )
            )
            updated += 1
        except (OverflowError, ValueError, ZeroDivisionError):
            for column in target_blank_columns:
                row[column] = ""
            skipped += 1

        try:
            row.update(
                calculate_params(
                    row,
                    glicko_sigma_for_row(row, "opponent_", glicko_sigma_override),
                    est_tr_games_won,
                    source_prefix=opponent_source_prefix,
                    output_prefix=opponent_output_prefix,
                )
            )
            opponent_updated += 1
        except (OverflowError, ValueError, ZeroDivisionError):
            for column in opponent_blank_columns:
                row[column] = ""
            opponent_skipped += 1

    return enriched_rows, (updated, skipped, opponent_updated, opponent_skipped)


def prefixed(values: dict[str, Any], prefix: str) -> dict[str, Any]:
    return {f"{prefix}_{key}": value for key, value in values.items()}


def prisecter_string(entry: dict[str, Any]) -> str | None:
    p = entry.get("p")

    if not isinstance(p, dict):
        return None

    try:
        return f'{p["pri"]}:{p["sec"]}:{p["ter"]}'
    except KeyError:
        return None


def iso_to_jst(value: str | None) -> str:
    if not value:
        return ""

    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.astimezone(JST).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value


def now_epoch_seconds() -> int:
    return int(time.time())


def normalize_cache_epoch(value: Any) -> int | None:
    try:
        epoch = int(value)
    except (TypeError, ValueError):
        return None
    if epoch > 10_000_000_000:
        epoch //= 1000
    return epoch


def api_cache_meta_path(raw_output: Path) -> Path:
    return raw_output.with_suffix(raw_output.suffix + ".cache.json")


def read_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_cached_records(
    raw_output: Path,
    username: str,
    max_matches: int | None,
) -> list[dict[str, Any]] | None:
    meta_path = api_cache_meta_path(raw_output)
    if not raw_output.is_file() or not meta_path.is_file():
        return None

    try:
        meta = read_json_file(meta_path)
        cached_until = normalize_cache_epoch(meta.get("cached_until"))
        cached_max_matches = meta.get("max_matches")
        cached_username = str(meta.get("username") or "").lower()
        records = read_json_file(raw_output)
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(records, list):
        return None
    if cached_username != username.lower():
        return None
    if cached_until is None or cached_until <= now_epoch_seconds():
        return None
    if cached_max_matches != max_matches and cached_max_matches is not None:
        if max_matches is None or int(cached_max_matches) < max_matches:
            return None

    if max_matches:
        records = records[:max_matches]
    print(
        "Using cached TETR.IO API data "
        f"(valid until {datetime.fromtimestamp(cached_until, JST):%Y-%m-%d %H:%M:%S} JST)"
    )
    return records


def write_api_cache_meta(
    raw_output: Path,
    username: str,
    max_matches: int | None,
    records: list[dict[str, Any]],
    cached_until: int | None,
) -> None:
    if cached_until is None:
        return
    raw_output.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "username": username,
        "max_matches": max_matches,
        "record_count": len(records),
        "cached_until": cached_until,
        "updated_at": datetime.now(JST).isoformat(timespec="seconds"),
    }
    api_cache_meta_path(raw_output).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_session_id(username: str, output_dir: str | Path | None = None) -> str:
    base = Path(output_dir) if output_dir else Path(".")
    path = base / SESSION_ID_FILENAME
    now = now_epoch_seconds()
    sessions: dict[str, Any] = {}
    try:
        data = read_json_file(path)
        if isinstance(data.get("sessions"), dict):
            sessions = data["sessions"]
            entry = sessions.get(username, {})
        else:
            entry = data
        session_id = str(entry.get("session_id") or "")
        created_at = int(entry.get("created_at") or 0)
        if session_id and now - created_at < SESSION_ID_TTL_SECONDS:
            return session_id
    except (OSError, json.JSONDecodeError, ValueError):
        pass

    session_id = str(uuid.uuid4())
    sessions[username] = {"session_id": session_id, "created_at": now}
    try:
        path.write_text(
            json.dumps({"sessions": sessions}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    return session_id


def request_tetrio_api(
    session: requests.Session,
    url: str,
    params: dict[str, str | int],
) -> requests.Response:
    for attempt in range(API_MAX_RETRIES + 1):
        response = session.get(url, params=params, timeout=30)
        if response.status_code not in API_RETRY_STATUSES:
            response.raise_for_status()
            return response

        if attempt >= API_MAX_RETRIES:
            response.raise_for_status()

        retry_after = response.headers.get("Retry-After")
        try:
            wait_seconds = float(retry_after) if retry_after else 0.0
        except ValueError:
            wait_seconds = 0.0
        if wait_seconds <= 0:
            wait_seconds = API_BACKOFF_SECONDS * (2 ** attempt)

        print(
            "TETR.IO API returned "
            f"HTTP {response.status_code}; retrying in {wait_seconds:.1f}s"
        )
        time.sleep(wait_seconds)

    raise RuntimeError("TETR.IO API retry loop ended unexpectedly")


def fetch_all_league_records(
    username: str,
    max_matches: int | None = None,
    output_dir: str | Path | None = None,
) -> tuple[list[dict[str, Any]], int | None]:
    session = requests.Session()
    session.headers.update({
        "X-Session-ID": load_session_id(username, output_dir),
        "User-Agent": USER_AGENT,
    })

    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_after: set[str] = set()
    after: str | None = None
    cached_until_values: list[int] = []

    while True:
        params: dict[str, str | int] = {"limit": PAGE_SIZE}

        if after:
            params["after"] = after

        url = (
            f"{BASE_URL}/users/"
            f"{requests.utils.quote(username.lower())}/records/league/recent"
        )

        response = request_tetrio_api(session, url, params)

        payload = response.json()
        cache_info = payload.get("cache", {})
        cached_until = normalize_cache_epoch(cache_info.get("cached_until"))
        if cached_until is not None:
            cached_until_values.append(cached_until)

        if not payload.get("success"):
            error = payload.get("error", {})
            raise RuntimeError(
                error.get("msg")
                or error.get("message")
                or "TETR.IO API request failed"
            )

        entries = payload.get("data", {}).get("entries", [])

        if not entries:
            break

        added = 0
        for record in entries:
            record_id = str(record.get("_id", ""))

            if record_id and record_id in seen_ids:
                continue

            if record_id:
                seen_ids.add(record_id)

            records.append(record)
            added += 1

        print(f"Fetched: {len(records)} matches")

        if max_matches and len(records) >= max_matches:
            del records[max_matches:]
            break

        if len(entries) < PAGE_SIZE:
            break

        next_after = prisecter_string(entries[-1])

        if not next_after or next_after in seen_after:
            break

        seen_after.add(next_after)
        after = next_after
        time.sleep(1.05)

    return records, min(cached_until_values) if cached_until_values else None


def validate_username(username: str) -> str:
    username = username.strip().lower()
    if not username or username == USERNAME:
        raise SystemExit("Please specify a TETR.IO username with --username.")
    return username


def find_player(
    players: list[dict[str, Any]],
    username: str,
    player_id: str | None = None,
) -> dict[str, Any] | None:
    if player_id:
        target_id = str(player_id)
        by_id = next(
            (
                player
                for player in players
                if str(player.get("id", "")) == target_id
            ),
            None,
        )
        if by_id:
            return by_id

    username_lower = username.lower()

    return next(
        (
            player
            for player in players
            if str(player.get("username", "")).lower() == username_lower
        ),
        None,
    )


def infer_target_player_id(
    records: list[dict[str, Any]],
    username: str,
) -> str | None:
    username_lower = username.lower()
    matching_ids: dict[str, int] = {}
    all_ids: dict[str, int] = {}

    for record in records:
        leaderboard = nested(record, "results", "leaderboard", default=[])
        if not isinstance(leaderboard, list):
            continue

        for player in leaderboard:
            if not isinstance(player, dict):
                continue

            player_id = str(player.get("id", ""))
            if not player_id:
                continue

            all_ids[player_id] = all_ids.get(player_id, 0) + 1
            if str(player.get("username", "")).lower() == username_lower:
                matching_ids[player_id] = matching_ids.get(player_id, 0) + 1

    if matching_ids:
        return max(matching_ids, key=matching_ids.get)

    if all_ids:
        return max(all_ids, key=all_ids.get)

    return None


def flatten_stats(player: dict[str, Any] | None, prefix: str = "") -> dict[str, Any]:
    if not player:
        stats: dict[str, Any] = {}
    else:
        raw_stats = player.get("stats") or {}
        stats = raw_stats if isinstance(raw_stats, dict) else {}

    row = {f"{prefix}{name}": first_nested(stats, *paths) for name, paths in STAT_FIELDS.items()}
    row[f"{prefix}stats_json"] = json_cell(stats)
    return row


def flatten_player_metadata(player: dict[str, Any] | None, prefix: str) -> dict[str, Any]:
    player = player or {}
    return {
        f"{prefix}id": player.get("id"),
        f"{prefix}username": player.get("username"),
        f"{prefix}active": player.get("active"),
        f"{prefix}naturalorder": player.get("naturalorder"),
        f"{prefix}shadowed_by_json": json_cell(player.get("shadowedBy")),
        f"{prefix}shadows_json": json_cell(player.get("shadows")),
        f"{prefix}player_json": json_cell(player),
    }


def flatten_profile(profile: dict[str, Any] | None, prefix: str) -> dict[str, Any]:
    profile = profile or {}
    return {
        f"{prefix}profile_id": profile.get("id"),
        f"{prefix}profile_username": profile.get("username"),
        f"{prefix}country": profile.get("country"),
        f"{prefix}supporter": profile.get("supporter"),
        f"{prefix}avatar_revision": profile.get("avatar_revision"),
        f"{prefix}banner_revision": profile.get("banner_revision"),
        f"{prefix}profile_json": json_cell(profile),
    }


def extract_league_metrics(
    record: dict[str, Any],
    player_id: str,
) -> dict[str, Any]:
    league_data = nested(record, "extras", "league", default={})
    values = league_data.get(player_id) if isinstance(league_data, dict) else None
    before = values[0] if isinstance(values, list) and len(values) > 0 and isinstance(values[0], dict) else {}
    after = values[1] if isinstance(values, list) and len(values) > 1 and isinstance(values[1], dict) else {}

    return {
        "tr_before": before.get("tr"),
        "tr_after": after.get("tr"),
        "tr_delta": metric_delta(before.get("tr"), after.get("tr")),
        "glicko_before": before.get("glicko"),
        "glicko_after": after.get("glicko"),
        "glicko_delta": metric_delta(before.get("glicko"), after.get("glicko")),
        "rd_before": before.get("rd"),
        "rd_after": after.get("rd"),
        "rd_delta": metric_delta(before.get("rd"), after.get("rd")),
        "league_rank_before": before.get("rank"),
        "league_rank_after": after.get("rank"),
        "placement_before": before.get("placement"),
        "placement_after": after.get("placement"),
        "placement_delta": metric_delta(before.get("placement"), after.get("placement")),
        "league_metrics_json": json_cell(values),
    }


def player_context(
    record: dict[str, Any],
    username: str,
    player_id: str | None = None,
) -> dict[str, Any] | None:
    leaderboard = nested(record, "results", "leaderboard", default=[])
    if not isinstance(leaderboard, list):
        return None

    target = find_player(leaderboard, username, player_id)
    if not target:
        return None

    target_id = str(target.get("id", ""))
    opponents = [
        player
        for player in leaderboard
        if str(player.get("id", "")) != target_id
    ]
    opponent = opponents[0] if opponents else {}
    opponent_id = str(opponent.get("id", "")) if opponent else ""

    otherusers = record.get("otherusers") or []
    profiles = {
        str(user.get("id", "")): user
        for user in otherusers
        if isinstance(user, dict)
    }

    target_wins = target.get("wins")
    opponent_wins = opponent.get("wins")
    if isinstance(target_wins, (int, float)) and isinstance(opponent_wins, (int, float)):
        if target_wins > opponent_wins:
            match_result = "win"
        elif target_wins < opponent_wins:
            match_result = "loss"
        else:
            match_result = "draw"
    else:
        match_result = ""

    return {
        "leaderboard": leaderboard,
        "target": target,
        "target_id": target_id,
        "opponent": opponent,
        "opponent_id": opponent_id,
        "target_wins": target_wins,
        "opponent_wins": opponent_wins,
        "match_result": match_result,
        "target_profile": profiles.get(target_id, {}),
        "opponent_profile": profiles.get(opponent_id, {}),
    }


def base_match_fields(
    record: dict[str, Any],
    match_number: int,
    context: dict[str, Any],
) -> dict[str, Any]:
    rounds = nested(record, "results", "rounds", default=[])
    p = record.get("p") or {}

    return {
        "match_number": match_number,
        "match_id": record.get("_id"),
        "replay_id": record.get("replayid"),
        "ts_utc": record.get("ts"),
        "played_at_jst": iso_to_jst(record.get("ts")),
        "gamemode": record.get("gamemode"),
        "disputed": record.get("disputed"),
        "pb": record.get("pb"),
        "oncepb": record.get("oncepb"),
        "stub": record.get("stub"),
        "p_pri": p.get("pri") if isinstance(p, dict) else None,
        "p_sec": p.get("sec") if isinstance(p, dict) else None,
        "p_ter": p.get("ter") if isinstance(p, dict) else None,
        "match_result": context["match_result"],
        "target_score": context["target_wins"],
        "opponent_score": context["opponent_wins"],
        "round_count": len(rounds) if isinstance(rounds, list) else None,
        "leaderboard_count": len(context["leaderboard"]),
        "otherusers_count": len(record.get("otherusers") or []),
        "target_id": context["target_id"],
        "target_username": context["target"].get("username"),
        "opponent": context["opponent"].get("username"),
        "opponent_id": context["opponent_id"],
        "revolution_json": json_cell(record.get("revolution")),
        "leaderboards_json": json_cell(record.get("leaderboards")),
        "otherusers_json": json_cell(record.get("otherusers")),
        "extras_json": json_cell(record.get("extras")),
        "results_leaderboard_json": json_cell(context["leaderboard"]),
        "raw_record_json": json_cell(record),
    }


def convert_to_match_rows(
    records: list[dict[str, Any]],
    username: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    records = sorted(records, key=lambda record: record.get("ts", ""))
    target_player_id = infer_target_player_id(records, username)

    for match_number, record in enumerate(records, start=1):
        context = player_context(record, username, target_player_id)
        if not context:
            continue

        row = base_match_fields(record, match_number, context)
        row.update(flatten_profile(context["target_profile"], "target_"))
        row.update(flatten_profile(context["opponent_profile"], "opponent_"))
        row.update(flatten_player_metadata(context["target"], "target_leaderboard_"))
        row.update(flatten_player_metadata(context["opponent"], "opponent_leaderboard_"))
        row["target_leaderboard_wins"] = context["target"].get("wins")
        row["opponent_leaderboard_wins"] = context["opponent"].get("wins")
        row.update(prefixed(flatten_stats(context["target"], "match_"), "target"))
        row.update(prefixed(flatten_stats(context["opponent"], "match_"), "opponent"))
        row.update(extract_league_metrics(record, context["target_id"]))
        row.update(prefixed(extract_league_metrics(record, context["opponent_id"]), "opponent"))
        rows.append(row)

    return rows


def convert_to_round_rows(
    records: list[dict[str, Any]],
    username: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    records = sorted(records, key=lambda record: record.get("ts", ""))
    target_player_id = infer_target_player_id(records, username)

    for match_number, record in enumerate(records, start=1):
        context = player_context(record, username, target_player_id)
        if not context:
            continue

        rounds = nested(record, "results", "rounds", default=[])
        if not isinstance(rounds, list):
            continue

        target_league = extract_league_metrics(record, context["target_id"])
        opponent_league = prefixed(
            extract_league_metrics(record, context["opponent_id"]),
            "opponent",
        )

        for round_number, round_players in enumerate(rounds, start=1):
            if not isinstance(round_players, list):
                continue

            round_target = next(
                (
                    player
                    for player in round_players
                    if str(player.get("id", "")) == context["target_id"]
                ),
                None,
            )
            if not round_target:
                round_target = find_player(round_players, username, target_player_id)
            if not round_target:
                continue

            round_opponent = next(
                (
                    player
                    for player in round_players
                    if context["opponent_id"] and str(player.get("id", "")) == context["opponent_id"]
                ),
                None,
            )
            if not round_opponent:
                round_opponent = next(
                    (
                        player
                        for player in round_players
                        if str(player.get("id", "")) != str(round_target.get("id", ""))
                    ),
                    None,
                )

            row = {
                "match_number": match_number,
                "match_id": record.get("_id"),
                "replay_id": record.get("replayid"),
                "ts_utc": record.get("ts"),
                "played_at_jst": iso_to_jst(record.get("ts")),
                "gamemode": record.get("gamemode"),
                "match_result": context["match_result"],
                "target_score": context["target_wins"],
                "opponent_score": context["opponent_wins"],
                "target_id": context["target_id"],
                "target_username": context["target"].get("username"),
                "opponent": context["opponent"].get("username"),
                "opponent_id": context["opponent_id"],
                "round": round_number,
                "round_player_count": len(round_players),
                "round_players_json": json_cell(round_players),
                "round_won": round_target.get("alive"),
                "lifetime_ms": round_target.get("lifetime"),
                "opponent_round_won": round_opponent.get("alive") if round_opponent else None,
                "opponent_lifetime_ms": round_opponent.get("lifetime") if round_opponent else None,
            }
            row.update(target_league)
            row.update(opponent_league)
            row.update(flatten_player_metadata(round_target, "target_round_"))
            row.update(flatten_player_metadata(round_opponent, "opponent_round_"))
            row.update(flatten_stats(round_target))
            row.update(prefixed(flatten_stats(round_opponent), "opponent"))
            rows.append(row)

    return rows


def fieldnames_for(rows: list[dict[str, Any]]) -> list[str]:
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    return fieldnames


def save_csv(rows: list[dict[str, Any]], path: Path) -> None:
    if not rows:
        raise RuntimeError(f"No rows to save: {path}")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames_for(rows), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None:
            raise ValueError("Input CSV has no header")
        return list(reader.fieldnames), list(reader)


def save_parquet(rows: list[dict[str, Any]], path: Path) -> None:
    if not rows:
        raise RuntimeError(f"No rows to save: {path}")

    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ModuleNotFoundError as exc:
        raise RuntimeError("Parquet output requires pyarrow.") from exc

    fieldnames = fieldnames_for(rows)
    arrays = []
    for fieldname in fieldnames:
        values = [row.get(fieldname) for row in rows]
        try:
            arrays.append(pa.array(values))
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            arrays.append(
                pa.array(
                    [
                        None
                        if value is None
                        else json_cell(value)
                        if isinstance(value, (dict, list))
                        else str(value)
                        for value in values
                    ],
                    type=pa.string(),
                )
            )

    table = pa.Table.from_arrays(arrays, names=fieldnames)
    pq.write_table(table, path)


def read_parquet_rows(path: Path) -> tuple[list[str], list[dict[str, Any]]]:
    try:
        import pyarrow.parquet as pq
    except ModuleNotFoundError as exc:
        raise RuntimeError("Parquet input requires pyarrow.") from exc

    table = pq.read_table(path)
    return list(table.column_names), table.to_pylist()


def output_path_for(input_path: Path, output: Path | None, overwrite: bool) -> Path:
    if output and overwrite:
        raise ValueError("Use either --output or --overwrite, not both")
    if overwrite:
        return input_path
    if output:
        return output
    return input_path.with_name(f"{input_path.stem}_with_params{input_path.suffix}")


def enrich_file(
    input_path: Path,
    output_path: Path,
    glicko_sigma_override: float | None,
    est_tr_games_won: float = DEFAULT_EST_TR_GAMES_WON,
) -> tuple[int, int, int, int]:
    suffix = input_path.suffix.lower()
    if suffix == ".csv":
        fieldnames, rows = read_csv_rows(input_path)
        is_match_table = bool(rows and "target_match_apm" in rows[0])
        enriched_rows, result = (
            enrich_match_rows(rows, glicko_sigma_override, est_tr_games_won)
            if is_match_table
            else enrich_round_rows(rows, glicko_sigma_override, est_tr_games_won)
        )
        param_columns = MATCH_PARAM_COLUMNS if is_match_table else PARAM_COLUMNS
        for column in param_columns:
            if column not in fieldnames:
                fieldnames.append(column)
        output_rows = [{field: row.get(field) for field in fieldnames} for row in enriched_rows]
        save_csv(output_rows, output_path)
        return result

    if suffix == ".parquet":
        fieldnames, rows = read_parquet_rows(input_path)
        is_match_table = bool(rows and "target_match_apm" in rows[0])
        enriched_rows, result = (
            enrich_match_rows(rows, glicko_sigma_override, est_tr_games_won)
            if is_match_table
            else enrich_round_rows(rows, glicko_sigma_override, est_tr_games_won)
        )
        param_columns = MATCH_PARAM_COLUMNS if is_match_table else PARAM_COLUMNS
        for column in param_columns:
            if column not in fieldnames:
                fieldnames.append(column)
        output_rows = [{field: row.get(field) for field in fieldnames} for row in enriched_rows]
        save_parquet(output_rows, output_path)
        return result

    raise ValueError("Input must be .csv or .parquet")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export TETR.IO league records and derived round parameters."
    )
    parser.add_argument(
        "--source",
        choices=("api", "json"),
        default="api",
        help="Start from the TETR.IO API or from the existing raw JSON. Default: api.",
    )
    parser.add_argument(
        "--from-raw",
        action="store_true",
        help="Alias for --source json.",
    )
    parser.add_argument(
        "--username",
        "--player-id",
        default=USERNAME,
        help=(
            "TETR.IO username (player ID) to export. "
            f"Default: {USERNAME}."
        ),
    )
    parser.add_argument(
        "--max-matches",
        type=int,
        default=None,
        help=(
            "Maximum number of recent matches to fetch from the API. "
            "Use 0 (or --all) to fetch every available match. "
            "Default: all matches."
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Fetch every available match (overrides --max-matches).",
    )
    parser.add_argument(
        "--force-fetch",
        action="store_true",
        help="Ignore the short-lived API cache metadata and fetch from TETR.IO again.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory to write output files into. Default: current directory.",
    )
    parser.add_argument(
        "--output-layout",
        choices=("flat", "grouped"),
        default="flat",
        help=(
            "Output layout. 'flat' writes all files directly under --output-dir. "
            "'grouped' writes data/<user>/{raw,csv,parquet}. Default: flat."
        ),
    )
    parser.add_argument(
        "--outputs",
        choices=("all", "csv", "parquet"),
        default="all",
        help="Which tabular outputs to write. Default: all.",
    )
    parser.add_argument(
        "--no-params",
        action="store_true",
        help="Skip *_rounds_with_params CSV/Parquet outputs.",
    )
    parser.add_argument(
        "--no-base-outputs",
        action="store_true",
        help="Skip match/round files before *_with_params is added.",
    )
    parser.add_argument(
        "--glicko-sigma",
        "--rd",
        type=float,
        default=None,
        help=(
            "Fixed Glicko RD used for Est. TR. "
            f"Default: {DEFAULT_GLICKO_SIGMA}, matching TetraStats noTrRd for aggregate stats."
        ),
    )
    parser.add_argument(
        "--est-tr-games-won",
        type=float,
        default=DEFAULT_EST_TR_GAMES_WON,
        help=(
            "gameswon input used by the Est. TR formula, corresponding to BN2 in the workbook. "
            f"Default: {DEFAULT_EST_TR_GAMES_WON}."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = "json" if args.from_raw else args.source
    username = validate_username(args.username)

    paths = build_output_paths(username, args.output_dir, args.output_layout)
    if args.output_dir:
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    raw_output = paths["raw"]
    raw_output.parent.mkdir(parents=True, exist_ok=True)

    # Resolve the fetch limit: --all or --max-matches 0 means "every match".
    max_matches = None if (args.all or not args.max_matches) else args.max_matches

    if source == "json":
        records = read_json_file(raw_output)
    else:
        records = None if args.force_fetch else load_cached_records(raw_output, username, max_matches)
        if records is None:
            records, cached_until = fetch_all_league_records(
                username, max_matches, raw_output.parent
            )
            raw_output.parent.mkdir(parents=True, exist_ok=True)
            raw_output.write_text(
                json.dumps(records, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            write_api_cache_meta(raw_output, username, max_matches, records, cached_until)

    match_rows = convert_to_match_rows(records, username)
    round_rows = convert_to_round_rows(records, username)
    match_param_result: tuple[int, int, int, int] | None = None
    round_param_result: tuple[int, int, int, int] | None = None
    match_param_rows: list[dict[str, Any]] = []
    round_param_rows: list[dict[str, Any]] = []
    if not args.no_params:
        match_param_rows, match_param_result = enrich_match_rows(
            match_rows,
            args.glicko_sigma,
            args.est_tr_games_won,
        )
        round_param_rows, round_param_result = enrich_round_rows(
            round_rows,
            args.glicko_sigma,
            args.est_tr_games_won,
        )

    if args.outputs in ("all", "csv"):
        if not args.no_base_outputs:
            save_csv(match_rows, paths["match_csv"])
            save_csv(round_rows, paths["round_csv"])
        if not args.no_params:
            save_csv(match_param_rows, paths["match_params_csv"])
            save_csv(round_param_rows, paths["round_params_csv"])

    if args.outputs in ("all", "parquet"):
        if not args.no_base_outputs:
            save_parquet(match_rows, paths["match_parquet"])
            save_parquet(round_rows, paths["round_parquet"])
        if not args.no_params:
            save_parquet(match_param_rows, paths["match_params_parquet"])
            save_parquet(round_param_rows, paths["round_params_parquet"])

    print()
    print(f"Player: {username}")
    print(f"Matches: {len(match_rows)}")
    print(f"Rounds: {len(round_rows)}")
    print(f"Raw JSON: {raw_output.resolve()}")
    if args.outputs in ("all", "csv"):
        if not args.no_base_outputs:
            print(f"Match CSV: {paths['match_csv'].resolve()}")
            print(f"Round CSV: {paths['round_csv'].resolve()}")
        if not args.no_params:
            print(f"Match params CSV: {paths['match_params_csv'].resolve()}")
            print(f"Round params CSV: {paths['round_params_csv'].resolve()}")
    if args.outputs in ("all", "parquet"):
        if not args.no_base_outputs:
            print(f"Match Parquet: {paths['match_parquet'].resolve()}")
            print(f"Round Parquet: {paths['round_parquet'].resolve()}")
        if not args.no_params:
            print(f"Match params Parquet: {paths['match_params_parquet'].resolve()}")
            print(f"Round params Parquet: {paths['round_params_parquet'].resolve()}")
    if match_param_result is not None:
        updated, skipped, opponent_updated, opponent_skipped = match_param_result
        rd_source = args.glicko_sigma if args.glicko_sigma is not None else f"aggregate default {DEFAULT_GLICKO_SIGMA}"
        print(f"Glicko RD source: {rd_source}")
        print(f"Est. TR gameswon: {args.est_tr_games_won}")
        print(f"Updated match rows: {updated}")
        print(f"Skipped match rows: {skipped}")
        print(f"Updated opponent match rows: {opponent_updated}")
        print(f"Skipped opponent match rows: {opponent_skipped}")
    if round_param_result is not None:
        updated, skipped, opponent_updated, opponent_skipped = round_param_result
        print(f"Updated round rows: {updated}")
        print(f"Skipped round rows: {skipped}")
        print(f"Updated opponent round rows: {opponent_updated}")
        print(f"Skipped opponent round rows: {opponent_skipped}")


if __name__ == "__main__":
    main()
