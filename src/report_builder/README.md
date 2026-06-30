# 最短の使い方

通常は、`input`フォルダーへCSVを置いて次の1行だけ実行します。

```powershell
.\make_report.ps1
```

詳しくは [`SIMPLE_USAGE.md`](SIMPLE_USAGE.md) を参照してください。

---

# TETR.IO戦績レポート自動生成テンプレート

本ツールは非公式です。TETR.IO / osk とは関係ありません。"TETR.IO" は権利者の商標です。

新しいラウンド単位CSVから、次を一括生成します。

- 試合・ラウンド集計
- APP / DS/S / DS/P / GbE / Area / VS/APM
- TR差による期待勝率モデル
- 相対指標による診断モデル
- 20枚のグラフ
- 8章の説明文・表
- 月別集計（折り畳み付録）
- 検証済みパーソナルレコード（折り畳み付録）
- AIへ渡す軽量な分析JSON
- Base64画像を埋め込んだ自己完結HTML

完成HTMLやBase64画像をAIへ渡す必要がないため、新CSVを使う場合もトークンを節約できます。

## 1. セットアップ

PowerShellで展開先へ移動します。

```powershell
cd "展開したフォルダー"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## 2. 新CSVから全自動更新

```powershell
.\run_full_update.ps1 -Csv "input\new_rounds.csv" -Player "your_username"
```

または直接実行します。

```powershell
python scripts\full_update.py "input\new_rounds.csv" --player your_username
```

生成物：

```text
output/your_username_tetrio_performance_report_yyyy_mm_dd.html
cache/analysis_summary.json
cache/ai_analysis_payload.json
cache/monthly_summary.csv
cache/records.json
```

同じCSVをもう一度指定した場合、SHA-256が一致すれば集計・描画・文章生成を省略します。
強制的に再生成する場合：

```powershell
.\run_full_update.ps1 -Csv "input\new_rounds.csv" -Player "your_username" -Force
```

## 3. 処理内容

`full_update.py`は次の順で実行します。

1. CSVを読み込み、派生指標を再計算
2. 試合単位・月単位・セッション単位へ集計
3. 期待勝率、効果量、相性、タイブレーク等を分析
4. 20グラフをPNGで生成
5. 8章、KPI、月別集計、PRをHTML断片として生成
6. Jinja2テンプレートへ挿入
7. 最後にPNGをBase64化し、単一HTMLを作成
8. 章数・画像数・付録・未解決変数を検証

## 4. AIを使う場合

②AI考察レポート用の素材を作る場合も、完成HTMLは渡しません。

AIへ渡すもの：

```text
cache/ai/ai_appendix_data.json
cache/ai/prompt_chat.md
```

`ai_appendix_data.json`には集計済みの数値だけが入り、CSV、CSS、Base64画像は含まれません。
AI本文JSONを作成したら：

```powershell
python scripts\validate_ai_text.py
python scripts\render_ai_text_to_html.py
```

## 5. 個別実行

### 集計だけ

```powershell
python scripts\analyze.py "new_rounds.csv" --player your_username
```

### 20グラフだけ

```powershell
python scripts\charts.py "new_rounds.csv" --player your_username
```

### 既存テンプレートからHTMLだけ再構築

```powershell
python scripts\build_report.py
```

### 軽量プレビュー

```powershell
python scripts\build_report.py --external-images --output output\preview_yyyy_mm_dd.html
```

## 6. 固定グラフ仕様

能力レーダーは上から時計回りに：

```text
APM → PPS → VS → APP → DS/Second → DS/Piece
→ APP+DS/Piece → VS/APM → Cheese Index → Garbage Eff.
```

4スタイル：

```text
上 Opener / 右 Stride / 下 Inf DS / 左 Plonk
```

## 7. 入力CSV

このパッケージは、同梱レポート作成時と同じラウンド単位CSV構造を前提とします。
最低限、以下が必要です。

- match_number / match_id / played_at_jst / match_result
- target_score / opponent_score
- tr_before / tr_after / opponent_tr_before
- round / round_won / lifetime_ms
- apm / pps / vs
- opponent_apm / opponent_pps / opponent_vs
- Opener / Stride / Inf DS / Plonk
- opponent_Opener / opponent_Stride / opponent_Inf DS / opponent_Plonk

APP、DS系、GbE、Areaはスクリプト側で再計算します。

## 8. 主なファイル

```text
scripts/report_analysis.py   集計・モデル・月別・PR
scripts/analyze.py           集計だけのCLI
scripts/charts.py            20グラフ生成
scripts/render_report.py     8章・付録・KPI生成
scripts/full_update.py       全工程の実行
scripts/build_report.py      最終HTML組み立て

template/base.html           HTML骨格
template/report.css          デザイン
cache/generated/chapters/    自動生成された8章
cache/generated/appendices.html 自動生成された付録
charts/                      自動生成されたPNG
cache/                       集計JSON・CSV・キャッシュ情報
```

## 9. 注意

- 期待勝率はCSVにGlicko/RDがない場合、TR差から較正した近似です。
- Est. TR、4スタイル値、Cheese Indexなどの派生指標はTetraStats由来の計算式を使用しています。
- 相対能力差モデルは試合後スタッツを使う診断モデルで、試合前予測ではありません。
- タイブレーク、相性、小標本区分は探索的に扱います。
- 自動文章は数値に基づく初稿です。公開前に表現を確認してください。
