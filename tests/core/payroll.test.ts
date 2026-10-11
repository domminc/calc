import { describe, expect, it } from "vitest";
import { resolveRates } from "../../src/core/rates.ts";
import { calcPayroll, parsePayrollInput } from "../../src/core/payroll.ts";

const resolved = resolveRates("2026-10-10");
const run = (raw: Record<string, string | number>) => calcPayroll(parsePayrollInput({ asOf: "2026-10-10", ...raw }).value, resolved);

describe("급여 계산기 — 월급제", () => {
  it("UT-P1 통상시급 = (기본급+통상수당)/209, 연장수당 1.5배", () => {
    const r = run({ basePay: 2_800_000, al0_name: "식대", al0_amount: 200_000, al0_nt: "1", overtime: 10 });
    expect(r.ordinaryHourly).toBe(14_354); // 3,000,000 / 209
    const ot = r.earnings.find((e) => e.key === "ot")!;
    expect(ot.amount).toBe(Math.floor(14_354 * 1.5 * 10)); // 215,310
    expect(r.gross).toBe(3_000_000 + 215_310);
    expect(r.nonTaxable).toBe(200_000);
    expect(r.taxable).toBe(3_015_310);
    expect(r.net).toBe(r.gross - r.totalDeduction);
  });
  it("UT-P2 휴일 8시간 초과분은 2.0배, 야간은 가산분 0.5배", () => {
    const r = run({ basePay: 2_090_000, night: 4, holiday8: 3 });
    expect(r.ordinaryHourly).toBe(10_000);
    expect(r.earnings.find((e) => e.key === "night")!.amount).toBe(20_000);
    expect(r.earnings.find((e) => e.key === "holiday8")!.amount).toBe(60_000);
  });
  it("UT-P3 통상시급이 최저임금 미만이면 경고", () => {
    const r = run({ basePay: 2_000_000 });
    expect(r.minWage.ok).toBe(false);
    expect(r.notices.some((n) => n.code === "min-wage")).toBe(true);
  });
  it("UT-P4 공제 없음 선택. 3.3% 는 프리랜서 계산기 몫이라 옛 링크의 deduction=tax33 은 4대보험+세금으로 열린다", () => {
    const none = run({ basePay: 3_000_000, deduction: "none" });
    expect(none.totalDeduction).toBe(0);
    const legacy = run({ basePay: 3_000_000, deduction: "tax33" });
    const normal = run({ basePay: 3_000_000 });
    expect(legacy.input.deductionMode).toBe("insurance");
    expect(legacy.totalDeduction).toBe(normal.totalDeduction);
  });
  it("UT-P5 수당 입력 오류는 필드 오류로", () => {
    const p = parsePayrollInput({ al0_name: "식대", al0_amount: "abc" });
    expect(p.errors.al0_amount).toBeTruthy();
  });
});

describe("급여 계산기 — 시급제", () => {
  it("UT-P6 주 40시간: 174 + 35 = 209시간, 최저시급이면 월 2,156,880 [V-18]", () => {
    const r = run({ kind: "hourly", wage: 10_320, weekly: 40, deduction: "none" });
    expect(r.monthlyHours).toBe(209);
    expect(r.gross).toBe(2_156_880);
    expect(r.minWage.ok).toBe(true);
  });
  it("UT-P7 주 20시간: 주휴 4시간 → 월 87 + 17시간", () => {
    const r = run({ kind: "hourly", wage: 12_000, weekly: 20, deduction: "none" });
    expect(r.earnings.find((e) => e.key === "base")!.amount).toBe(12_000 * 87);
    expect(r.earnings.find((e) => e.key === "weekly-holiday")!.amount).toBe(12_000 * 17);
  });
  it("UT-P8 주 15시간 미만은 주휴수당 없음", () => {
    const r = run({ kind: "hourly", wage: 12_000, weekly: 14, deduction: "none" });
    expect(r.earnings.some((e) => e.key === "weekly-holiday")).toBe(false);
  });
  it("UT-P9 최저임금 미만 시급 경고", () => {
    const r = run({ kind: "hourly", wage: 9_000, weekly: 40, deduction: "none" });
    expect(r.minWage.ok).toBe(false);
  });
});
