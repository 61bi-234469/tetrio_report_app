# TETR.IO 戦績レポート作成ツール

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6)
![Status](https://img.shields.io/badge/Status-Unofficial-lightgrey)

tetr.io の Tetra League 戦績を TETRA CHANNEL API から取得し、HTML 分析レポートを生成する Windows 向けツールです。
プレイヤーIDと取得試合数を GUI で指定し、API取得、派生指標の計算、HTMLレポート生成までをまとめて実行できます。

本ツールは非公式です。TETR.IO / osk とは関係ありません。"TETR.IO" は権利者の商標です。

## 動作条件

- Windows 10 / 11
- Python 3.10 以降
- PowerShell 5.1 以降
- インターネット接続

Python は `py -3` または `python` で起動できる状態にしてください。GUI 初回実行時に、レポート生成用の仮想環境と依存パッケージを自動で準備します。

## 準備

1. このリポジトリを任意のフォルダーへ展開します。
2. PowerShell で次を実行し、Python が使えることを確認します。

```powershell
py -3 --version
```

3. 実行ポリシーで PowerShell スクリプトが止まる場合は、現在のユーザーだけ許可します。

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## GUIで使う

1. `レポート作成GUI.bat` をダブルクリックします。
2. プレイヤーIDと取得試合数を入力します。
3. 必要な実行内容をチェックします。
4. `実行` をクリックします。

標準設定では、TETR.IOから戦績データを取得し、HTMLレポートを作成して、完了後にブラウザーで開きます。

## GUIの主な項目

- `取得できる全試合を対象にする`: 試合数の上限を使わず、取得可能な Tetra League 履歴を対象にします。
- `TETR.IOから戦績データを取得する`: APIからデータを取得し、レポート用の Parquet を作成します。
- `取得済みデータからHTMLレポートを作成する`: 保存済み Parquet からHTMLレポートを作成します。
- `作成後にレポートをブラウザーで開く`: 生成したレポートを既定のブラウザーで開きます。
- `Parquetに加えてCSV形式でも保存する`: 確認や表計算ソフト用にCSVも出力します。
- `派生指標を追加する前の元データも残す`: API取得直後の中間データも保存します。
- `AI分析用のプロンプトと集計JSONをレポートと一緒に保存する`: 外部AIで追加分析するための軽量データを保存します。

## コマンドで使う

GUI を使わずに実行する場合は、先にレポートビルダー用の仮想環境を準備します。

```powershell
py -3 -m venv "src\report_builder\.venv"
& "src\report_builder\.venv\Scripts\python.exe" -m pip install -r "src\report_builder\requirements.txt"
```

APIから直近100試合を取得します。

```powershell
& "src\report_builder\.venv\Scripts\python.exe" `
  "src\api_export\tetrio_league_export.py" `
  --source api --username your_username --max-matches 100 `
  --outputs all --output-dir "data"
```

取得済みデータからレポートを生成します。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -Open
```

## 出力

- API取得データ: `data`
- HTMLレポート: `reports`
- レポートビルダーの中間生成物: `src/report_builder/cache`, `src/report_builder/charts`, `src/report_builder/output`

取得データとレポートには、対戦相手のユーザー名、ID、成績が含まれます。共有前に内容を確認してください。

## 指標について

APP、DS/S、DS/P、GbE、Area、VS/APM などは保存済みの試合・ラウンドデータから計算します。
Est. TR、Opener / Stride / Inf DS / Plonk、Cheese Index、Weighted APP などの派生指標は、[TetraStats](https://github.com/dan63047/TetraStats) に由来する計算式として扱います。
これらは公式TETR.IO計算ではありません。

## ライセンスと帰属

このリポジトリのコードは MIT License です。詳細は `LICENSE` を参照してください。

直接依存パッケージのライセンス概要は `THIRD_PARTY_NOTICES.md` を参照してください。
