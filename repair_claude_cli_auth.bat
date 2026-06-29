@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "src\report_builder\scripts\repair_claude_cli_auth.ps1"

echo.
pause
