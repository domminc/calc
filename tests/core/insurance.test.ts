import { describe, expect, it } from "vitest";
import { resolveRates } from "../../src/core/rates.ts";
import { calcInsurance } from "../../src/core/insurance.ts";

const rates = resolveRates("2026-10-10").set.rates;
const row = (r: ReturnType<typeof calcInsurance>, key: string) => r.rows.find((x) => x.key === key)!;

describe("4대보험 — docs/FORMULAS.md §2 고정 벡터", () => {
  it("월 300만원: 근로자 합 291,520", () => {
    const r = calcInsurance(rates, { taxableMonthly: 3_000_000, asOf: "2026-10-10" });
    expect(row(r, "nps").worker).toBe(142_500);
    expect(row(r, "nhis").worker).toBe(107_850);
    expect(row(r, "ltc").worker).toBe(14_170);
    expect(row(r, "ei").worker).toBe(27_000);
    expect(r.workerTotal).toBe(291_520);
  });

  it("월 200만원: 공단 모의계산 예시 (건강 71,900 · 장기요양 9,440)", () => {
    const r = calcInsurance(rates, { taxableMonthly: 2_000_000, asOf: "2026-10-10" });
    expect(row(r, "nhis").worker).toBe(71_900);
    expect(row(r, "ltc").worker).toBe(9_440);
    expect(row(r, "nhis").worker + row(r, "ltc").worker).toBe(81_340);
  });

  it("사업주 부담: 150인 미만·산재 1.47% → 343,120", () => {
    const r = calcInsurance(rates, { taxableMonthly: 3_000_000, asOf: "2026-10-10", size: "lt150" });
    expect(row(r, "ei").employer).toBe(34_500);
    expect(row(r, "wci").employer).toBe(44_100);
    expect(r.employerTotal).toBe(343_120);
  });

  it("국민연금 상한: 7/1 이후 6,590,000 · 이전 6,370,000", () => {
    const after = calcInsurance(rates, { taxableMonthly: 7_000_000, asOf: "2026-10-10" });
    const before = calcInsurance(rates, { taxableMonthly: 7_000_000, asOf: "2026-03-01" });
    expect(after.npsBase).toBe(6_590_000);
    expect(row(after, "nps").worker).toBe(313_020);
    expect(row(after, "nps").badge).toBe("상한 적용");
    expect(before.npsBase).toBe(6_370_000);
    expect(row(before, "nps").worker).toBe(302_570);
  });

  it("국민연금 하한: 월 30만원 → 410,000 기준 19,470", () => {
    const r = calcInsurance(rates, { taxableMonthly: 300_000, asOf: "2026-10-10" });
    expect(r.npsBase).toBe(410_000);
    expect(row(r, "nps").worker).toBe(19_470);
    expect(row(r, "nps").badge).toBe("하한 적용");
  });

  it("건강보험 상·하한 clamp", () => {
    const hi = calcInsurance(rates, { taxableMonthly: 200_000_000, asOf: "2026-10-10" });
    expect(row(hi, "nhis").worker).toBe(4_591_740);
    expect(row(hi, "nhis").badge).toBe("상한 적용");
    const lo = calcInsurance(rates, { taxableMonthly: 100_000, asOf: "2026-10-10" });
    expect(row(lo, "nhis").worker).toBe(10_080);
  });

  it("0원이면 모두 0", () => {
    const r = calcInsurance(rates, { taxableMonthly: 0, asOf: "2026-10-10" });
    expect(r.total).toBe(0);
  });
});
