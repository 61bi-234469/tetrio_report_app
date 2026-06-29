[CmdletBinding()]
param(
    # 省略時は input フォルダー内で更新日時が最も新しいCSVを使用します。
    [Alias("Input")]
    [string]$DataFile,

    [string]$MatchesFile,

    [string]$Player = "your_username",

    # 前試合完了直後から次試合開始まで、この分数以内なら同一セッションとして扱います。
    [int]$SessionGap = 10,

    # キャッシュを無視して全工程を再実行します。
    [switch]$Force,

    # AIへ渡す軽量JSONも output フォルダーへ出力します。
    [switch]$PrepareAI,

    # -PrepareAI と併用。例: -Chapter 9,12
    [ValidateRange(1, 12)]
    [int[]]$Chapter,

    # 自己完結HTMLとは別に、外部画像参照の軽量 preview_yyyy_mm_dd.html を作ります。
    [switch]$ExternalImages,

    # 完了後にHTMLを既定のブラウザーで開きます。
    [switch]$Open
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $Root "..\..")).Path
$InputDir = Join-Path $Root "input"
$OutputDir = Join-Path $Root "output"
$CacheDir = Join-Path $Root "cache"
$Requirements = Join-Path $Root "requirements.txt"
$VenvDir = Join-Path $Root ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message
    )
    Write-Host ""
    Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [string]$FailureMessage = "コマンドの実行に失敗しました。"
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code: $LASTEXITCODE)"
    }
}

function Resolve-PythonLauncher {
    $PyCommand = Get-Command "py" -ErrorAction SilentlyContinue
    if ($null -ne $PyCommand) {
        return @{
            FilePath = $PyCommand.Source
            Prefix   = @("-3")
        }
    }

    $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
    if ($null -ne $PythonCommand) {
        return @{
            FilePath = $PythonCommand.Source
            Prefix   = @()
        }
    }

    throw @"
Python 3 が見つかりません。
https://www.python.org/ からPythonをインストールし、
インストール時に「Add python.exe to PATH」を有効にしてください。
"@
}

function Resolve-ExistingFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedFile,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if ([string]::IsNullOrWhiteSpace($RequestedFile)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($RequestedFile)) {
        $Candidates = @($RequestedFile)
    }
    else {
        $BaseDirs = @(
            (Get-Location).Path,
            $ProjectRoot,
            $Root,
            $InputDir
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

        $Candidates = @($BaseDirs | ForEach-Object { Join-Path $_ $RequestedFile })
    }

    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $Candidate).Path
        }
    }

    $CandidateList = ($Candidates | Select-Object -Unique | ForEach-Object { " - $_" }) -join [Environment]::NewLine
    throw @"
${Description}が見つかりません: $RequestedFile
確認した候補:
$CandidateList
"@
}

function Resolve-DataFile {
    param([string]$RequestedFile)

    New-Item -ItemType Directory -Force -Path $InputDir | Out-Null

    if (-not [string]::IsNullOrWhiteSpace($RequestedFile)) {
        return Resolve-ExistingFile -RequestedFile $RequestedFile -Description "入力ファイル"
    }

    $Candidates = @(
        Get-ChildItem -LiteralPath $InputDir -File |
        Where-Object { $_.Extension.ToLowerInvariant() -in @(".csv", ".parquet", ".pq") } |
        Sort-Object LastWriteTime -Descending
    )

    if ($Candidates.Count -eq 0) {
        throw @"
入力CSV/Parquetがありません。

次のどちらかを行ってください。
1. input フォルダーへCSV/Parquetを置いて .\make_report.ps1 を実行
2. .\src\report_builder\make_report.ps1 -DataFile "data\rounds.parquet" -MatchesFile "data\matches.parquet" を実行

対象フォルダー:
$InputDir
"@
    }

    if ($Candidates.Count -gt 1) {
        Write-Warning "input フォルダーに複数のCSVがあります。最も新しいファイルを使用します。"
    }

    return $Candidates[0].FullName
}

