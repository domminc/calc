import { describe, expect, it } from "vitest";
import { calcAnnualTax } from "../../src/core/freelancer.ts";
import { SPLIT_STEPS, optimizeCouple } from "../../src/core/yearend-couple.ts";
import { parseYearendInput } from "../../src/core/yearend-input.ts";
import { emptyPerson, evaluate, prepare, yearContext, type Dep, type PersonInput } from "../../src/core/yearend.ts";

const ctx = yearContext(2026);
const free = (o: Partial<PersonInput> = {}): PersonInput => ({ ...emptyPerson(), kind: "freelancer", revenue: 36_000_000, expenseRate: 0.641, npsOverride: 1_000_000, ...o });
const worker = (o: Partial<PersonInput> = {}): PersonInput => ({ ...emptyPerson(), gross: 60_000_000, npsOverride: 2_000_000, healthOverride: 1_500_000, prepaidOverride: 4_000_000, ...o });
const dep = (o: Partial<Dep> = {}): Dep => ({ rel: "child", year: 2016, highIncome: false, medical: 0, education: 0, premium: 0, credit: 0, debit: 0, ...o });
const run = (p: PersonInput, deps: Dep[] = []) => evaluate(ctx, prepare(ctx, p), p, deps);

describe("프리랜서(사업소득) 종합소득세 — 연말정산 부부 비교용", () => {
  it("UT-FY1 손계산: 수입 3,600만·단순경비율 64.1%·국민연금 100만 → 환급 577,020원", () => {
    // 경비 23,076,000 → 소득금액 12,924,000 − 기본공제 1,500,000 − 국민연금 1,000,000 = 과세표준 10,424,000
    // 6% → 625,440 − 표준세액공제 70,000 = 결정 555,440, 지방 55,540(10원 미만 절사)
    // 기납부 3% = 1,080,000 + 지방 108,000
    const r = run(free());
    expect(r.kind).toBe("freelancer");
    expect(r.earnedDeduction).toBe(23_076_000);
    expect(r.earnedIncome).toBe(12_924_000);
    expect(r.taxBase).toBe(10_424_000);
    expect(r.computedTax).toBe(625_440);
    expect(r.credits.standard).toBe(70_000);
    expect(r.credits.earned).toBe(0);
    expect(r.determinedTax).toBe(555_440);
    expect(r.localTax).toBe(55_540);
    expect(r.prepaidTax).toBe(1_080_000);
    expect(r.settleTotal).toBe(-577_020);
  });

  it("UT-FY2 기존 5월 종합소득세 계산(calcAnnualTax)과 같은 결과 (부모 2명 부양, 연금 공제 없음)", () => {
    for (const revenue of [12_000_000, 36_000_000, 80_000_000, 150_000_000]) {
      const p = free({ revenue, npsOverride: 1_200_000 });
      const deps = [dep({ rel: "parent", year: 1950 }), dep({ rel: "parent", year: 1955 })];
      const mine = run(p, deps);
      const old = calcAnnualTax(ctx.rates, { revenue, expenseMode: "rate", expenseRate: 0.641, actualExpense: 0, persons: 3, children: 0, pensionPaid: 1_200_000, otherDeduction: 0, prepaidOverride: undefined });
      // 70세 이상 경로우대 100만원이 있어 (1950년생 76세, 1955년생 71세) 소득공제가 더 많다 → 같은 조건으로 비교하려고 경로우대를 뺀다
      const oldWithSenior = calcAnnualTax(ctx.rates, { revenue, expenseMode: "rate", expenseRate: 0.641, actualExpense: 0, persons: 3, children: 0, pensionPaid: 1_200_000, otherDeduction: 2_000_000, prepaidOverride: undefined });
      expect(mine.determinedTax).toBe(oldWithSenior.determinedTax);
      expect(mine.localTax).toBe(oldWithSenior.localTax);
      expect(mine.prepaidTax).toBe(old.prepaidTax);
      expect(mine.settleTotal).toBe(oldWithSenior.settleTotal);
    }
  });

  it("UT-FY3 연금계좌세액공제: 소득금액 4,500만 이하 15%, 초과 12%", () => {
    // 수입 1억·경비율 64.1% → 소득 35,900,000, 국민연금 200만, 기본공제 150만 → 과세표준 32,400,000
    // 15% 구간: 32,400,000 × 15% − 1,260,000 = 3,600,000. 연금저축 600만 × 15% = 900,000, 표준 70,000
    const r = run(free({ revenue: 100_000_000, npsOverride: 2_000_000, pensionSavings: 6_000_000 }));
    expect(r.computedTax).toBe(3_600_000);
    expect(r.credits.pension).toBe(900_000);
    expect(r.determinedTax).toBe(3_600_000 - 900_000 - 70_000);
    // 소득금액 4,500만 초과(수입 2억 → 소득 71,800,000)이면 12%
    const hi = run(free({ revenue: 200_000_000, npsOverride: 2_000_000, pensionSavings: 6_000_000 }));
    expect(hi.credits.pension).toBe(720_000);
  });

  it("UT-FY4 자녀세액공제·인적공제는 받지만 가족의 의료비·교육비·카드는 반영하지 않는다", () => {
    const base = run(free(), [dep()]);
    const withExpenses = run(free(), [dep({ medical: 5_000_000, education: 3_000_000, credit: 9_000_000 })]);
    expect(base.credits.child).toBe(250_000);
    expect(base.basic).toBe(3_000_000);
    expect(withExpenses.determinedTax).toBe(base.determinedTax);
    expect(withExpenses.credits.education).toBe(0);
    expect(withExpenses.card.deduction).toBe(0);
    expect(withExpenses.notices.some((n) => n.code === "fl-lost")).toBe(true);
  });

  it("UT-FY5 국민연금을 비우면 지역가입자 추정, 직접 입력하면 그 값", () => {
    const est = prepare(ctx, free({ npsOverride: undefined }));
    expect(est.npsEstimated).toBe(true);
    expect(est.nps).toBeGreaterThan(0);
    expect(prepare(ctx, free({ npsOverride: 777_000 })).nps).toBe(777_000);
  });

  it("UT-FY6 필요경비가 수입 이상이면 소득 0 · 기납부 3% 전액 환급", () => {
    const r = run(free({ expenseMode: "actual", actualExpense: 99_000_000 }));
    expect(r.earnedIncome).toBe(0);
    expect(r.determinedTax).toBe(0);
    expect(r.settleTotal).toBe(-(1_080_000 + 108_000));
  });
});

