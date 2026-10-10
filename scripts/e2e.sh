#!/usr/bin/env bash
# 임시 Postgres + 로컬 Worker(workerd) 위에서 Playwright e2e 를 실행한다.
#   npm run test:e2e                      # 전체
#   npm run test:e2e -- -g "E05"          # 일부
# 크로미움 경로: CHROMIUM_PATH (없으면 /opt/pw-browsers 에서 찾는다)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/pg-temp.sh"

PORT="${E2E_PORT:-8799}"
WR_PID=""
cleanup() {
  [ -n "$WR_PID" ] && kill "$WR_PID" 2>/dev/null || true
  pg_stop
}
trap cleanup EXIT

if [ -z "${CHROMIUM_PATH:-}" ]; then
  d="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | tail -1 || true)"
  [ -n "$d" ] && export CHROMIUM_PATH="$d"
fi

pg_start
node scripts/migrate.mjs >/dev/null
node scripts/build-client.mjs
npx wrangler dev --local --port "$PORT" --ip 127.0.0.1 >"${TMPDIR:-/tmp}/homesell-calc-wrangler.log" 2>&1 &
WR_PID=$!
for i in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 60 ] && { echo "FAIL: Worker 가 뜨지 않음"; tail -30 "${TMPDIR:-/tmp}/homesell-calc-wrangler.log"; exit 1; }
done
E2E_BASE_URL="http://127.0.0.1:$PORT" npx playwright test "$@"