try {
    New-Item -ItemType Directory -Force -Path $InputDir, $OutputDir, $CacheDir | Out-Null

    Write-Host "TETR.IO レポート生成" -ForegroundColor Green
    Write-Host "プロジェクト: $Root"

    Write-Step 1 5 "入力データを確認"
    $CsvPath = Resolve-DataFile -RequestedFile $DataFile
    $ResolvedMatchesFile = $null
    if (-not [string]::IsNullOrWhiteSpace($MatchesFile)) {
        $ResolvedMatchesFile = Resolve-ExistingFile -RequestedFile $MatchesFile -Description "試合ファイル"
    }

    $Extension = [System.IO.Path]::GetExtension($CsvPath).ToLowerInvariant()
    if ($Extension -notin @(".csv", ".parquet", ".pq")) {
        throw @"
現在の解析エンジンが直接扱える入力形式はラウンド単位CSV/Parquetです。
指定された形式: $Extension

raw JSONを使う場合は、先に同じ列構造のCSV/Parquetへ正規化してください。
"@
    }

    Write-Host "入力: $CsvPath"
    Write-Host "プレイヤー: $Player"

    Write-Step 2 5 "Python環境を準備"
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        Write-Host "初回実行のため .venv を作成します。"
        $Launcher = Resolve-PythonLauncher
        $VenvArgs = @()
        $VenvArgs += $Launcher.Prefix
        $VenvArgs += @("-m", "venv", $VenvDir)

        Invoke-Checked `
            -FilePath $Launcher.FilePath `
            -Arguments $VenvArgs `
            -FailureMessage "Python仮想環境の作成に失敗しました。"
    }

    if (-not (Test-Path -LiteralPath $Requirements -PathType Leaf)) {
        throw "requirements.txt が見つかりません: $Requirements"
    }

    $RequirementHash = (Get-FileHash -LiteralPath $Requirements -Algorithm SHA256).Hash
    $RequirementState = Join-Path $CacheDir ".requirements.sha256"
    $InstalledHash = ""
    if (Test-Path -LiteralPath $RequirementState -PathType Leaf) {
        $InstalledHash = (Get-Content -LiteralPath $RequirementState -Raw).Trim()
    }

    if ($InstalledHash -ne $RequirementHash) {
        Write-Host "必要なPythonパッケージをインストールします。初回は数分かかる場合があります。"
        Invoke-Checked `
            -FilePath $VenvPython `
            -Arguments @("-m", "pip", "install", "-r", $Requirements) `
            -FailureMessage "Pythonパッケージのインストールに失敗しました。"

        Set-Content `
            -LiteralPath $RequirementState `
            -Value $RequirementHash `
            -Encoding Ascii
    }
    else {
        Write-Host "Python環境: 準備済み"
    }

    Write-Step 3 5 "CSVを分析してHTMLレポートを生成"
    $UpdateArgs = @(
        (Join-Path $Root "scripts\full_update.py"),
        $CsvPath,
        "--player",
        $Player,
        "--session-gap",
        "$SessionGap"
    )
    if (-not [string]::IsNullOrWhiteSpace($ResolvedMatchesFile)) {
        $UpdateArgs += @("--matches", $ResolvedMatchesFile)
    }
    if ($Force) {
        $UpdateArgs += "--force"
    }

    Invoke-Checked `
        -FilePath $VenvPython `
        -Arguments $UpdateArgs `
        -FailureMessage "レポートの生成に失敗しました。"

    $ReportDataPath = Join-Path $CacheDir "report_data.json"
    if (-not (Test-Path -LiteralPath $ReportDataPath -PathType Leaf)) {
        throw "生成結果の情報が見つかりません: $ReportDataPath"
    }

    $ReportData = Get-Content -LiteralPath $ReportDataPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $ReportPath = Join-Path $OutputDir $ReportData.output_filename

    if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) {
        throw "完成HTMLが見つかりません: $ReportPath"
    }

    Write-Step 4 5 "追加出力を準備"
    $AiPayloadPath = $null

    if ($PrepareAI) {
        if ($null -ne $Chapter -and $Chapter.Count -gt 0) {
            $ChapterLabel = ($Chapter | Sort-Object -Unique) -join "_"
            $AiPayloadPath = Join-Path $OutputDir "ai_payload_chapter_$ChapterLabel.json"

            $PayloadArgs = @(
                (Join-Path $Root "scripts\prepare_ai_payload.py"),
                "--chapters"
            )
            $PayloadArgs += ($Chapter | Sort-Object -Unique | ForEach-Object { "$_" })
            $PayloadArgs += @("--output", $AiPayloadPath)

            Invoke-Checked `
                -FilePath $VenvPython `
                -Arguments $PayloadArgs `
                -FailureMessage "章別AI用データの生成に失敗しました。"
        }
        else {
            $SourcePayload = Join-Path $CacheDir "ai_analysis_payload.json"
            if (-not (Test-Path -LiteralPath $SourcePayload -PathType Leaf)) {
                throw "AI用軽量JSONが見つかりません: $SourcePayload"
            }

            $AiPayloadPath = Join-Path $OutputDir "ai_payload.json"
            Copy-Item -LiteralPath $SourcePayload -Destination $AiPayloadPath -Force
        }

        Write-Host "AI用データ: $AiPayloadPath"
    }
    elseif ($null -ne $Chapter -and $Chapter.Count -gt 0) {
        Write-Warning "-Chapter は -PrepareAI と併用した場合だけ使用されます。"
    }

    $PreviewPath = $null
    if ($ExternalImages) {
        $PreviewDate = if ($ReportData.generated_date) {
            [string]$ReportData.generated_date -replace "-", "_"
        }
        else {
            (Get-Date).ToString("yyyy_MM_dd")
        }
        $PreviewPath = Join-Path $OutputDir "preview_$PreviewDate.html"
        Invoke-Checked `
            -FilePath $VenvPython `
            -Arguments @(
                (Join-Path $Root "scripts\build_report.py"),
                "--external-images",
                "--output",
                $PreviewPath
            ) `
            -FailureMessage "軽量プレビューの生成に失敗しました。"

        Write-Host "軽量プレビュー: $PreviewPath"
    }

    Write-Step 5 5 "完了"
    Write-Host ""
    Write-Host "完成HTML:" -ForegroundColor Green
    Write-Host $ReportPath
    Write-Host ""
    Write-Host "同じCSVを再度使用した場合は、キャッシュにより再集計を省略します。"

    if ($Open) {
        Start-Process -FilePath $ReportPath
    }
}
catch {
    Write-Host ""
    Write-Host "エラー: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "処理を中止しました。"
    exit 1
}
