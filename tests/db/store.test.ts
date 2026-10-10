import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, runScheduled } from "../../src/server/app.ts";
import { connect, type Sql } from "../../src/server/db.ts";
import type { Env } from "../../src/server/env.ts";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const files = new Map<string, { body: Uint8Array; uploaded: Date }>();
const fakeR2 = {
  get: async (k: string) => (files.has(k) ? { body: new Response(files.get(k)!.body as unknown as BodyInit).body } : null),
  put: async (k: string, v: Uint8Array) => void files.set(k, { body: new Uint8Array(v), uploaded: new Date() }),
  list: async (o: { prefix?: string }) => ({ objects: [...files.entries()].filter(([k]) => k.startsWith(o.prefix ?? "")).map(([key, v]) => ({ key, uploaded: v.uploaded })), truncated: false }),
  delete: async (keys: string[]) => keys.forEach((k) => files.delete(k)),
} as unknown as R2Bucket;

const env = { ASSETS: { fetch: async () => new Response("a") }, HYPERDRIVE: { connectionString: url ?? "" }, FILES: fakeR2, IP_SALT: "t" } as unknown as Env;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(() => {})), passThroughOnException() {} } as unknown as ExecutionContext;
const req = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, { headers: { "cf-connecting-ip": "1.2.3.4", ...(init?.headers ?? {}) }, ...init }, env, ctx);
const post = (path: string, body: unknown, ip = "1.2.3.4") =>
  req(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });

