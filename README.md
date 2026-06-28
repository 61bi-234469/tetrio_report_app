# TETR.IO 戦績レポート作成ツール

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6)
![Status](https://img.shields.io/badge/Status-Unofficial-lightgrey)

tetr.io の Tetra League 戦績を TETRA CHANNEL API から取得し、HTML 分析レポートを生成する Windows 向けツールです。
プレイヤーIDと取得試合数を GUI で指定し、API取得、派生指標の計算、HTMLレポート生成までをまとめて実行できます。

本ツールは、**ツールが作る①戦績レポート（本体）**と、**外部AIに素材を渡して作る②AI考察レポート（別紙）**の2種類を作成できます。詳しくは「[2種類のレポート](#2種類のレポート)」を参照してください。

本ツールは非公式です。TETR.IO / osk とは関係ありません。"TETR.IO" は権利者の商標です。

## 2種類のレポート

本ツールには、ツールが作る**①戦績レポート（本体）**と、外部AIが作る**②AI考察レポート（別紙）**があります。①が主役で、②は本体の数値を読み解く追加の別紙という位置づけです。

| | ① 戦績レポート（本体） | ② AI考察レポート（別紙） |
|---|---|---|
| 立ち位置 | 主役。数値と図表の本体 | 追加。本体を読み解く別紙 |
| 作る主体 | ツールが作る | 外部の生成AIが作る |
| AIの要否 | 不要 | 必要（外部の生成AI。コード実行は不要） |
| 主な内容 | 指標の計算・表・グラフ・章立て解説 | 数値を踏まえた深掘りの考察・言語化 |
| 形式 | 自己完結HTML（1ファイル） | 自己完結HTML（別紙・1ファイル） |

### ① 戦績レポート（本体・ツールが作る）

ツールだけで生成する、外部依存のない単一HTMLレポートです。AIや外部サービスは不要です。

- 保存済みの試合・ラウンドデータから各指標を計算し、表・グラフ（matplotlibで生成しbase64で埋め込み）・章立ての解説を含むHTMLを出力します。
- 1ファイルで完結するため、そのまま閲覧・共有できます。
- GUIの「① 戦績レポート（本体・HTML）を作成する」、またはコマンドの `make_report.ps1` で生成します。
- 出力先: `reports`

### ② AI考察レポート（別紙・外部AIが作る）

①本体とは別に、外部の生成AIへ素材一式を渡して作る、定性的な分析レポートです。深掘りの考察や言語化を外部AIに任せたい場合に使います。ツールが次の2つの素材を書き出します。

1. **別紙用プロンプト** — 分析手順に加え、出力用のHTMLテンプレート（雛形・CSS）も中に含むプロンプト（`src/report_builder/prompts/`。GUI出力時は `reports/<player>_ai_appendix_prompt.md`）。
2. **別紙用集計データ（軽量JSON）** — 集計済みの数値だけを含む軽量データ（CSV・CSS・画像は含みません。GUI出力時は `reports/<player>_ai_appendix_data.json`）。

この2点を外部の生成AIに渡すと、AIがプロンプト内のHTMLテンプレートに沿って、数値を踏まえた別紙の自己完結HTMLレポートを生成します（コード実行は不要で、軽量JSONとプロンプト内のHTMLテンプレートだけで完結します）。

- GUIの「② AI考察レポート（別紙）用の素材を保存する」、またはコマンドの `make_report.ps1 -PrepareAI` で素材を書き出します。
- 出力先: `reports`（GUI）/ `src/report_builder/output`（コマンド）

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
- `① 戦績レポート（本体・HTML）を作成する`: 保存済み Parquet から①戦績レポート（本体・HTML）を作成します。
- `作成後にレポートをブラウザーで開く`: 生成したレポートを既定のブラウザーで開きます。
- `Parquetに加えてCSV形式でも保存する`: 確認や表計算ソフト用にCSVも出力します。
- `派生指標を追加する前の元データも残す`: API取得直後の中間データも保存します。
- `② AI考察レポート（別紙）用の素材を保存する`: ②AI考察レポート（別紙）を外部AIで作るための素材（別紙用プロンプトと軽量な集計データ）を `reports` に保存します。

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

取得済みデータから①戦績レポート（本体・HTML）を生成します。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -Open
```

②AI考察レポート（別紙）用の素材（軽量な集計データ）も書き出す場合は `-PrepareAI` を付けます。別紙用プロンプト（出力用のHTMLテンプレートを含む）は `src/report_builder/prompts/` にあります。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -PrepareAI
```

## 出力

- API取得データ: `data`
- ①戦績レポート（本体・HTML）: `reports`
- ②AI考察レポート（別紙）用の素材（別紙用プロンプト〔HTMLテンプレートを含む〕・軽量な集計データ）:
  - GUI: 別紙用プロンプトと軽量な集計データの両方を `reports` に保存します。
  - コマンド `-PrepareAI`: 軽量な集計データ（JSON）のみ `src/report_builder/output` に出力します。別紙用プロンプトは出力されないため、`src/report_builder/prompts/prompt_recommendations.md` をそのまま使ってください。
- レポートビルダーの中間生成物: `src/report_builder/cache`, `src/report_builder/charts`, `src/report_builder/output`

取得データとレポートには、対戦相手のユーザー名、ID、成績が含まれます。共有前に内容を確認してください。

## 指標について

APP、DS/S、DS/P、GbE、Area、VS/APM などは保存済みの試合・ラウンドデータから計算します。
Est. TR、Opener / Stride / Inf DS / Plonk、Cheese Index、Weighted APP などの派生指標は、[TetraStats](https://github.com/dan63047/TetraStats) に由来する計算式として扱います。
これらは公式TETR.IO計算ではありません。

## ライセンスと帰属

このリポジトリのコードは MIT License です。詳細は `LICENSE` を参照してください。

直接依存パッケージのライセンス概要は `THIRD_PARTY_NOTICES.md` を参照してください。
