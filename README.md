# 戦績レポート for TETR.IO

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Status](https://img.shields.io/badge/Status-Unofficial-lightgrey)

tetr.io の Tetra League 戦績を TETRA CHANNEL API から取得し、12章構成のHTML分析レポートを生成するツールです（英語表記: League Report for TETR.IO）。

本ツールには2つの版があります。

| 版 | 場所 | 状態 |
|---|---|---|
| **Web版（現行）** | `web/` | 開発中。今後の機能追加はこちらに行います |
| **Python版（旧版）** | `python/` | 旧版。更新停止予定（保守のみ） |

本ツールは非公式です。TETR.IO / osk とは関係ありません。"TETR.IO" は権利者の商標です。

## サンプルレポート

実際の出力イメージを以下で確認できます。

| レポート種別 | リンク |
|---|---|
| Web版 戦績レポート（300試合・匿名化版） | [サンプルを見る](https://htmlpreview.github.io/?https://github.com/61bi-234469/tetrio_report_app/blob/develop/samples/sample_web_report.html) |

---

## Web版（現行）

Cloudflare Workers 上で動くWebアプリです。ブラウザーでユーザー名と取得マッチ数を入力すると、12章構成の戦績分析レポート（グラフはChart.js）を1ページのHTMLとして生成します。

- Workerは TETRA CHANNEL API への軽量プロキシ（`/api/league-page`）として動作し、レポートの集計・描画はブラウザー側（`public/report.js`）で行います。Workers無料プランでも動かせる構成です。
- OSを問わず利用できます。
- 入力したユーザー名の公開Tetra Leagueデータのみを使用します。
- 戦績・能力値集計はDQ（不戦勝・不戦敗）を含む公式勝敗マッチ全体を対象にします。通常勝率のみDQ除外の参考指標として残しています。
- マッチ単位のAPM/PPS/VSなどの能力値は、APIの試合集計値（`leaderboard.stats`）を優先し、欠損時のみラウンド平均で補います。

### 開発・ローカル実行

Node.js 22 以降が必要です。

```powershell
cd web
npm install
npm run dev
```

`wrangler dev` が起動したら、表示されたURL（既定は `http://localhost:8787`）をブラウザーで開きます。

### 検証

```powershell
cd web
npm run check
```

型チェック、クライアントバンドルのビルド、vitest によるテストをまとめて実行します。CI（`.github/workflows/web.yml`）でも同じ内容を検証しています。

### デプロイ

自分のCloudflareアカウントへデプロイする場合は次を実行します。

```powershell
cd web
npx wrangler deploy
```

---

## Python版（旧版・更新停止予定）

Windows向けのGUI/コマンドライン版です。**旧版として今後の機能追加は行わず、更新停止予定です。** 新規に使う場合はWeb版を推奨します。

Python版では、ツールが作る**①戦績レポート（本体）**に加えて、外部AIに素材を渡して作る**②AI考察レポート（別紙）**を作成できます（②はPython版のみの機能です）。

### 旧版サンプルレポート

旧Python版のサンプルは参考用です。新規利用はWeb版を推奨します。

| レポート種別 | リンク |
|---|---|
| 旧Python版 ① 戦績レポート（本体） | [サンプルを見る](https://htmlpreview.github.io/?https://github.com/61bi-234469/tetrio_report_app/blob/develop/python/samples/sample_report.html) |
| 旧Python版 ② AI考察レポート（別紙・Python版のみ） | [サンプルを見る](https://htmlpreview.github.io/?https://github.com/61bi-234469/tetrio_report_app/blob/develop/python/samples/sample_ai_report.html) |

| | ① 戦績レポート（本体） | ② AI考察レポート（別紙） |
|---|---|---|
| 作る主体 | ツールが作る | 外部AIチャット、または連携AIエージェントCLI |
| AIの要否 | 不要 | 必要（AIチャット貼り付け、またはCodex CLI / Claude Code CLI） |
| 主な内容 | 指標の計算・表・グラフ・章立ての解説 | 数値を踏まえた深掘りの考察・言語化 |
| 形式 | 自己完結HTML（1ファイル） | 自己完結HTML（別紙・1ファイル） |

### 動作条件

- Windows 10 / 11
- Python 3.10 以降（`py -3` または `python` で起動できること）
- PowerShell 5.1 以降
- インターネット接続

実行ポリシーで PowerShell スクリプトが止まる場合は、現在のユーザーだけ許可します。

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### GUIで使う

1. `python\レポート作成GUI.bat` をダブルクリックします。
2. プレイヤーIDと取得試合数を入力します。
3. 必要な実行内容をチェックし、`実行` をクリックします。

標準設定では、TETR.IOから戦績データを取得し、HTMLレポートを作成して、完了後にブラウザーと保存先フォルダーを開きます。GUI初回実行時に、レポート生成用の仮想環境と依存パッケージを自動で準備します。

②AI考察レポートは、GUIの「② AI考察レポートを作る」から、作成方法（AIチャット用素材の保存 / AIエージェントCLIで自動作成）・推論レベル・連携AIエージェントCLI（Codex CLI / Claude Code CLI）を選んで実行します。

### コマンドで使う

先にレポートビルダー用の仮想環境を準備します。

```powershell
py -3 -m venv "python\src\report_builder\.venv"
& "python\src\report_builder\.venv\Scripts\python.exe" -m pip install -r "python\src\report_builder\requirements.txt"
```

APIから直近100試合を取得します（GUIと同じ `data\raw|csv|parquet` 構成にする場合は `--output-layout typed` を付けます）。

```powershell
& "python\src\report_builder\.venv\Scripts\python.exe" `
  "python\src\api_export\tetrio_league_export.py" `
  --source api --username your_username --max-matches 100 `
  --outputs all --output-dir "python\data" --output-layout typed
```

取得済みデータから①戦績レポート（本体・HTML）を生成します。

```powershell
& "python\src\report_builder\make_report.ps1" `
  -DataFile "python\data\parquet\your_username_tetra_league_rounds_with_params.parquet" `
  -MatchesFile "python\data\parquet\your_username_tetra_league_matches_with_params.parquet" `
  -Player "your_username" -Open
```

②AI考察レポート関連の主なスイッチ:

- `-PrepareAI`: AIチャット貼り付け用の素材（AI用JSON `ai_appendix_data.json`・プロンプト `prompt_chat.md`）を `python/src/report_builder/cache/ai` に書き出します。
- `-GenerateAIReport`: 連携AIエージェントCLIで②を自動作成します。`-AIAgent codex|claude` でCLIを、`-AIReasoningLevel standard|high|low` で推論レベルを選びます。CLI実行が失敗しても①本体HTMLは保持され、`cache/ai` の素材でAIチャット貼り付け手順へ切り替えられます。

### 出力

- GUIのAPI取得データ: `python\data\raw`, `python\data\parquet`, `python\data\csv`
- GUIの成果物: `python\reports\<player>_report_<yyyy_mm_dd_HHmm>.html`、`python\reports\<player>_ai_report_<yyyy_mm_dd_HHmm>.html`
- コマンドの成果物: `python/src/report_builder/output`（①・②HTML）、`python/src/report_builder/cache/ai`（AI用JSON・プロンプト）
- 実行情報: `python\src\report_builder\cache\latest_run_manifest.json`

---

## 個人データの取り扱い

取得データとレポートには、対戦相手のユーザー名、ID、成績が含まれます。共有前に内容を確認してください。

## 指標について

APP、DS/S、DS/P、GbE、Area、VS/APM などは取得した試合・ラウンドデータから計算します。
Est. TR、Opener / Stride / Inf DS / Plonk、Cheese Index、Weighted APP などの派生指標は、[TetraStats](https://github.com/dan63047/TetraStats) に由来する計算式として扱います。
これらは公式TETR.IO計算ではありません。

## ライセンスと帰属

このリポジトリのコードは MIT License です。詳細は `LICENSE` を参照してください。

直接依存パッケージのライセンス概要は `THIRD_PARTY_NOTICES.md` を参照してください。
