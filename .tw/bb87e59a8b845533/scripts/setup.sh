#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
PIP_FLAGS=(--disable-pip-version-check --no-input)
if [ -z "${FASTAPI_VERBOSE:-}" ]; then
  PIP_FLAGS+=(-q)
fi
./.venv/bin/python -m pip install "${PIP_FLAGS[@]}" --upgrade pip
./.venv/bin/python -m pip install "${PIP_FLAGS[@]}" -r requirements.txt

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

echo 'FastAPI environment is ready.'
echo 'Run: ./.venv/bin/python -m uvicorn main:app --reload'
