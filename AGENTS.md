# AGENTS.md


## Project Notes
- This is a Windows-oriented TETR.IO report generator. The root-level GUI `.bat` launcher (`レポート作成GUI.bat`) starts `src/tetrio_report_gui.pyw`.
- This is a public, MIT-licensed repository (`LICENSE`). It is an unofficial tool, not affiliated with TETR.IO / osk. Keep the unofficial notice, trademark note, and third-party formula attribution consistent across `NOTICE.md`, `README.md`, `THIRD_PARTY_NOTICES.md`, and the report footer when touching related text.
- Targets Windows 10/11, Python 3.10+, and PowerShell 5.1+. `python`/`py -3` must be on PATH.
- The main pipeline is: fetch Tetra League data with `src/api_export/tetrio_league_export.py`, enrich match and round data with derived TETR.IO metrics, then build an HTML report through `src/report_builder/make_report.ps1`.
- `src/report_builder/make_report.ps1` owns Python environment setup for the report builder. It creates `src/report_builder/.venv` when missing, installs `src/report_builder/requirements.txt`, and records the requirements hash in `src/report_builder/cache/.requirements.sha256`.
- The report builder accepts round-level CSV/Parquet input. When using API-exported data, pass the `_rounds_with_params.parquet` file as `-DataFile` and the matching `_matches_with_params.parquet` file as `-MatchesFile`.
- Generated chapter fragments are written to `src/report_builder/cache/generated/chapters/` and included from `src/report_builder/template/base.html`. The legacy `src/report_builder/content/chapters/` and `src/report_builder/content/partials/appendices.html` are kept only for local compatibility and are Git-ignored; do not author new content there.
- Generated and user-local paths include `data/`, `reports/`, `gui_config.json`, `docs/`, and `src/report_builder/{cache,charts,output,input,.venv}`. Treat these as reproducible or local runtime artifacts unless the user explicitly asks to inspect or preserve them. `docs/` holds local-only design notes and is Git-ignored.
- Do not commit downloaded TETR.IO data, generated HTML reports, chart PNGs, cache JSON/CSV files, or virtual environments.

## Personal Data Hygiene
- `your_username` is the placeholder player identifier. CLI/GUI/script defaults and README samples use it, and `tetrio_league_export.py` errors out if it is left unchanged at runtime (`validate_username`).
- Do not commit real TETR.IO handles, opponent data, or other personal identifiers into tracked source. Keep `your_username` as the default in scripts and docs.

## Common Commands
- Launch the GUI from the repository root with the root-level `.bat` launcher.
- Build a report from existing data with:
  `.\src\report_builder\make_report.ps1 -DataFile "data\<user>_tetra_league_rounds_with_params.parquet" -MatchesFile "data\<user>_tetra_league_matches_with_params.parquet" -Player "<label>"`
- Fetch API data directly with:
  `& "src\report_builder\.venv\Scripts\python.exe" "src\api_export\tetrio_league_export.py" --source api --username <user> --max-matches 100 --outputs all --output-dir "data"`
- `make_report.ps1` switches: `-Force` (ignore cache and rerun every stage), `-Open` (open the HTML in a browser when done), `-PrepareAI` (emit the legacy lightweight AI JSON plus the ② AI-report materials — quality-tiered chapter summaries, prompts, and `report_text_schema.json` under `cache/ai/`), `-GenerateAIReport` (auto-build the ② AI report via an agent CLI; pairs with `-AIAgent codex|claude`), `-AIQuality standard|high_quality|low_cost` (shared by `-PrepareAI` and `-GenerateAIReport`), `-Chapter 9,12` (limit the legacy `-PrepareAI` JSON to specific chapters, range 1-12), `-ExternalImages` (emit an extra `preview_yyyy_mm_dd.html` that references images externally). `-GenerateAIReport` failures (missing CLI, auth, validation) keep the ① report intact and leave `cache/ai/` materials for the manual chat fallback. Use `-Open` only when the user wants the report opened.

## Implementation Guidance
- Keep the GUI as a thin orchestrator around the API export and report builder scripts. Avoid duplicating analysis or rendering logic in `src/tetrio_report_gui.pyw`.
- Preserve UTF-8 subprocess handling in the GUI. It sets `PYTHONUTF8`, `PYTHONIOENCODING`, and `PYTHONUNBUFFERED` so child process output remains readable and streamed.
- Keep metric formulas and parameter column names centralized in `src/api_export/tetrio_league_export.py` and `src/report_builder/scripts/report_analysis.py`. If a derived metric changes, update both data export and report analysis paths only when the data contract requires it.
- Prefer focused validation by running the smallest relevant command: API-export changes should exercise `tetrio_league_export.py` or `add_tetra_league_params.py`; report-builder changes should exercise `make_report.ps1` or the specific script under `src/report_builder/scripts/`.

## Report Writing Style
- Use concise Japanese in desu/masu style for user-facing report text.
- Prefer direct statements about what the metric uses and what it shows. Avoid leading with limitations, negations, or exhaustive caveats.
- Good: `対戦前Glicko/RDを使った標準Glicko期待スコアで評価しています。`
- Avoid: `期待値はTETR.IO内部計算の完全再現ではなく、parquet内の対戦前Glicko/RDを使った標準Glicko期待スコアです。`
- Good: `保存済みデータから勝率を推定しています。`
- Avoid: `この勝率は実際のマッチメイキング仕様を再現したものではなく、保存済みデータから計算した推定値です。`
- Good: `RDが高いプレイヤーは評価のブレが大きくなります。`
- Avoid: `RDが高いプレイヤーは不確実性が大きいため、結果の解釈には注意が必要です。`

## Git And Delivery Rules
- Before making a commit, set the git author to `61bi-234469 <121346275+61bi-234469@users.noreply.github.com>`.
- Write commit messages in English (subject and body) so they read consistently in `git log`.
- Include the model name in commit messages so it is visible in `git log` (for example, a trailer such as `Model: GPT-5.5 Codex`).
- Do not push to any remote without explicit user confirmation immediately beforehand.
- If the worktree contains unrelated user changes, leave them intact and work around them.
