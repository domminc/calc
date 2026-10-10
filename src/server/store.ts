// DB 쓰기·읽기 모음. 모두 "있으면 좋은 기능"이라 실패해도 계산기는 계속 동작해야 한다.
import { withSql, type Sql } from "./db.ts";
import type { Env } from "./env.ts";

type Ctx = Pick<ExecutionContext, "waitUntil">;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += BASE62[b % 62];
  return id;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** IP 는 저장하지 않고, 일 단위로 바뀌는 솔트와 섞은 해시 앞부분만 제한 계산에 쓴다. */
export async function clientKey(env: Env, ip: string | undefined, scope: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const h = await sha256Hex(`${ip ?? "unknown"}|${day}|${env.IP_SALT ?? "homesell-calc"}`);
  return `${scope}:${h.slice(0, 24)}`;
}

/** 분 단위 창에서 hits 를 올리고, 한도를 넘었는지 알려 준다. */
export async function overLimit(sql: Sql, key: string, limit: number): Promise<boolean> {
  const [row] = await sql<{ hits: number }[]>`
    insert into rate_limits (key, window_start, hits) values (${key}, date_trunc('minute', now()), 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1
    returning hits`;
  return (row?.hits ?? 0) > limit;
}

export type UsageField = "view_count" | "share_count" | "export_count";

export function trackUsage(env: Env, ctx: Ctx, calculator: string, field: UsageField): void {
  if (!env.HYPERDRIVE) return;
  ctx.waitUntil(
    withSql(env, ctx, async (sql) => {
      const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      if (field === "view_count") await sql`insert into usage_daily (day, calculator, view_count) values (${day}, ${calculator}, 1) on conflict (day, calculator) do update set view_count = usage_daily.view_count + 1`;
      else if (field === "share_count") await sql`insert into usage_daily (day, calculator, share_count) values (${day}, ${calculator}, 1) on conflict (day, calculator) do update set share_count = usage_daily.share_count + 1`;
      else await sql`insert into usage_daily (day, calculator, export_count) values (${day}, ${calculator}, 1) on conflict (day, calculator) do update set export_count = usage_daily.export_count + 1`;
    }).catch(() => {}),
  );
}

export interface SharedRow {
  id: string;
  calculator: string;
  rate_year: number;
  inputs: Record<string, string>;
  expires_at: string;
}

export async function insertShare(sql: Sql, calculator: string, rateYear: number, inputs: Record<string, string>): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const id = newShareId();
    try {
      await sql`insert into shared_results (id, calculator, rate_year, inputs, expires_at)
                values (${id}, ${calculator}, ${rateYear}, ${sql.json(inputs as never)}, now() + interval '90 days')`;
      return id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") continue;
      throw e;
    }
  }
  throw new Error("공유 ID를 만들지 못했어요.");
}

export async function getShare(sql: Sql, id: string): Promise<SharedRow | null> {
  const rows = await sql<SharedRow[]>`
    select id, calculator, rate_year, inputs, to_char(expires_at at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') as expires_at
    from shared_results where id = ${id} and expires_at > now()`;
  return rows[0] ?? null;
}

export async function insertFeedback(sql: Sql, f: { calculator: string; message: string; contact: string | null; pageUrl: string | null }): Promise<void> {
  await sql`insert into feedback (calculator, message, contact, page_url) values (${f.calculator}, ${f.message}, ${f.contact}, ${f.pageUrl})`;
}

export async function rateHistory(sql: Sql): Promise<{ year: number; version: string; effective_from: string; created_at: string }[]> {
  return sql<{ year: number; version: string; effective_from: string; created_at: string }[]>`
    select year, version, effective_from::text, to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as created_at
    from rate_sets order by year desc, created_at desc limit 20`;
}

export async function purgeExpired(sql: Sql): Promise<{ shares: number; feedback: number; limits: number }> {
  const s = await sql`delete from shared_results where expires_at < now()`;
  const f = await sql`delete from feedback where expires_at < now()`;
  const l = await sql`delete from rate_limits where window_start < now() - interval '1 day'`;
  return { shares: s.count, feedback: f.count, limits: l.count };
}
