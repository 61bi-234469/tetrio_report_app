[CmdletBinding()]
param(
    [switch]$SkipLogout
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ClaudeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [switch]$AllowFailure
    )

    & cmd /c claude @Arguments
    $Code = $LASTEXITCODE
    if ($Code -ne 0 -and -not $AllowFailure) {
        throw "claude $($Arguments -join ' ') failed with exit code $Code"
    }
    return $Code
}

Write-Host ""
Write-Host "Claude Code CLI authentication repair" -ForegroundColor Cyan
Write-Host "This uses only Claude CLI commands. No API key is required."
Write-Host ""

Write-Host "[1/4] Current auth status"
Invoke-ClaudeCommand -Arguments @("auth", "status", "--text") -AllowFailure | Out-Null

Write-Host ""
Write-Host "[2/4] Test non-interactive print mode"
$TestCode = Invoke-ClaudeCommand -Arguments @("-p", "Say OK only") -AllowFailure
if ($TestCode -eq 0) {
    Write-Host ""
    Write-Host "OK: claude -p works. You can rerun the report generator." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "claude -p failed. Refreshing Claude subscription login..." -ForegroundColor Yellow
Write-Host "Press Enter to continue, or close this window to cancel."
Read-Host | Out-Null

if (-not $SkipLogout) {
    Write-Host ""
    Write-Host "[3/4] Logout"
    Invoke-ClaudeCommand -Arguments @("auth", "logout") -AllowFailure | Out-Null
}
else {
    Write-Host ""
    Write-Host "[3/4] Logout skipped"
}

Write-Host ""
Write-Host "[4/4] Login with Claude subscription"
Write-Host "A browser or terminal login flow may open. Complete it, then return here."
Invoke-ClaudeCommand -Arguments @("auth", "login", "--claudeai")

Write-Host ""
Write-Host "Retesting claude -p..."
$RetestCode = Invoke-ClaudeCommand -Arguments @("-p", "Say OK only") -AllowFailure
if ($RetestCode -eq 0) {
    Write-Host ""
    Write-Host "OK: claude -p works. You can rerun the report generator." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "claude -p still failed." -ForegroundColor Red
Write-Host "Next, set up a long-lived Claude subscription token with Claude CLI."
Write-Host "Press Enter to run 'claude setup-token', or close this window to cancel."
Read-Host | Out-Null

Invoke-ClaudeCommand -Arguments @("setup-token")

Write-Host ""
Write-Host "Retesting claude -p after setup-token..."
$TokenRetestCode = Invoke-ClaudeCommand -Arguments @("-p", "Say OK only") -AllowFailure
if ($TokenRetestCode -eq 0) {
    Write-Host ""
    Write-Host "OK: claude -p works. You can rerun the report generator." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "claude -p still failed after setup-token." -ForegroundColor Red
Write-Host "Open cmd and confirm this command succeeds before using automatic AI report generation:"
Write-Host "  claude -p ""Say OK only""" -ForegroundColor Yellow
exit $TokenRetestCode
