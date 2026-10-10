import { describe, expect, it } from "vitest";
import { RATE_SETS, SUPPORTED_YEARS, deepMerge, rateNotices, resolveRates } from "../../src/core/rates.ts";
import { calcInsurance } from "../../src/core/insurance.ts";
import { calcSalary, parseSalaryInput } from "../../src/core/salary.ts";
import { calcPayroll, parsePayrollInput } from "../../src/core/payroll.ts";
import { compute } from "../../src/render/calculators.ts";

describe("시행일 기준 요율 세트 (법이 바뀌면 시행일에 맞춰 자동 전환)", () => {
  it("UT-R1 세트는 시행일 순서이고 2026(확정)·2027(잠정)이 있다", () => {
    expect(SUPPORTED_YEARS).toEqual([2026, 2027]);
    expect(RATE_SETS.map((s) => s.status)).toEqual(["final", "provisional"]);
    for (let i = 1; i < RATE_SETS.length; i++) expect(RATE_SETS[i]!.effectiveFrom > RATE_SETS[i - 1]!.effectiveFrom).toBe(true);
  });

  it("UT-R2 기준일에 따라 세트가 바뀐다: 2026-12-31 → 2026, 2027-01-01 → 2027", () => {
    expect(resolveRates("2026-12-31").set.year).toBe(2026);
    expect(resolveRates("2027-01-01").set.year).toBe(2027);
    expect(resolveRates("2026-12-31").fallback).toBeUndefined();
  });

  it("UT-R3 2027 은 확정된 것만 바뀌고 나머지는 2026 값을 물려받는다", () => {
    const a = resolveRates("2026-10-10").set.rates;
    const b = resolveRates("2027-03-01").set.rates;
    expect(a.nps.rate).toBe(0.095);
    expect(b.nps.rate).toBe(0.1);
    expect(b.labor.minHourlyWage).toBe(10_700);
    expect(a.labor.minHourlyWage).toBe(10_320);
    expect(b.nhis.rate).toBe(a.nhis.rate); // 7.19% 동결
    expect(b.nhis.ltc).toEqual(a.nhis.ltc); // 미확정 → 잠정 승계
    expect(b.ei).toEqual(a.ei);
    expect(resolveRates("2027-03-01").set.withholdingYear).toBe(2026); // 2027 간이세액표 공포 전 → 2026 표
  });

  it("UT-R4 같은 월급이라도 2027 에는 국민연금이 5%(10% 의 절반)로 계산된다", () => {
    const r26 = calcInsurance(resolveRates("2026-10-10").set.rates, { taxableMonthly: 3_000_000, asOf: "2026-10-10" });
    const r27 = calcInsurance(resolveRates("2027-03-01").set.rates, { taxableMonthly: 3_000_000, asOf: "2027-03-01" });
    expect(r26.rows[0]!.worker).toBe(142_500);
    expect(r27.rows[0]!.worker).toBe(150_000);
    expect(r27.workerTotal - r26.workerTotal).toBe(7_500);
  });

  it("UT-R5 연봉 계산이 기준일에 따라 달라지고, 2027 에는 잠정 안내가 붙는다", () => {
    const p = (asOf: string) => parseSalaryInput({ annual: 40_000_000, asOf }).value;
    const n26 = calcSalary(p("2026-10-10")).netMonthly;
    const n27 = calcSalary(p("2027-03-01")).netMonthly;
    expect(n27).toBeLessThan(n26);
    const out = compute("salary", { annual: 40_000_000, asOf: "2027-03-01" });
    expect(out.html).toContain("2027년 요율은 일부만 확정돼 있어요");
    expect(out.html).toContain("장기요양보험료율");
    expect(compute("salary", { annual: 40_000_000, asOf: "2026-10-10" }).html).not.toContain("일부만 확정");
  });

  it("UT-R6 2027 최저임금이 급여 계산기에 반영된다", () => {
    const run = (asOf: string) => calcPayroll(parsePayrollInput({ kind: "hourly", wage: 10_500, weekly: 40, deduction: "none", asOf }).value);
    expect(run("2026-10-10").minWage.ok).toBe(true);
    expect(run("2027-02-01").minWage.ok).toBe(false); // 10,500 < 10,700
  });

  it("UT-R7 기준일이 마지막 세트의 연도를 넘으면 마지막 세트로 계산하고 알린다", () => {
    const r = resolveRates("2028-05-01");
    expect(r.set.year).toBe(2027);
    expect(r.fallback).toEqual({ requestedYear: 2028, usedYear: 2027 });
    expect(rateNotices(r).some((n) => n.code === "rates-fallback")).toBe(true);
  });

  it("UT-R8 간이세액표 시행일(2026-03-01) 이전 기준일은 안내한다", () => {
    expect(rateNotices(resolveRates("2026-02-10")).some((n) => n.code === "withholding-before")).toBe(true);
    expect(rateNotices(resolveRates("2026-03-01")).some((n) => n.code === "withholding-before")).toBe(false);
  });

  it("UT-R9 deepMerge: 객체는 합치고 배열은 바꿔 끼운다", () => {
    expect(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [9] } })).toEqual({ a: { b: 1, c: [9] }, d: 1 });
  });

  it("UT-R10 2026 기준일 결과는 이전과 같다 (회귀)", () => {
    const r = calcSalary(parseSalaryInput({ annual: 40_000_000, nonTaxable: 200_000, asOf: "2026-10-10" }).value);
    expect(r.netMonthly).toBe(2_935_813);
  });
});
