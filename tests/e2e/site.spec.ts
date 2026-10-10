import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, heroValue } from "./helpers";

const AS_OF = "2026-10-10";
const PAGES = ["/", "/salary", "/payroll", "/insurance", "/freelancer", "/salary/table", "/salary/table/4000", "/basis", "/feedback"];

test.describe("공통·접근성", () => {
  for (const path of PAGES) {
    test(`E20 ${path}: 가로 스크롤 없음·콘솔 오류 없음·lang·h1 하나`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await expectNoHorizontalScroll(page);
      expect(errors).toEqual([]);
      await expect(page.locator("html")).toHaveAttribute("lang", "ko");
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    for (const path of ["/", "/salary", "/payroll", "/insurance", "/freelancer", "/basis"]) {
      test(`E21 axe(${scheme}) ${path}: 심각·중대 위반 없음`, async ({ browser }, info) => {
        const ctx = await browser.newContext({ colorScheme: scheme, viewport: info.project.use.viewport ?? { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(`${path}${path.startsWith("/salary") || path === "/payroll" || path === "/insurance" || path === "/freelancer" ? `?asOf=${AS_OF}` : ""}`);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
        await ctx.close();
      });
    }
  }
});

test.describe("공유·내려받기·신고", () => {
  test("E30 링크 만들기 → /r/{id} 에서 같은 결과", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}&annual=40000000`);
    const before = await heroValue(page);
    await page.getByRole("button", { name: "링크 만들기" }).click();
    const link = page.locator("[data-share-out] a");
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    expect(href).toMatch(/\/r\/[0-9A-Za-z]{8}$/);
    await page.goto(new URL(href).pathname);
    await expect(page.locator("h1")).toContainText("공유된 연봉 계산기 결과");
    expect(await heroValue(page)).toBe(before);
    await page.getByRole("link", { name: "이 입력으로 다시 계산하기" }).click();
    await expect(page).toHaveURL(/\/salary\?/);
  });

  test("E31 엑셀·PDF 내려받기 링크가 현재 입력을 따른다", async ({ page, request }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await page.locator("#f-annual").fill("45,000,000");
    await expect.poll(() => page.locator('[data-export="xlsx"]').getAttribute("href")).toContain("annual=45000000");
    const x = await request.get((await page.locator('[data-export="xlsx"]').getAttribute("href"))!);
    expect(x.status()).toBe(200);
    expect(x.headers()["content-type"]).toContain("spreadsheetml");
    const p = await request.get((await page.locator('[data-export="pdf"]').getAttribute("href"))!);
    expect(p.status()).toBe(200);
    expect(p.headers()["content-type"]).toBe("application/pdf");
    expect((await p.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("E32 오류 신고 제출 → 접수 안내", async ({ page }) => {
    await page.goto("/feedback?c=insurance");
    await expect(page.locator("#f-calculator")).toHaveValue("insurance");
    await page.locator("#f-message").fill("건강보험이 20원 달라요 (e2e)");
    await page.getByRole("button", { name: "보내기" }).click();
    await expect(page.getByRole("status")).toContainText("접수되었어요");
  });
});

test.describe("SEO·기준 페이지", () => {
  test("E40 연봉표 상세: 제목·FAQ JSON-LD·이전/다음 링크", async ({ page }) => {
    await page.goto("/salary/table/4000");
    await expect(page).toHaveTitle(/연봉 4,000만원 실수령액 \d{4}/);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2);
    await expect(page.getByRole("link", { name: /3,900만원/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /4,100만원/ })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/salary\/table\/4000$/);
  });

  test("E41 계산 기준: 미확정 항목 8개와 간이세액표 구간 수가 공개된다", async ({ page }) => {
    await page.goto("/basis");
    for (const id of ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"]) await expect(page.getByRole("cell", { name: id, exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("646개 구간");
    await expect(page.locator("body")).toContainText("1,400만원 이하".replace("만원 이하", "") === "" ? "" : "6%");
  });

  test("E42 sitemap·robots", async ({ request }) => {
    const s = await (await request.get("/sitemap.xml")).text();
    expect(s).toContain("/salary/table/4000");
    expect((s.match(/<url>/g) ?? []).length).toBeGreaterThan(60);
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /api/");
  });

  test("E43 보안 헤더", async ({ request }) => {
    const r = await request.get("/salary");
    const h = r.headers();
    expect(h["content-security-policy"]).toContain("script-src 'self'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
  });
});

test.describe("JS 없이", () => {
  test.use({ javaScriptEnabled: false });
  test("E50 서버 렌더링 결과 + 폼 제출(GET)", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}&annual=40000000`);
    await expect(page.locator("#result [data-hero]")).toHaveText("2,935,813");
    await page.locator("#f-annual").fill("50,000,000");
    await page.getByRole("button", { name: "계산하기" }).click();
    await expect(page).toHaveURL(/annual=50%2C000%2C000|annual=50,000,000/);
    expect(await heroValue(page)).toBeGreaterThan(3_500_000);
  });
});

test.describe("모바일", () => {
  test("E60 하단 고정 요약바: 결과가 화면 밖일 때만", async ({ page, isMobile }) => {
    test.skip(!isMobile, "모바일 전용");
    await page.goto(`/salary?asOf=${AS_OF}`);
    await expect(page.locator("[data-sticky]")).toBeVisible();
    await expect(page.locator("[data-sb-value]")).toHaveText("2,935,813원");
    await page.locator("#result").scrollIntoViewIfNeeded();
    await expect(page.locator("[data-sticky]")).toBeHidden();
  });
});

test.describe("폰트 (Pretendard 다이나믹 서브셋)", () => {
  test("E70 Pretendard 만 로드하고, 필요한 서브셋 조각만 내려받는다", async ({ page }) => {
    const fonts: string[] = [];
    page.on("response", (r) => {
      if (/\.(woff2?|ttf|otf)(\?|$)/.test(r.url())) fonts.push(new URL(r.url()).pathname);
    });
    await page.goto("/salary?asOf=2026-10-10");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Pretendard Variable/);
    expect(await page.evaluate(() => document.fonts.check('16px "Pretendard Variable"', "연봉 실수령액 2,935,813원"))).toBe(true);
    expect(fonts.length, "한글 화면에서 서브셋 파일을 한 개 이상 받는다").toBeGreaterThan(0);
    // 실측: 페이지당 11~14개(273~346KB). 전체 92개(3.1MB)를 받지 않는 것이 핵심이라 여유를 두고 25개 미만으로 본다.
    expect(fonts.length, "다이나믹 서브셋이라 전체(92개)를 받지 않는다").toBeLessThan(25);
    for (const f of fonts) expect(f).toMatch(/^\/fonts\/woff2-dynamic-subset\/PretendardVariable\.subset\.\d+\.woff2$/);
    const css = await (await page.request.get("/fonts/pretendard.css")).text();
    expect(css).toContain("font-display: swap");
    const head = await page.request.get(fonts[0]!);
    expect(head.headers()["cache-control"]).toContain("immutable");
  });
});