let sql: Sql;
d("DB 연동 (공유·신고·통계·제한)", () => {
  beforeAll(() => {
    sql = connect(url!, 2);
  });
  afterAll(async () => {
    await Promise.all(pending);
    await sql.end({ timeout: 2 });
  });

  it("health: DB 응답 정상", async () => {
    const h = (await (await req("/api/health")).json()) as Record<string, unknown>;
    expect(h.DB_응답).toBe("정상");
    expect(h.파일_저장).toBe("R2");
  });

  it("공유 링크 생성 → /r/{id} 에서 같은 결과를 다시 계산", async () => {
    const res = await post("/api/share", { calculator: "salary", inputs: { annual: "40,000,000", nonTaxable: "200000", family: "1", asOf: "2026-10-10" } });
    expect(res.status).toBe(201);
    const { id, url: shareUrl } = (await res.json()) as { id: string; url: string };
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(shareUrl).toContain(`/r/${id}`);
    const page = await req(`/r/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("공유된 연봉 계산기 결과");
    expect(html).toContain("월 실수령액");
    expect(html).toContain('content="noindex"');
    const [row] = await sql`select calculator, rate_year, inputs, expires_at > now() + interval '89 days' as ok from shared_results where id = ${id}`;
    expect(row).toMatchObject({ calculator: "salary", rate_year: 2026, ok: true });
    expect(row!.inputs).toMatchObject({ annual: "40000000" }); // 콤마 제거
  });

  it("공유: 잘못된 입력·알 수 없는 계산기·큰 요청은 거절", async () => {
    expect((await post("/api/share", { calculator: "salary", inputs: { annual: "abc" } }, "9.9.9.1")).status).toBe(400);
    expect((await post("/api/share", { calculator: "tax", inputs: {} }, "9.9.9.2")).status).toBe(400);
    expect((await req("/api/share", { method: "POST", body: "x".repeat(9000), headers: { "cf-connecting-ip": "9.9.9.3" } })).status).toBe(413);
    expect((await req("/api/share", { method: "POST", body: "not json", headers: { "cf-connecting-ip": "9.9.9.4" } })).status).toBe(400);
  });

  it("공유: 허용되지 않은 키는 저장하지 않는다", async () => {
    const res = await post("/api/share", { calculator: "insurance", inputs: { monthly: "3000000", evil: "<script>", __proto__: "x" } }, "9.9.9.5");
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [row] = await sql`select inputs from shared_results where id = ${id}`;
    expect(Object.keys(row!.inputs)).toEqual(["monthly"]);
  });

  it("공유: 같은 IP 가 분당 10건을 넘으면 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post("/api/share", { calculator: "insurance", inputs: { monthly: "3000000" } }, "7.7.7.7")).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("없는 공유 ID·형식 오류는 404", async () => {
    expect((await req("/r/ZZZZZZZZ")).status).toBe(404);
    expect((await req("/r/short")).status).toBe(404);
  });

  it("신고 접수(JSON·폼) 와 검증", async () => {
    expect((await post("/api/feedback", { calculator: "salary", message: "건강보험이 20원 달라요", contact: "a@b.c" }, "5.5.5.1")).status).toBe(204);
    const form = new URLSearchParams({ calculator: "other", message: "폼으로 접수" });
    const r = await req("/api/feedback", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "5.5.5.2" }, redirect: "manual" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/feedback?status=ok");
    expect((await post("/api/feedback", { calculator: "salary", message: "" }, "5.5.5.3")).status).toBe(400);
    expect((await post("/api/feedback", { calculator: "salary", message: "x".repeat(2001) }, "5.5.5.4")).status).toBe(400);
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from feedback`;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it("통계: 계산기 페이지 조회가 usage_daily 에 쌓인다", async () => {
    await req("/insurance");
    await Promise.all(pending);
    const [row] = await sql<{ n: number }[]>`select coalesce(sum(view_count),0)::int as n from usage_daily where calculator = 'insurance'`;
    expect(row!.n).toBeGreaterThanOrEqual(1);
  });

  it("내려받기: xlsx·pdf 생성 후 R2 캐시(두 번째는 hit)", async () => {
    const q = "c=salary&annual=40000000&nonTaxable=200000&asOf=2026-10-10";
    const x1 = await req(`/api/export/xlsx?${q}`);
    expect(x1.status).toBe(200);
    expect(x1.headers.get("x-cache")).toBe("miss");
    const bytes = new Uint8Array(await x1.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK"); // zip
    await Promise.all(pending);
    const x2 = await req(`/api/export/xlsx?${q}`);
    expect(x2.headers.get("x-cache")).toBe("hit");
    const p1 = await req(`/api/export/pdf?${q}`);
    expect(p1.status).toBe(200);
    const pdf = new Uint8Array(await p1.arrayBuffer());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
    expect(p1.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect((await req("/api/export/pdf?c=salary&annual=abc")).status).toBe(400);
    expect((await req("/api/export/doc?c=salary")).status).toBe(400);
  });

  it("예약 작업: 만료된 공유·신고·제한 기록과 오래된 내보내기 캐시 삭제", async () => {
    await sql`insert into shared_results (id, calculator, rate_year, inputs, expires_at) values ('OLDOLD01', 'salary', 2026, '{}', now() - interval '1 day')`;
    await sql`insert into feedback (calculator, message, expires_at) values ('other', 'old', now() - interval '1 day')`;
    await sql`insert into rate_limits (key, window_start, hits) values ('x', now() - interval '3 days', 1)`;
    files.set("exports/old.xlsx", { body: new Uint8Array([1]), uploaded: new Date(Date.now() - 8 * 86400_000) });
    await runScheduled(env, ctx);
    await Promise.all(pending);
    expect((await sql`select 1 from shared_results where id = 'OLDOLD01'`).length).toBe(0);
    expect((await sql`select 1 from feedback where message = 'old'`).length).toBe(0);
    expect((await sql`select 1 from rate_limits where key = 'x'`).length).toBe(0);
    expect(files.has("exports/old.xlsx")).toBe(false);
  });

  it("스키마 제약: 8자 ID 형식·계산기 값 검사", async () => {
    await expect(sql`insert into shared_results (id, calculator, rate_year, inputs, expires_at) values ('bad', 'salary', 2026, '{}', now())`).rejects.toThrow();
    await expect(sql`insert into shared_results (id, calculator, rate_year, inputs, expires_at) values ('GOODID01', 'nope', 2026, '{}', now())`).rejects.toThrow();
  });

  it("/basis 에 요율 개정 이력이 표시된다", async () => {
    const html = await (await req("/basis")).text();
    expect(html).toContain("요율 개정 이력");
    expect(html).toContain("<code>");
  });
});
