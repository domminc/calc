#!/usr/bin/env bash
# 임시 Postgres 에 마이그레이션을 적용하고(두 번 돌려도 안전한지 포함) DB 통합 테스트를 실행한다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/pg-temp.sh"
trap pg_stop EXIT
pg_start

echo "== migrate (처음)"
node "$ROOT/scripts/migrate.mjs"
echo "== migrate (두 번째: 새로 적용되는 것이 없어야 함)"
out="$(node "$ROOT/scripts/migrate.mjs")"
echo "$out"
if echo "$out" | grep -q "— 적용$"; then echo "FAIL: 두 번째 실행에서 다시 적용함"; exit 1; fi

echo "== DB 통합 테스트"
cd "$ROOT"
TEST_DATABASE_URL="$DATABASE_URL" npx vitest run tests/db
