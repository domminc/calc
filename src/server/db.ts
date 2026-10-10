import postgres from "postgres";
import type { Env } from "./env.ts";

export type Sql = postgres.Sql;

/** 가계부와 같은 설정: Hyperdrive/풀러 호환(prepare:false), 배열 자료형 조회 생략(fetch_types:false). */
export function connect(url: string, max = 3): Sql {
  return postgres(url, {
    prepare: false,
    max,
    fetch_types: false,
    connect_timeout: 8,
    idle_timeout: 5,
    types: {
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  }) as Sql;
}

export class DbUnavailable extends Error {
  constructor() {
    super("DB 연결이 설정되지 않았어요.");
  }
}

/**
 * 요청마다 Hyperdrive 로 연결해 쓰고, 응답을 막지 않도록 닫기는 waitUntil 로 넘긴다.
 * Workers 는 요청 사이에 연결을 공유할 수 없어 전역 연결을 만들지 않는다.
 */
export async function withSql<T>(env: Env, ctx: Pick<ExecutionContext, "waitUntil">, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const url = env.HYPERDRIVE?.connectionString;
  if (!url) throw new DbUnavailable();
  const sql = connect(url);
  try {
    return await fn(sql);
  } finally {
    ctx.waitUntil(sql.end({ timeout: 3 }).catch(() => {}));
  }
}
