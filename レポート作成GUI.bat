@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" pythonw "%~dp0src\tetrio_report_gui.pyw"
if errorlevel 1 (
  echo pythonw が見つかりません。py で再試行します。
  start "" py -3 "%~dp0src\tetrio_report_gui.pyw"
)
