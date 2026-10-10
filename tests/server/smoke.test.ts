import { describe, expect, it } from "vitest";
import { app } from "../../src/server/app.ts";
import type { Env } from "../../src/server/env.ts";

const env = { ASSETS: { fetch: async () => new Response("asset") } } as unknown as Env;
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} } as unknown as ExecutionContext;
const get = (path: string) => app.request(`http://localhost${path}`, {}, env, ctx);

describe("페이지 스모크", () => {
  for (const path of ["/", "/salary", "/payroll", "/insurance", "/freelancer", "/salary/table", "/salary/table/4000", "/basis", "/feedback"]) {
    it(`GET ${path} → 200 HTML`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("<!doctype html>");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    });
  }
  it("연봉 페이지는 쿼리로 결과까지 서버 렌더링", async () => {
    const body = await (await get("/salary?annual=40000000&nonTaxable=200000&asOf=2026-10-10")).text();
    expect(body).toContain("월 실수령액");
    expect(body).toContain("근로소득 간이세액표");
  });
  it("없는 연봉표는 404", async () => {
    expect((await get("/salary/table/4050")).status).toBe(404);
    expect((await get("/salary/table/abc")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });
  it("health / robots / sitemap", async () => {
    const h = (await (await get("/api/health")).json()) as Record<string, unknown>;
    expect(h.상태).toBe("정상");
    expect(h.기준연도).toBe(2026);
    expect(await (await get("/robots.txt")).text()).toContain("Sitemap:");
    expect(await (await get("/sitemap.xml")).text()).toContain("/salary/table/4000");
  });
});
