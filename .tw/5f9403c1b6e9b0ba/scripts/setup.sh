#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements.txt

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

echo 'FastAPI environment is ready.'
echo 'Run: ./.venv/bin/python -m uvicorn main:app --reload'
