#!/usr/bin/env bash
STATE="${TMPDIR:-/tmp}/homesell-calc-dev.state"
[ -f "$STATE" ] || exit 0
source "$(dirname "$0")/pg-temp.sh"   # (PG_TMP 를 비우므로 상태 파일은 그 다음에 읽는다)
source "$STATE" 2>/dev/null || true
[ -n "${WR_PID:-}" ] && kill "$WR_PID" 2>/dev/null || true
pg_stop
rm -f "$STATE"