describe("한 명이 프리랜서인 부부 비교", () => {
  it("UT-FY7 공동 카드 지출은 근로자 쪽으로 몰고, 교육비가 있는 자녀는 근로자가 공제받는다", () => {
    const a = free(); // 나: 프리랜서
    const b = worker(); // 배우자: 정규직
    const r = optimizeCouple(ctx, a, b, [dep({ education: 3_000_000 })], 30_000_000, 0); // 근로자 총급여 6,000만 → 최저사용금액 1,500만원
    expect(r.best.shareB).toBe(SPLIT_STEPS); // 공동 카드는 전부 배우자(근로자) 카드
    expect(r.best.a.card.deduction).toBe(0);
    expect(r.best.maskB).toBe(1); // 자녀는 배우자(근로자)
    expect(r.best.b.credits.education).toBeGreaterThan(0);
    expect(r.moves[0]!.costIfMoved).toBeGreaterThan(0);
  });

  it("UT-FY8 프리랜서 본인의 지출은 공제 불가지만, 근로자 배우자가 낸 '배우자 의료비'는 공제된다", () => {
    const a = free();
    const b = worker({ medicalSpouse: 5_000_000 });
    const noMed = evaluate(ctx, prepare(ctx, b), worker(), []);
    const withMed = evaluate(ctx, prepare(ctx, b), b, []);
    expect(withMed.credits.medical).toBeGreaterThan(noMed.credits.medical);
    // 프리랜서가 의료비를 입력해도 반영되지 않는다
    const ra = evaluate(ctx, prepare(ctx, free({ medical: 9_000_000 })), free({ medical: 9_000_000 }), []);
    expect(ra.credits.medical).toBe(0);
    expect(a.kind).toBe("freelancer");
  });

  it("UT-FY9 최적성: 무작위 15사례를 독립적인 전수 계산과 비교", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    for (let t = 0; t < 15; t++) {
      const a = rnd(2) ? free({ revenue: 10_000_000 + rnd(150) * 1_000_000, pensionSavings: rnd(7) * 1_000_000 }) : worker({ gross: 20_000_000 + rnd(100) * 1_000_000 });
      const b = rnd(2) ? free({ revenue: 10_000_000 + rnd(150) * 1_000_000 }) : worker({ gross: 20_000_000 + rnd(100) * 1_000_000, medicalSpouse: rnd(4) * 1_000_000 });
      const deps = Array.from({ length: 1 + rnd(3) }, () => dep({ year: 2008 + rnd(16), education: rnd(4) * 1_000_000, medical: rnd(3) * 1_000_000 }));
      const sc = rnd(15) * 1_000_000;
      const r = optimizeCouple(ctx, a, b, deps, sc, 0);
      const baseA = prepare(ctx, a);
      const baseB = prepare(ctx, b);
      let min = Number.POSITIVE_INFINITY;
      for (let mask = 0; mask < 1 << deps.length; mask++) {
        for (let s = 0; s <= SPLIT_STEPS; s++) {
          const dA = deps.filter((_, i) => !((mask >> i) & 1));
          const dB = deps.filter((_, i) => (mask >> i) & 1);
          const bc = Math.floor((sc * s) / SPLIT_STEPS);
          const ra = evaluate(ctx, baseA, a, dA, { credit: sc - bc, debit: 0 });
          const rb = evaluate(ctx, baseB, b, dB, { credit: bc, debit: 0 });
          min = Math.min(min, ra.determinedTax + ra.localTax + rb.determinedTax + rb.localTax);
        }
      }
      expect(r.best.total).toBe(min);
    }
  });
});

