import { expect, test } from "@playwright/test";
import { choose, expectHero, expectNoHorizontalScroll, fill, heroValue, toInt } from "./helpers";

const AS_OF = "2026-10-10"; // 기준일을 고정해 날짜에 따라 결과가 흔들리지 않게 한다

test.describe("연봉 계산기", () => {
  test("E01 기본값 결과가 서버 렌더링과 손계산 값으로 나온다", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await expectHero(page, 2_935_813);
    await expect(page.locator("#result")).toContainText("근로소득 간이세액표");
    await expect(page.locator("#result .badge").first()).toHaveText("2026년 기준");
  });

  test("E02 입력을 바꾸면 즉시 재계산·한글 금액·URL 반영", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await fill(page, "#f-annual", "50000000");
    await expect(page.locator("#f-annual")).toHaveValue("50,000,000");
    await expect(page.locator('[data-hangul="annual"]')).toHaveText("5천만 원");
    await expect.poll(() => heroValue(page)).toBeGreaterThan(3_500_000);
    await expect.poll(() => page.url()).toContain("annual=50000000");
  });

  test("E03 빠른 입력 칩", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await page.getByRole("button", { name: "6,000만" }).click();
    await expect(page.locator("#f-annual")).toHaveValue("60,000,000");
    await expect(page.locator('[data-hangul="annual"]')).toHaveText("6천만 원");
  });

  test("E04 부양가족을 늘리면 소득세가 줄어 실수령이 늘어난다", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    const before = await heroValue(page);
    await page.getByRole("button", { name: "부양가족 수 늘리기" }).click();
    await expect.poll(() => heroValue(page)).toBeGreaterThan(before);
  });

  test("E05 역산: 희망 월 실수령 300만원 → 필요 연봉, 그 연봉으로 순방향 계산하면 300만원 이상", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await choose(page, "월 실수령 → 필요 연봉");
    await expect(page.locator("#f-targetNet")).toBeVisible();
    await fill(page, "#f-targetNet", "3000000");
    await expect(page.locator("#result")).toContainText("필요 연봉");
    const need = await heroValue(page);
    expect(need % 10_000).toBe(0);
    await page.goto(`/salary?asOf=${AS_OF}&annual=${need}`);
    const net = toInt(await page.locator("#result .r-sub b").first().textContent());
    expect(net).toBeGreaterThanOrEqual(3_000_000 * 12);
    await page.goto(`/salary?asOf=${AS_OF}&annual=${need - 10_000}`);
    const netBelow = toInt(await page.locator("#result .r-sub b").first().textContent());
    expect(netBelow).toBeLessThan(3_000_000 * 12);
  });

  test("E06 연봉을 비우면 오류 문구와 aria-invalid, 결과는 오류 안내", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await page.locator("#f-annual").fill("");
    await expect(page.locator("#e-annual")).toContainText("입력해 주세요");
    await expect(page.locator("#f-annual")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#result .result-error")).toBeVisible();
    await fill(page, "#f-annual", "40000000");
    await expect(page.locator("#e-annual")).toBeHidden();
    await expectHero(page, 2_935_813);
  });

  test("E07 범위 밖(500원)은 오류", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}`);
    await fill(page, "#f-annual", "500");
    await expect(page.locator("#e-annual")).toContainText("사이로 입력");
  });

  test("E08 퇴직금 포함이면 월 총지급액이 연봉÷13", async ({ page }) => {
    await page.goto(`/salary?asOf=${AS_OF}&severance=1`);
    await expect(page.locator("#result .kv")).toContainText("3,076,923원");
  });
});

test.describe("급여 계산기", () => {
  test("E09 월급제: 수당 추가·연장근로 → 연장근로수당 행", async ({ page }) => {
    await page.goto(`/payroll?asOf=${AS_OF}`);
    await page.getByRole("button", { name: "식대 20만원(비과세) 추가" }).click();
    await page.getByRole("button", { name: "+ 수당 추가" }).click();
    await expectNoHorizontalScroll(page); // 수당 행이 늘어도 가로로 넘치지 않는다
    await page.getByRole("button", { name: "수당 삭제" }).last().click();
    await fill(page, "#f-overtime", "10");
    await expect(page.locator("#result")).toContainText("연장근로수당");
    await expect(page.locator("#result")).toContainText("식대");
    const g = await page.locator("#result .kv dd").first().textContent();
    // 추가 버튼의 식대는 비통상임금(통상시급 계산에서 제외)이 기본값
    expect(toInt(g)).toBe(2_800_000 + 200_000 + Math.floor(Math.floor(2_800_000 / 209) * 1.5 * 10));
    await page.getByRole("button", { name: "수당 삭제" }).click();
    await expect(page.locator("#result")).not.toContainText("식대");
  });

  test("E10 시급제: 최저시급 주 40시간 = 월 209시간 2,156,880원", async ({ page }) => {
    await page.goto(`/payroll?asOf=${AS_OF}`);
    await choose(page, "시급제 (아르바이트·계약직)");
    await choose(page, "공제 없음");
    await expect(page.locator("#f-wage")).toBeVisible();
    await expectHero(page, 2_156_880);
    await expect(page.locator("#result")).toContainText("최저임금 충족");
    await fill(page, "#f-wage", "9000");
    await expect(page.locator("#result")).toContainText("미달");
  });
});

test.describe("4대보험 계산기", () => {
  test("E11 월 300만원 → 근로자 합계 291,520원, 사업주 343,120원", async ({ page }) => {
    await page.goto(`/insurance?asOf=${AS_OF}&monthly=3000000`);
    await expectHero(page, 291_520);
    await expect(page.locator("#result")).toContainText("343,120원");
  });

  test("E12 기준일에 따라 국민연금 상한이 바뀐다 (7/1 전후)", async ({ page }) => {
    await page.goto(`/insurance?monthly=7000000&asOf=2026-10-10`);
    await expect(page.locator("#result tbody tr").first()).toContainText("313,020원");
    await expect(page.locator("#result")).toContainText("상한 적용");
    await page.locator("#f-asOf").fill("2026-03-01");
    await page.locator("#f-asOf").dispatchEvent("change");
    await expect(page.locator("#result tbody tr").first()).toContainText("302,570원");
  });
});

test.describe("프리랜서 계산기", () => {
  test("E13 3.3%: 100만원 → 실수령 967,000원, 역산", async ({ page }) => {
    await page.goto(`/freelancer?asOf=${AS_OF}&amount=1000000`);
    await expectHero(page, 967_000);
    await choose(page, "받고 싶은 실수령 → 세전");
    await fill(page, "#f-amount", "967000");
    await expect(page.locator("#result")).toContainText("필요한 세전 금액");
    await expectHero(page, 1_000_000);
  });

  test("E14 5월 종합소득세: 수입 3,600만·단순경비율 64.1% → 환급 511,020원", async ({ page }) => {
    await page.goto(`/freelancer?tab=tax&asOf=${AS_OF}&revenue=36000000`);
    await expect(page.locator("#result")).toContainText("예상 환급액");
    await expectHero(page, 511_020);
  });

  test("E15 월 실수령 종합: 결과가 숫자로 나오고 지역 건보료가 포함된다", async ({ page }) => {
    await page.goto(`/freelancer?tab=net&asOf=${AS_OF}&revenue=36000000`);
    await expect(page.locator("#result")).toContainText("건강보험 (지역, 월)");
    expect(await heroValue(page)).toBeGreaterThan(1_500_000);
  });
});
