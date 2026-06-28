# かんたんな使い方

## 通常

1. `input`フォルダーへラウンド単位CSVを置く
2. PowerShellで次を実行する

```powershell
.\make_report.ps1
```

3. `output`フォルダーのHTMLを開く

初回だけ、Python仮想環境と必要パッケージを自動的に準備します。

## ファイルを直接指定

```powershell
.\make_report.ps1 -Input "input\rounds.csv"
```

## 強制再生成

```powershell
.\make_report.ps1 -Force
```

## 完了後にブラウザーで開く

```powershell
.\make_report.ps1 -Open
```

## AIへ渡す軽量JSONも作る

全体用：

```powershell
.\make_report.ps1 -PrepareAI
```

第8章（試合間・セッション全体の流れ）だけ：

```powershell
.\make_report.ps1 -PrepareAI -Chapter 8
```

## PowerShellの実行がブロックされる場合

一時的に許可して実行します。

```powershell
powershell -ExecutionPolicy Bypass -File .\make_report.ps1
```

または、自分のユーザーだけ実行を許可します。

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 現在の入力制限

現在の解析エンジンが直接扱うのは、既存レポートと同じ列構造のラウンド単位CSVです。
raw JSONの直接入力はまだ対応していません。
