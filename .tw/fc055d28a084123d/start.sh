#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f requirements.txt ]; then
  echo '[FastAPI] requirements.txt not found in this folder.'
  exit 1
fi

if [ ! -f .venv/bin/python ]; then
  echo '[FastAPI] Creating virtual environment...'
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv .venv
  elif command -v python >/dev/null 2>&1; then
    python -m venv .venv
  else
    echo '[FastAPI] Python not found. Install Python 3 and try again.'
    exit 1
  fi
fi

echo '[FastAPI] Installing/updating dependencies...'
PIP_FLAGS=(--disable-pip-version-check --no-input)
UVICORN_FLAGS=(--log-level warning --no-access-log)
if [ -z "${FASTAPI_VERBOSE:-}" ]; then
  PIP_FLAGS+=(-q)
else
  UVICORN_FLAGS=(--log-level info)
fi
if [ -n "${FASTAPI_RELOAD:-}" ]; then
  UVICORN_FLAGS+=(--reload)
fi
./.venv/bin/python -m pip install "${PIP_FLAGS[@]}" --upgrade pip
./.venv/bin/python -m pip install "${PIP_FLAGS[@]}" -r requirements.txt

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

APP_TARGET="${FASTAPI_APP:-}"
if [ -z "$APP_TARGET" ]; then
  if [ -f main.py ]; then
    APP_TARGET="main:app"
  elif [ -f app/main.py ]; then
    APP_TARGET="app.main:app"
  elif [ -f src/main.py ]; then
    APP_TARGET="src.main:app"
  elif [ -f app.py ]; then
    APP_TARGET="app:app"
  else
    APP_TARGET="main:app"
  fi
fi

echo "[FastAPI] Server running at http://127.0.0.1:8000 ($APP_TARGET)"
./.venv/bin/python -m uvicorn "$APP_TARGET" "${UVICORN_FLAGS[@]}"
