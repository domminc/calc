#!/usr/bin/env bash
# 수동 확인용: 임시 Postgres + 로컬 Worker 를 백그라운드로 띄운다. 끝나면 scripts/dev-down.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
STATE="${TMPDIR:-/tmp}/homesell-calc-dev.state"
source scripts/pg-temp.sh
pg_start
node scripts/migrate.mjs >/dev/null
node scripts/build-client.mjs
nohup npx wrangler dev --local --port "${E2E_PORT:-8799}" --ip 127.0.0.1 >"${TMPDIR:-/tmp}/homesell-calc-wrangler.log" 2>&1 &
echo "PG_TMP=$PG_TMP WR_PID=$!" > "$STATE"
for i in $(seq 1 60); do curl -fs "http://127.0.0.1:${E2E_PORT:-8799}/api/health" >/dev/null 2>&1 && { echo "up: http://127.0.0.1:${E2E_PORT:-8799}"; exit 0; }; sleep 1; done
echo "FAIL"; exit 1
