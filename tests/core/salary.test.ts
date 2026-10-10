import { describe, expect, it } from "vitest";
import { resolveRates } from "../../src/core/rates.ts";
import { calcSalary, parseSalaryInput, solveAnnualForNet } from "../../src/core/salary.ts";

const resolved = resolveRates("2026-10-10");
const wh = resolved.set.withholding;
/** 독립 구현: 선형 탐색으로 표를 조회 */
function tableTax(T: number, f: number): number {
  const k = T / 1000;
  for (const b of wh.bands) if (b[0]! <= k && k < b[1]!) return b[1 + f]!;
  return 0;
}
const input = (raw: Record<string, string | number>) => parseSalaryInput({ asOf: "2026-10-10", ...raw }).value;
const L = (r: ReturnType<typeof calcSalary>, key: string) => r.lines.find((l) => l.key === key)!.amount;

describe("연봉 계산기", () => {
  it("UT-S1 연봉 4,000만원 (비과세 20만, 가족 1명) — 손계산 값과 일치 [V-12]", () => {
    const r = calcSalary(input({ annual: 40_000_000 }), resolved);
    expect(r.monthlyGross).toBe(3_333_333);
    expect(r.taxableMonthly).toBe(3_133_333);
    expect(L(r, "nps")).toBe(148_810); // 3,133,000 × 4.75% = 148,817.5 → 10원 절사
    expect(L(r, "nhis")).toBe(112_640); // 3,133,333 × 3.595%
    expect(L(r, "ltc")).toBe(14_800);
    expect(L(r, "ei")).toBe(28_190);
    expect(L(r, "tax")).toBe(tableTax(3_133_333, 1));
    expect(L(r, "local")).toBe(Math.floor((tableTax(3_133_333, 1) * 0.1) / 10) * 10);
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(r.totalDeduction).toBe(sum);
    expect(r.netMonthly).toBe(r.monthlyGross - sum);
    expect(r.netAnnual).toBe(r.netMonthly * 12);
  });

  it("UT-S2 퇴직금 포함: 월 지급액 = 연봉 ÷ 13", () => {
    const r = calcSalary(input({ annual: 40_000_000, severance: "1" }), resolved);
    expect(r.monthlyGross).toBe(Math.floor(40_000_000 / 13));
  });

  it("UT-S3 비과세가 월급보다 크면 월급까지만", () => {
    const r = calcSalary(input({ annual: 10_000_000, nonTaxable: 5_000_000 }), resolved);
    expect(r.nonTaxable).toBe(r.monthlyGross);
    expect(r.taxableMonthly).toBe(0);
    expect(r.notices.some((n) => n.code === "nontax-capped")).toBe(true);
  });

  it("UT-S4 월 과세급여 770천원 미만: 소득세 0 안내", () => {
    const r = calcSalary(input({ annual: 10_000_000, nonTaxable: 100_000 }), resolved);
    expect(r.incomeTax).toBe(0);
    expect(r.notices.some((n) => n.code === "tax-zero")).toBe(true);
  });

  it("UT-S5 자녀 수가 가족 수를 넘으면 보정", () => {
    const p = parseSalaryInput({ asOf: "2026-10-10", annual: 50_000_000, family: 1, children: 2 });
    expect(p.value.family).toBe(3);
    expect(p.adjusted.length).toBe(1);
  });

  it("UT-S6 범위 밖 연봉은 오류", () => {
    const p = parseSalaryInput({ annual: 500 });
    expect(p.errors.annual).toBeTruthy();
    expect(parseSalaryInput({ annual: "abc" }).errors.annual).toBeTruthy();
    expect(parseSalaryInput({ annual: "40,000,000" }).errors.annual).toBeUndefined();
  });

  it("UT-S7 연봉이 오를수록 월 실수령은 줄지 않는다 (1천만~3억, 100만원 간격)", () => {
    let prev = -1;
    for (let a = 10_000_000; a <= 300_000_000; a += 1_000_000) {
      const net = calcSalary(input({ annual: a }), resolved).netMonthly;
      expect(net).toBeGreaterThanOrEqual(prev);
      prev = net;
    }
  });

  it("UT-S8 사업주 부담과 인건비 총액", () => {
    const r = calcSalary(input({ annual: 36_000_000, nonTaxable: 0 }), resolved);
    expect(r.monthlyGross).toBe(3_000_000);
    expect(r.insurance.employerTotal).toBe(343_120);
    expect(r.employerCost).toBe(3_343_120);
  });

  it("UT-S9 역산: 찾은 연봉의 월 실수령 ≥ 목표 > 1만원 낮은 연봉의 월 실수령", () => {
    for (const target of [1_500_000, 2_500_000, 3_000_000, 5_000_000, 8_000_000]) {
      const base = input({ mode: "reverse", targetNet: target });
      const s = solveAnnualForNet(base, resolved);
      expect(s.reachable).toBe(true);
      expect(s.result.netMonthly).toBeGreaterThanOrEqual(target);
      expect(s.annual % 10_000).toBe(0);
      const below = calcSalary({ ...base, annual: s.annual - 10_000, mode: "forward" }, resolved).netMonthly;
      expect(below).toBeLessThan(target);
    }
  });
});
