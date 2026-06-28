# Python / Parquet usage

TETR.IO戦績分析HTMLレポートを、最新の `matches_with_params.parquet` と
`rounds_with_params.parquet` から生成する入口です。

## Setup

```powershell
cd .\src\report_builder
.\make_report.ps1
```

## Build from the current input files

```powershell
python .\make_report.py `
  --input "..\..\data\your_username_tetra_league_rounds_with_params.parquet" `
  --matches "..\..\data\your_username_tetra_league_matches_with_params.parquet" `
  --player your_username
```

生成物:

```text
output/yyyy_mm_dd_your_username_tetrio_performance_report.html
cache/normalized_rounds.csv
cache/analysis_summary.json
cache/ai_analysis_payload.json
cache/monthly_summary.csv
cache/records.json
```

`rounds_with_params.parquet` だけでも必要列が揃っていれば実行できます。
`--matches` は、試合単位メタデータが欠けている場合の補完用です。

## AI向け軽量JSONも出す

```powershell
python .\make_report.py --input "...\rounds_with_params.parquet" --matches "...\matches_with_params.parquet" --prepare-ai
```

特定章だけ:

```powershell
python .\make_report.py --input "...\rounds_with_params.parquet" --matches "...\matches_with_params.parquet" --prepare-ai --chapter 7 8
```
