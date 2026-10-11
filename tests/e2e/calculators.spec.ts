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

  test("E13b 고용보험 공제율 0.9% 입력 → 계약금 − 3.3% − 0.9% = 958,000원, 0.8%(법정)이면 959,000원", async ({ page }) => {
    await page.goto(`/freelancer?asOf=${AS_OF}&amount=1000000&eiRate=0.9`);
    await expectHero(page, 958_000);
    await expect(page.locator("#result")).toContainText("고용보험 (0.9%)");
    await expect(page.locator("#result")).toContainText("입력하신 공제율");
    await fill(page, "#f-eiRate", "0.8");
    await expectHero(page, 959_000);
    await expect(page.locator("#result")).toContainText("법정 본인 부담");
    await fill(page, "#f-eiRate", "0");
    await expectHero(page, 967_000);
    await expect(page.locator("#result")).not.toContainText("고용보험 (");
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

test.describe("연말정산 계산기", () => {
  const ME = `/yearend?asOf=${AS_OF}&a_gross=50000000&a_nt=0&a_nps=2000000&a_hi=1500000&a_tax=3000000`;

  test("E95 내 연말정산: 총급여 5,000만·이미 낸 세금 300만 → 환급 151,250원", async ({ page }) => {
    await page.goto(ME);
    await expect(page.locator("#result")).toContainText("예상 환급액");
    await expectHero(page, 151_250);
    await expect(page.locator("#result")).toContainText("근로소득세액공제");
    await expect(page.locator("#result")).toContainText("이 계산기가 반영하지 않는 항목");
  });

  test("E96 입력을 바꾸면 즉시 재계산되고, 의료비를 넣으면 결과가 달라진다", async ({ page }) => {
    await page.goto(ME);
    await expectHero(page, 151_250);
    await page.locator("details.more", { hasText: "의료비·교육비·보험료" }).first().locator("summary").click();
    await fill(page, "#f-a_med", "5000000");
    await expect.poll(() => heroValue(page)).toBeGreaterThan(151_250); // 의료비 공제로 환급이 늘어난다
    await expect.poll(() => page.url()).toContain("a_med=5000000");
  });

  test("E97 부양가족 추가·삭제: 자녀를 추가하면 세금이 줄고, 삭제하면 되돌아온다", async ({ page }) => {
    await page.goto(ME);
    await expectHero(page, 151_250);
    await page.getByRole("button", { name: "+ 부양가족 추가" }).click();
    await expect(page.locator("[data-dep-row]")).toHaveCount(1);
    await expect.poll(() => heroValue(page)).not.toBe(151_250);
    await page.getByRole("button", { name: "부양가족 삭제" }).click();
    await expect(page.locator("[data-dep-row]")).toHaveCount(0);
    await expectHero(page, 151_250);
  });

  test("E98 부양가족은 6명까지만 추가된다", async ({ page }) => {
    await page.goto(ME);
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "+ 부양가족 추가" }).click();
    await expect(page.locator("[data-dep-row]")).toHaveCount(6);
  });

  test("E99 부부 비교: 소득이 높은 쪽(나)이 자녀를 공제받는 안이 추천되고, 반대로 하면 세금이 늘어난다", async ({ page }) => {
    await page.goto(`/yearend?asOf=${AS_OF}&tab=couple&a_gross=90000000&b_gross=30000000&a_nt=0&b_nt=0&a_nps=2000000&a_hi=1500000&a_tax=3000000&b_nps=2000000&b_hi=1500000&b_tax=3000000&d0_rel=child&d0_year=2016`);
    await expectHero(page, 4_743_605);
    await expect(page.locator("#result")).toContainText("부양가족은 누가 공제받을까");
    await expect(page.locator("#result .move-list")).toContainText("나가 공제받기");
    await expect(page.locator("#result")).toContainText("+305,395원");
  });

  test("E100 부부 탭 전환: 배우자 입력칸이 나타나고 배우자 행은 부양가족에 넣을 수 없다", async ({ page }) => {
    await page.goto(ME);
    await expect(page.locator("#f-b_gross")).toBeHidden();
    await choose(page, "부부 중 누가 공제받을까");
    await expect(page.locator("#f-b_gross")).toBeVisible();
    await expect(page.locator("#result")).toContainText("부부 합계");
  });

  test("E101 잘못된 출생연도는 오류로 알려준다", async ({ page }) => {
    await page.goto(`${ME}&d0_rel=child&d0_year=2016`);
    await fill(page, "#f-d0_year", "1800");
    await expect(page.locator("#result")).toContainText("입력값을 확인해 주세요");
  });

  test("E102 한 명이 프리랜서인 부부: 프리랜서는 5월 종소세로 계산된다 (나 환급 577,020원)", async ({ page }) => {
    await page.goto(`/yearend?asOf=${AS_OF}&tab=couple&a_kind=freelancer&a_rev=36000000&a_fnps=1000000&b_gross=60000000&b_nt=0&b_nps=2000000&b_hi=1500000&b_tax=4000000&d0_rel=child&d0_year=2016&d0_edu=3000000&sc=30000000`);
    const r = page.locator("#result");
    await expect(r).toContainText("5월 종소세 포함");
    await expect(r).toContainText("프리랜서가 있을 때 달라지는 점");
    await expect(r).toContainText("나 −577,020원");
    await expect(r).toContainText("나의(프리랜서) 계산 과정");
    await expect(r.locator(".move-list")).toContainText("배우자가 공제받기"); // 교육비 있는 자녀는 근로자가
    await expect(r).toContainText("배우자의 카드로 모두 쓰는 게 유리해요"); // 공동 카드도 근로자 쪽
  });

  test("E103 소득 유형 전환: 프리랜서를 고르면 수입 입력이 나오고, 내 연말정산 탭으로 돌아가면 근로자로 되돌아온다", async ({ page }) => {
    await page.goto(`/yearend?asOf=${AS_OF}&tab=couple`);
    await expect(page.locator("#f-a_rev")).toBeHidden();
    await page.getByRole("radio", { name: "프리랜서 (5월 종소세)" }).first().check();
    await expect(page.locator("#f-a_rev")).toBeVisible();
    await expect(page.locator("#f-a_gross")).toBeHidden();
    await expect(page.locator("#result")).toContainText("5월 종소세 포함");
    await choose(page, "내 연말정산 예측");
    await expect(page.locator("#f-a_gross")).toBeVisible();
    await expect(page.locator("#f-a_rev")).toBeHidden();
    await expect(page.locator("#result")).not.toContainText("5월 종소세 포함");
  });

  test("E104 프리랜서 경비율·실제 경비 전환과 오류 표시", async ({ page }) => {
    await page.goto(`/yearend?asOf=${AS_OF}&tab=couple&b_kind=freelancer&b_rev=36000000`);
    await expect(page.locator("#f-b_xr")).toBeVisible();
    await expect(page.locator("#f-b_xa")).toBeHidden();
    await page.getByRole("radio", { name: "실제 경비" }).check();
    await expect(page.locator("#f-b_xa")).toBeVisible();
    await expect(page.locator("#f-b_xr")).toBeHidden();
    await page.getByRole("radio", { name: "단순경비율" }).check();
    await fill(page, "#f-b_xr", "120");
    await expect(page.locator("#result")).toContainText("입력값을 확인해 주세요");
  });
});
