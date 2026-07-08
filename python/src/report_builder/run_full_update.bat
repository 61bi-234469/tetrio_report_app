@echo off
if "%~1"=="" (
  echo Usage: run_full_update.bat "path\to\data.csv" [player]
  exit /b 1
)
set PLAYER=%~2
if "%PLAYER%"=="" set PLAYER=your_username
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make_report.ps1" -DataFile "%~1" -Player "%PLAYER%"