describe("입력 해석 (프리랜서 선택)", () => {
  it("UT-FY10 부부 탭에서만 소득 유형을 고를 수 있다", () => {
    const q = { a_kind: "freelancer", a_rev: "48000000", a_xr: "50", a_fnps: "1,200,000".replaceAll(",", ""), a_ftax: "1000000", a_fps: "3000000", tab: "couple", asOf: "2026-10-10" };
    const couple = parseYearendInput(q);
    expect(couple.errors).toEqual({});
    expect(couple.value.a).toMatchObject({ kind: "freelancer", revenue: 48_000_000, expenseMode: "rate", expenseRate: 0.5, npsOverride: 1_200_000, prepaidOverride: 1_000_000, pensionSavings: 3_000_000 });
    expect(couple.value.b.kind).toBe("worker");
    const me = parseYearendInput({ ...q, tab: "me" });
    expect(me.value.a.kind).toBe("worker");
  });

  it("UT-FY11 경비율 범위를 벗어나면 오류", () => {
    const r = parseYearendInput({ tab: "couple", b_kind: "freelancer", b_xr: "120", asOf: "2026-10-10" });
    expect(r.errors.b_xr).toContain("0~100");
  });

  it("UT-FY12 실제 경비 방식과 기본 단순경비율", () => {
    const r = parseYearendInput({ tab: "couple", b_kind: "freelancer", b_xm: "actual", b_xa: "5000000", asOf: "2026-10-10" });
    expect(r.value.b).toMatchObject({ expenseMode: "actual", actualExpense: 5_000_000 });
    expect(r.value.b.expenseRate).toBeCloseTo(0.641, 6);
  });
});
