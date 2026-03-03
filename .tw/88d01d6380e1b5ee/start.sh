#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .venv/bin/python ]; then
  python3 -m venv .venv
fi

./.venv/bin/python -m pip install --upgrade pip >/dev/null
./.venv/bin/python -m pip install -r requirements-dev.txt >/dev/null

if [ "$#" -eq 0 ]; then
  ./.venv/bin/python -m pr.main greet --name Developer
else
  ./.venv/bin/python -m pr.main "$@"
fi
