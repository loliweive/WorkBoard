@echo off
cd /d "%~dp0"

echo Stopping old server...
powershell -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1
timeout /t 1 /nobreak >nul

echo Starting Workboard...
start "" pythonw desktop.pyw
