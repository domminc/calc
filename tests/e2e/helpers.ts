import { expect, type Page } from "@playwright/test";

export const hero = (page: Page) => page.locator("#result [data-hero]").first();

/** 숫자 문자열 "2,935,813" → 2935813 */
export const toInt = (s: string | null) => Number((s ?? "").replace(/[^\d-]/g, ""));

export async function heroValue(page: Page): Promise<number> {
  return toInt(await hero(page).textContent());
}

/** 입력 후 결과가 바뀔 때까지 기다린다 (150ms 디바운스) */
export async function fill(page: Page, selector: string, value: string) {
  const el = page.locator(selector);
  await el.fill("");
  await el.pressSequentially(value, { delay: 5 });
}

export async function expectNoHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "가로 스크롤이 생기면 안 돼요").toBeLessThanOrEqual(1);
}

/** 결과 숫자가 expected 가 될 때까지 */
export async function expectHero(page: Page, expected: number) {
  await expect.poll(() => heroValue(page), { timeout: 5000 }).toBe(expected);
}

/** 세그먼트(라디오) 선택. 입력 요소가 라벨 위에 겹쳐 있어 텍스트가 아니라 라디오를 직접 선택한다. */
export async function choose(page: Page, name: string | RegExp) {
  await page.getByRole("radio", { name }).check();
}
