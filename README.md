# TETR.IO 戦績レポート作成ツール

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6)
![Status](https://img.shields.io/badge/Status-Unofficial-lightgrey)

tetr.io の Tetra League 戦績を TETRA CHANNEL API から取得し、HTML 分析レポートを生成する Windows 向けツールです。
プレイヤーIDと取得試合数を GUI で指定し、API取得、派生指標の計算、HTMLレポート生成までをまとめて実行できます。

本ツールは、**ツールが作る①戦績レポート（本体）**と、**外部AIに素材を渡して作る②AI考察レポート（別紙）**の2種類を作成できます。詳しくは「[2種類のレポート](#2種類のレポート)」を参照してください。

本ツールは非公式です。TETR.IO / osk とは関係ありません。"TETR.IO" は権利者の商標です。

## サンプルレポート

実際の出力イメージを以下で確認できます。

| レポート種別 | リンク |
|---|---|
| ① 戦績分析レポート（本体） | [サンプルを見る](https://htmlpreview.github.io/?https://github.com/61bi-234469/tetrio_report_app/blob/main/samples/sample_report.html) |
| ② AI考察レポート（別紙） | [サンプルを見る](https://htmlpreview.github.io/?https://github.com/61bi-234469/tetrio_report_app/blob/main/samples/sample_ai_report.html) |

---

## 2種類のレポート

本ツールには、ツールが作る**①戦績レポート（本体）**と、外部AIが作る**②AI考察レポート（別紙）**があります。①が主役で、②は本体の数値を読み解く追加の別紙という位置づけです。

| | ① 戦績レポート（本体） | ② AI考察レポート（別紙） |
|---|---|---|
| 立ち位置 | 主役。数値と図表の本体 | 追加。本体を読み解く別紙 |
| 作る主体 | ツールが作る | 外部AIチャット、または連携AIエージェントCLI |
| AIの要否 | 不要 | 必要（AIチャット貼り付け、またはCodex CLI / Claude Code CLI） |
| 主な内容 | 指標の計算・表・グラフ・章立て解説 | 数値を踏まえた深掘りの考察・言語化 |
| 形式 | 自己完結HTML（1ファイル） | 自己完結HTML（別紙・1ファイル） |

### ① 戦績レポート（本体・ツールが作る）

ツールだけで生成する、外部依存のない単一HTMLレポートです。AIや外部サービスは不要です。

- 保存済みの試合・ラウンドデータから各指標を計算し、表・グラフ（matplotlibで生成しbase64で埋め込み）・章立ての解説を含むHTMLを出力します。
- 1ファイルで完結するため、そのまま閲覧・共有できます。
- GUIの「① 戦績レポート（本体・HTML）を作成する」、またはコマンドの `make_report.ps1` で生成します。
- 出力先: `reports`

### ② AI考察レポート（別紙・AIが作る）

①本体とは別に、ローカルで集計済みのデータを根拠にAIへ本文だけを書かせる、定性的な分析レポートです。AIへ渡す主入力は `ai_appendix_data.json` の1種類です。推論レベル設定は、AIエージェントCLIで自動作成するときだけ使います。作成方法は2つから選べます。

**作成方法A: AIチャット用素材を保存（`manual_chat`）**

ツールが次の素材を書き出します。これらを任意のAIチャットへ渡し、AIチャット側で②AI考察レポートHTMLを作成します。

1. **AI用JSON** — `ai_appendix_data.json` の1種類。
2. **プロンプト** — `prompt_chat.md`（AIチャット用）。

**作成方法B: AIエージェントCLIで自動作成（`agent_cli`）**

[Codex CLI](https://github.com/openai/codex) または [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) を非対話で呼び出し、本文JSONの生成から②HTML生成までをツール側で進めます。CLI未インストールや認証未設定、実行失敗時は、①本体HTMLを保持したまま、作成方法Aの素材へ自動的に切り替えられます。

- HTML・CSS・フッター・NOTICE文言はローカル側で生成し、AIには本文（headline / body / notes）だけを書かせます。
- GUIの「② AI考察レポートを作る」、またはコマンドの `make_report.ps1 -PrepareAI`（方法A）/ `-GenerateAIReport`（方法B）で実行します。
- AIエージェントCLIの推論レベルは `standard`（標準）/ `high`（高）/ `low`（低）から選べます。
- 出力先: `reports`（GUI）/ `src/report_builder/cache/ai` と `src/report_builder/output`（コマンド）

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

標準設定では、TETR.IOから戦績データを取得し、HTMLレポートを作成して、完了後にブラウザーと保存先フォルダーを開きます。

## GUIの主な項目

- `取得できる全試合を対象にする`: 試合数の上限を使わず、取得可能な Tetra League 履歴を対象にします。
- `TETR.IOから戦績データを取得する`: APIからデータを取得し、レポート用の Parquet を `data\parquet` に作成します。
- `① 戦績レポート（本体・HTML）を作成する`: 保存済み Parquet から①戦績レポート（本体・HTML）を作成します。
- `② AI考察レポートを作る`: ②AI考察レポートを作成します。下の「② AI考察レポート設定」で作成方法・推論レベル・連携AIエージェントCLIを選べます。
- `作成後にレポートをブラウザーで開く`: 生成したレポートを既定のブラウザーで開きます。
- `作成後に保存先フォルダーを開く`: HTML保存先の `reports` フォルダーを開きます。
- `Parquetに加えてCSV形式でも保存する`: 確認や表計算ソフト用にCSVも出力します。
- `派生指標を追加する前の元データも残す`: API取得直後の中間データも保存します。
- 使用データの参照とハッシュは `src\report_builder\cache\latest_run_manifest.json` に記録します。
- `② AI考察レポート設定 > 作成方法`: 「AIチャット用素材を保存」または「AIエージェントCLIで自動作成」。
- `② AI考察レポート設定 > 推論レベル`: 「標準」「高」「低」。
- `② AI考察レポート設定 > 連携AIエージェントCLI`: 「Codex CLI」または「Claude Code CLI」（自動作成を選んだ場合だけ有効）。

## コマンドで使う

GUI を使わずに実行する場合は、先にレポートビルダー用の仮想環境を準備します。

```powershell
py -3 -m venv "src\report_builder\.venv"
& "src\report_builder\.venv\Scripts\python.exe" -m pip install -r "src\report_builder\requirements.txt"
```

APIから直近100試合を取得します。コマンド実行では、互換性のため既定では `data` 直下へ従来どおり保存します。GUIと同じ `data\raw|csv|parquet` 構成にする場合は `--output-layout typed` を付けます。

```powershell
& "src\report_builder\.venv\Scripts\python.exe" `
  "src\api_export\tetrio_league_export.py" `
  --source api --username your_username --max-matches 100 `
  --outputs all --output-dir "data" --output-layout typed
```

取得済みデータから①戦績レポート（本体・HTML）を生成します。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\parquet\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\parquet\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -Open
```

②AI考察レポート用の素材（AI用JSON・プロンプト）をAIチャット貼り付け手順向けに書き出す場合は `-PrepareAI` を付けます。AI用JSONは `ai_appendix_data.json` です。素材は `src/report_builder/cache/ai` に出力されます。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\parquet\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\parquet\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -PrepareAI
```

連携AIエージェントCLI（Codex CLI / Claude Code CLI）で②AI考察レポートを自動作成する場合は `-GenerateAIReport` を使います。`-AIAgent` で `codex` / `claude` を、`-AIReasoningLevel` で推論レベルを選びます。`-AIQuality` は互換エイリアスです。CLI実行が失敗しても①本体HTMLは保持され、`cache/ai` の素材でAIチャット貼り付け手順へ切り替えられます。

```powershell
& "src\report_builder\make_report.ps1" `
  -DataFile "data\parquet\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "data\parquet\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -GenerateAIReport -AIAgent codex -AIReasoningLevel standard
```

## 出力

- GUIのAPI取得データ: `data\raw`, `data\parquet`, `data\csv`
- コマンドのAPI取得データ: 既定は `data` 直下。`--output-layout typed` 指定時はGUIと同じ階層です。旧 `--output-layout grouped` も読み取り互換用に残しています。
- GUIの成果物: `reports\<player>_report_<yyyy_mm_dd_HHmm>.html`、`reports\<player>_ai_report_<yyyy_mm_dd_HHmm>.html`
- 実行情報: `src\report_builder\cache\latest_run_manifest.json`
- コマンドの①戦績レポート（本体・HTML）: `src/report_builder/output`
- ②AI考察レポート:
  - HTML（方法B・自動作成が成功した場合）: `reports`（GUI）/ `src/report_builder/output`（コマンド）
  - AI用JSON・プロンプト: `src/report_builder/cache/ai`
- レポートビルダーの中間生成物: `src/report_builder/cache`, `src/report_builder/charts`, `src/report_builder/output`

取得データとレポートには、対戦相手のユーザー名、ID、成績が含まれます。共有前に内容を確認してください。

## 指標について

APP、DS/S、DS/P、GbE、Area、VS/APM などは保存済みの試合・ラウンドデータから計算します。
Est. TR、Opener / Stride / Inf DS / Plonk、Cheese Index、Weighted APP などの派生指標は、[TetraStats](https://github.com/dan63047/TetraStats) に由来する計算式として扱います。
これらは公式TETR.IO計算ではありません。

## ライセンスと帰属

このリポジトリのコードは MIT License です。詳細は `LICENSE` を参照してください。

直接依存パッケージのライセンス概要は `THIRD_PARTY_NOTICES.md` を参照してください。
