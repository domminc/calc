import { describe, expect, it } from "vitest";
import { app } from "../../src/server/app.ts";
import type { Env } from "../../src/server/env.ts";

const env = { ASSETS: { fetch: async () => new Response("asset") } } as unknown as Env;
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {} } as unknown as ExecutionContext;
const get = (path: string) => app.request(`http://localhost${path}`, {}, env, ctx);

describe("페이지 스모크", () => {
  for (const path of ["/", "/salary", "/payroll", "/insurance", "/freelancer", "/salary/table", "/salary/table/4000", "/basis", "/feedback"]) {
    it(`SM-01 GET ${path} → 200 HTML`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("<!doctype html>");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    });
  }
  it("SM-02 연봉 페이지는 쿼리로 결과까지 서버 렌더링", async () => {
    const body = await (await get("/salary?annual=40000000&nonTaxable=200000&asOf=2026-10-10")).text();
    expect(body).toContain("월 실수령액");
    expect(body).toContain("근로소득 간이세액표");
  });
  it("SM-03 없는 연봉표는 404", async () => {
    expect((await get("/salary/table/4050")).status).toBe(404);
    expect((await get("/salary/table/abc")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });
  it("SM-04 health / robots / sitemap", async () => {
    const h = (await (await get("/api/health")).json()) as Record<string, unknown>;
    expect(h.상태).toBe("정상");
    expect(h.기준연도).toBe(2026);
    expect(await (await get("/robots.txt")).text()).toContain("Sitemap:");
    expect(await (await get("/sitemap.xml")).text()).toContain("/salary/table/4000");
  });
  it("SM-05 DB 없음: 공유는 503 안내, 계산 페이지·API 는 정상", async () => {
    const res = await app.request("http://localhost/api/share", { method: "POST", body: JSON.stringify({ calculator: "insurance", inputs: { monthly: "3000000" } }), headers: { "content-type": "application/json" } }, env, ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("unavailable");
    const calc = (await (await get("/api/calc/salary?annual=40000000&asOf=2026-10-10")).json()) as { ok: boolean; summary: { value: string } };
    expect(calc.ok).toBe(true);
    expect(calc.summary.value).toBe("2,935,813원");
  });
  it("SM-06 DB·R2 없음: 신고는 503 페이지, 내려받기는 정상 생성", async () => {
    const fb = await app.request("http://localhost/api/feedback", { method: "POST", body: new URLSearchParams({ calculator: "salary", message: "x" }), headers: { "content-type": "application/x-www-form-urlencoded" } }, env, ctx);
    expect(fb.status).toBe(503);
    expect(await fb.text()).toContain("지금은 접수할 수 없어요");
    const x = await get("/api/export/xlsx?c=insurance&monthly=3000000&asOf=2026-10-10");
    expect(x.status).toBe(200);
    expect(x.headers.get("x-cache")).toBe("miss");
  });
  it("UT-X1 XSS: 수당 이름의 HTML 은 이스케이프된다 (결과·폼 양쪽)", async () => {
    const evil = "<i onmouseover=1>"; // 수당 이름은 20자까지만 받는다
    const html = await (await get(`/payroll?asOf=2026-10-10&al0_name=${encodeURIComponent(evil)}&al0_amount=100000`)).text();
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;i onmouseover=1&gt;");
    const q = await (await get(`/salary?asOf=2026-10-10&annual=${encodeURIComponent('"><script>alert(1)</script>')}`)).text();
    expect(q).not.toContain("<script>alert(1)</script>");
  });
});
