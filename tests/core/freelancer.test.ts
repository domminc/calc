import { describe, expect, it } from "vitest";
import { resolveRates } from "../../src/core/rates.ts";
import {
  bracketTax,
  calcAnnualTax,
  calcNet,
  calcRegional,
  grossFromNet33,
  parseFreelancerInput,
  withholding33,
} from "../../src/core/freelancer.ts";

const resolved = resolveRates("2026-10-10");
const rates = resolved.set.rates;

describe("3.3% 원천징수", () => {
  it("UT-F1 100만원 → 3만 + 3천 → 967,000 [V-13]", () => {
    expect(withholding33(1_000_000)).toMatchObject({ tax: 30_000, local: 3_000, net: 967_000, exempt: false });
  });
  it("UT-F2 소액부징수: 소득세 1,000원 미만이면 0 [V-14]", () => {
    expect(withholding33(33_333)).toMatchObject({ tax: 0, local: 0, net: 33_333, exempt: true });
    expect(withholding33(33_334)).toMatchObject({ tax: 1_000, local: 100 });
  });
  it("UT-F3 역산: 실수령 967,000 → 세전 1,000,000, 항상 순방향과 일치", () => {
    expect(grossFromNet33(967_000)).toBe(1_000_000);
    for (const net of [100_000, 500_000, 1_234_567, 2_900_000, 9_670_000, 48_350_000]) {
      const g = grossFromNet33(net);
      const got = withholding33(g).net;
      expect(got).toBeGreaterThanOrEqual(net);
      // 정확히 맞는 세전액이 없을 때만 실수령이 목표보다 크고, 그때는 한 단계 낮은 세전액이 목표에 못 미친다
      if (got > net) expect(withholding33(g - 1).net).toBeLessThan(net);
    }
    // 정확히 맞는 값이 존재하는 경우는 정확히 맞춘다
    for (const gross of [100_000, 777_777, 1_500_000, 3_333_333, 12_345_678]) {
      expect(withholding33(grossFromNet33(withholding33(gross).net)).net).toBe(withholding33(gross).net);
    }
  });
});

describe("종합소득세 세율표 — 소득세법 제55조 경계값", () => {
  it("UT-F4 구간 경계의 기준액 (84만 / 624만 / 1,536만 / 3,706만 / 9,406만 / 1억7,406만 / 3억8,406만) [V-15]", () => {
    expect(bracketTax(rates, 14_000_000).tax).toBe(840_000);
    expect(bracketTax(rates, 50_000_000).tax).toBe(6_240_000);
    expect(bracketTax(rates, 88_000_000).tax).toBe(15_360_000);
    expect(bracketTax(rates, 150_000_000).tax).toBe(37_060_000);
    expect(bracketTax(rates, 300_000_000).tax).toBe(94_060_000);
    expect(bracketTax(rates, 500_000_000).tax).toBe(174_060_000);
    expect(bracketTax(rates, 1_000_000_000).tax).toBe(384_060_000);
  });
  it("UT-F5 구간 안: 15% 구간·45% 구간", () => {
    expect(bracketTax(rates, 20_000_000).tax).toBe(840_000 + 900_000);
    expect(bracketTax(rates, 1_100_000_000).tax).toBe(384_060_000 + 45_000_000);
  });
});

