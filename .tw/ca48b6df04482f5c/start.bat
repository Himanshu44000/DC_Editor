@echo off
setlocal
cd /d "%~dp0"

echo [FastAPI] Starting setup...

if not exist requirements.txt (
  echo [FastAPI] requirements.txt not found in this folder.
  pause
  exit /b 1
)

if defined FASTAPI_VERBOSE (
  set "PIP_FLAGS=--disable-pip-version-check --no-input"
) else (
  set "PIP_FLAGS=--disable-pip-version-check --no-input -q"
)

if not exist .venv\Scripts\python.exe (
  echo [FastAPI] Creating virtual environment...
  where py >nul 2>&1
  if %ERRORLEVEL% EQU 0 (
    py -3 -m venv .venv
  ) else (
    where python >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
      echo [FastAPI] Python not found. Install Python 3 and try again.
      pause
      exit /b 1
    )
    python -m venv .venv
  )
  if %ERRORLEVEL% NEQ 0 (
    echo [FastAPI] Failed to create virtual environment.
    pause
    exit /b 1
  )
)

echo [FastAPI] Installing/updating dependencies...
.\.venv\Scripts\python.exe -m pip install %PIP_FLAGS% --upgrade pip
if %ERRORLEVEL% NEQ 0 (
  echo [FastAPI] Failed to upgrade pip.
  pause
  exit /b 1
)

.\.venv\Scripts\python.exe -m pip install %PIP_FLAGS% -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
  echo [FastAPI] Failed to install dependencies.
  pause
  exit /b 1
)

if not exist .env if exist .env.example copy .env.example .env >nul

echo [FastAPI] Server running at http://127.0.0.1:8000
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
if %ERRORLEVEL% NEQ 0 (
  echo [FastAPI] Server stopped with an error.
  pause
  exit /b 1
)
