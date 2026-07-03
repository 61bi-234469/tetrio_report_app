from __future__ import annotations

import argparse
from pathlib import Path

from tetrio_league_export import (
    DEFAULT_EST_TR_GAMES_WON,
    DEFAULT_GLICKO_SIGMA,
    ROUND_CSV_OUTPUT,
    enrich_file,
    output_path_for,
)


DEFAULT_INPUT = Path(__file__).with_name(ROUND_CSV_OUTPUT.name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add TETR.IO derived parameters to a match or round CSV/Parquet file."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Input match/round CSV or Parquet path.")
    parser.add_argument("--output", type=Path, help="Output path. Defaults to *_with_params with the same suffix.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite the input file in place.")
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
    input_path = args.input.expanduser().resolve()
    output_path = output_path_for(
        input_path,
        args.output.expanduser().resolve() if args.output else None,
        args.overwrite,
    )

    updated, skipped, opponent_updated, opponent_skipped = enrich_file(
        input_path=input_path,
        output_path=output_path,
        glicko_sigma_override=args.glicko_sigma,
        est_tr_games_won=args.est_tr_games_won,
    )

    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    rd_source = args.glicko_sigma if args.glicko_sigma is not None else f"aggregate default {DEFAULT_GLICKO_SIGMA}"
    print(f"Glicko RD source: {rd_source}")
    print(f"Est. TR gameswon: {args.est_tr_games_won}")
    print(f"Updated rows: {updated}")
    print(f"Skipped rows: {skipped}")
    print(f"Updated opponent rows: {opponent_updated}")
    print(f"Skipped opponent rows: {opponent_skipped}")


if __name__ == "__main__":
    main()
