#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --frozen
exec uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port "${PORT:-8000}"