const BEFORE_2027 = new Date() < new Date("2027-01-01T00:00:00+09:00");

test.describe("새 디자인: 테마·슬라이더·빠른 계산·탭바·법령 감시", () => {
  test("E80 테마 토글: 다크로 바꾸면 저장되고 새로고침해도 유지된다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /화면 테마 바꾸기/ }).click();
    const t1 = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(["light", "dark"]).toContain(t1);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(t1);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(t1 === "dark" ? "rgb(9, 11, 10)" : "rgb(244, 246, 243)");
  });

  test("E81 슬라이더 ↔ 숫자 입력이 서로 연동되고 결과가 바뀐다", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    const before = await heroValue(page);
    await page.locator('input.range[data-range-for="annual"]').fill("80000000");
    await expect(page.locator("#f-annual")).toHaveValue("80,000,000");
    await expect.poll(() => heroValue(page)).toBeGreaterThan(before);
    await page.locator("#f-annual").fill("30000000");
    await expect(page.locator('input.range[data-range-for="annual"]')).toHaveValue("30000000");
  });

  test("E82 홈 빠른 계산기: 연봉을 바꾸면 월 실수령액과 이동 링크가 바뀐다", async ({ page }) => {
    await page.goto("/");
    const net0 = await page.locator("[data-q-net]").textContent();
    await page.locator("#q-annual").fill("60000000");
    await expect.poll(async () => page.locator("[data-q-net]").textContent()).not.toBe(net0);
    await expect(page.locator("[data-q-link]")).toHaveAttribute("href", "/salary?annual=60000000");
    await expect(page.locator("[data-q-hangul]")).toHaveText("6천만 원");
    await page.locator("#q-annual").fill("500");
    await expect(page.locator("[data-q-sub]")).toContainText("사이로 입력");
  });

  test("E83 탭바: 모바일에서만 보이고, 데스크톱은 상단 메뉴", async ({ page, isMobile }) => {
    await page.goto("/salary?asOf=" + AS_OF);
    if (isMobile) {
      await expect(page.locator(".tabbar")).toBeVisible();
      await expect(page.locator(".nav")).toBeHidden();
      await expect(page.locator(".tabbar a[aria-current=page]")).toContainText("연봉");
    } else {
      await expect(page.locator(".tabbar")).toBeHidden();
      await expect(page.locator(".nav a[aria-current=page]")).toHaveText("연봉");
    }
  });

  test("E84 결과 도넛은 넓은 결과 카드에서만 보인다", async ({ page, isMobile }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    if (isMobile) await expect(page.locator(".donut")).toBeHidden();
    else await expect(page.locator(".donut")).toBeVisible();
  });

  test("E85 '곧 바뀌는 것' 안내: 접이식, 확정/확정 전 구분 (2027 이전)", async ({ page }) => {
    test.skip(!BEFORE_2027, "2027년부터는 현재 세트가 2027 이라 안내가 없다");
    await page.goto(`/freelancer?asOf=${AS_OF}`);
    const box = page.locator("details.upcoming");
    await expect(box).toBeVisible();
    await expect(box.locator("summary")).toContainText("2027-01-01부터 바뀌어요");
    await box.locator("summary").click();
    await expect(box).toContainText("확정 전");
    await expect(box).toContainText("원천징수 세율");
    await expect(box.locator(".tag-ok").first()).toBeVisible();
  });

  test("E86 계산 기준: 다음 해 변경표와 법령 변경 감시 현황", async ({ page }) => {
    await page.goto("/basis");
    await expect(page.locator("#watch")).toHaveText("법령 변경 감시");
    await expect(page.locator("#watch + p")).toContainText("마지막 확인");
    await expect(page.locator("#watch + p")).toContainText("매일");
    if (BEFORE_2027) {
      await expect(page.locator("#next")).toContainText("2027년 변경");
      await expect(page.locator("main")).toContainText("국민연금 보험료율 10.0%");
      await expect(page.locator("main")).toContainText("확정 전");
    }
  });

  test("E87 기준일이 2027 이면 잠정 안내와 국민연금 10% 가 반영된다 (시행일 자동 전환)", async ({ page }) => {
    await page.goto("/insurance?asOf=2027-03-01&monthly=3000000");
    await expect(page.locator("#result")).toContainText("2027년 요율은 일부만 확정돼 있어요");
    await expect(page.locator("#result tbody tr").first()).toContainText("150,000원"); // 국민연금 근로자 5.0%
    await page.goto("/insurance?asOf=2026-12-31&monthly=3000000");
    await expect(page.locator("#result tbody tr").first()).toContainText("142,500원");
  });
});