describe("5월 종합소득세 정산 (손계산 값)", () => {
  const base = { revenue: 36_000_000, expenseMode: "rate" as const, expenseRate: 0.641, actualExpense: 0, persons: 1, children: 0, pensionPaid: 0, otherDeduction: 0, prepaidOverride: undefined };
  it("UT-F6 수입 3,600만 · 단순경비율 64.1% · 본인만 → 환급 511,020 [V-16]", () => {
    const r = calcAnnualTax(rates, base);
    expect(r.expense).toBe(23_076_000);
    expect(r.income).toBe(12_924_000);
    expect(r.taxBase).toBe(11_424_000);
    expect(r.computedTax).toBe(685_440);
    expect(r.determinedTax).toBe(615_440);
    expect(r.localTax).toBe(61_540);
    expect(r.prepaidTax).toBe(1_080_000);
    expect(r.settleIncomeTax).toBe(-464_560);
    expect(r.settleLocalTax).toBe(-46_460);
    expect(r.settleTotal).toBe(-511_020);
  });
  it("UT-F7 자녀 2명: 자녀세액공제 55만", () => {
    const r = calcAnnualTax(rates, { ...base, persons: 3, children: 2 });
    expect(r.credits.child).toBe(550_000);
    expect(r.deductions.basic).toBe(4_500_000);
  });
  it("UT-F8 실제 경비가 수입보다 크면 수입까지만", () => {
    const r = calcAnnualTax(rates, { ...base, expenseMode: "actual", actualExpense: 99_000_000 });
    expect(r.expense).toBe(36_000_000);
    expect(r.income).toBe(0);
    expect(r.determinedTax).toBe(0);
  });
  it("UT-F9 기납부세액 직접 지정", () => {
    const r = calcAnnualTax(rates, { ...base, prepaidOverride: 0 });
    expect(r.prepaidTax).toBe(0);
    expect(r.settleIncomeTax).toBe(615_440);
  });
});

describe("지역가입자 건강보험·국민연금", () => {
  it("UT-F10 연 소득금액 1,200만(월 100만): 건강 71,900 · 장기요양 9,440 · 연금 95,000 [V-17]", () => {
    const r = calcRegional(rates, { annualIncome: 12_000_000, propertyScore: 0, asOf: "2026-10-10" });
    expect(r.nhis).toBe(71_900);
    expect(r.ltc).toBe(9_440);
    expect(r.nps).toBe(95_000);
  });
  it("UT-F11 재산 점수 반영: 점수 × 211.5원", () => {
    const r = calcRegional(rates, { annualIncome: 12_000_000, propertyScore: 1000, asOf: "2026-10-10" });
    expect(r.nhis).toBe(Math.floor((71_900 + 211_500) / 10) * 10);
  });
  it("UT-F12 소득이 없으면 건강보험 최저 20,160, 국민연금 0", () => {
    const r = calcRegional(rates, { annualIncome: 0, propertyScore: 0, asOf: "2026-10-10" });
    expect(r.nhis).toBe(20_160);
    expect(r.nps).toBe(0);
  });
  it("UT-F13 국민연금 하한·상한", () => {
    expect(calcRegional(rates, { annualIncome: 2_400_000, propertyScore: 0, asOf: "2026-10-10" }).npsBase).toBe(410_000);
    expect(calcRegional(rates, { annualIncome: 200_000_000, propertyScore: 0, asOf: "2026-10-10" }).npsBase).toBe(6_590_000);
  });
});

describe("월 실수령 종합", () => {
  it("UT-F14 국민연금 납부액이 소득공제로 세금을 줄인다", () => {
    const common = { revenue: 60_000_000, expenseMode: "rate", expenseRate: 50, persons: 1 };
    const withNps = calcNet(parseFreelancerInput({ ...common, tab: "net", regionalNps: "1", asOf: "2026-10-10" }).value, resolved);
    const noNps = calcNet(parseFreelancerInput({ ...common, tab: "net", regionalNps: "0", asOf: "2026-10-10" }).value, resolved);
    expect(withNps.tax.deductions.pension).toBe(withNps.regional.nps * 12);
    expect(withNps.tax.totalTax).toBeLessThan(noNps.tax.totalTax);
    expect(withNps.netMonthly).toBeLessThan(noNps.netMonthly); // 연금 납부분만큼 실수령은 줄어듦
  });
  it("UT-F15 경비율 입력은 % 단위", () => {
    const p = parseFreelancerInput({ expenseRate: "64.1" });
    expect(p.value.expenseRate).toBeCloseTo(0.641, 6);
    expect(parseFreelancerInput({ expenseRate: "120" }).errors.expenseRate).toBeTruthy();
  });
});
