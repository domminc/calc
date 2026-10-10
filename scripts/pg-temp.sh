#!/usr/bin/env bash
# 임시 Postgres 를 띄운다. source 해서 쓴다: pg_start (DATABASE_URL 설정) / pg_stop
# 필요: Postgres 15+ 바이너리 (initdb, pg_ctl). PG_BIN 으로 경로 지정 가능. root 면 postgres 사용자로 실행한다.
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
PG_PORT="${PGTEST_PORT:-54330}"
PG_TMP=""

_run() {
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres "$PG_TMP"
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

pg_start() {
  PG_TMP="$(mktemp -d)"
  _run "'$PG_BIN/initdb' -D '$PG_TMP/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  _run "'$PG_BIN/pg_ctl' -D '$PG_TMP/data' -o '-p $PG_PORT -k $PG_TMP -c listen_addresses=127.0.0.1' -l '$PG_TMP/log' -w start >/dev/null"
  export DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/postgres"
}

pg_stop() {
  [ -n "$PG_TMP" ] || return 0
  _run "'$PG_BIN/pg_ctl' -D '$PG_TMP/data' -m immediate stop >/dev/null 2>&1" || true
  rm -rf "$PG_TMP"
}
