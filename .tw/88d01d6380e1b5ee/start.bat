@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  python -m venv .venv
  if %ERRORLEVEL% NEQ 0 exit /b 1
)

.\.venv\Scripts\python.exe -m pip install --upgrade pip >nul
if %ERRORLEVEL% NEQ 0 exit /b 1

.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt >nul
if %ERRORLEVEL% NEQ 0 exit /b 1

if "%~1"=="" (
  .\.venv\Scripts\python.exe -m pr.main greet --name Developer
) else (
  .\.venv\Scripts\python.exe -m pr.main %*
)
