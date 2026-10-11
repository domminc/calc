import { describe, expect, it } from "vitest";
import { SPLIT_STEPS, optimizeCouple } from "../../src/core/yearend-couple.ts";
import { emptyPerson, evaluate, prepare, yearContext, type Dep, type PersonInput } from "../../src/core/yearend.ts";

const ctx = yearContext(2026);
const person = (o: Partial<PersonInput> = {}): PersonInput => ({
  ...emptyPerson(),
  gross: 50_000_000,
  npsOverride: 2_000_000,
  healthOverride: 1_500_000,
  prepaidOverride: 3_000_000,
  ...o,
});
const dep = (o: Partial<Dep> = {}): Dep => ({ rel: "child", year: 2016, highIncome: false, medical: 0, education: 0, premium: 0, credit: 0, debit: 0, ...o });
const tax = (r: { determinedTax: number; localTax: number }) => r.determinedTax + r.localTax;

describe("부부 공제 배분 비교", () => {
  it("UT-C1 세율이 높은 쪽이 자녀를 공제받는 게 유리하다 (소득 9,000만 vs 3,000만)", () => {
    // A: 과세표준 24% 구간, B: 15% 구간 → 기본공제 150만원의 세금 효과가 A 쪽이 9%p 더 크다
    const r = optimizeCouple(ctx, person({ gross: 90_000_000 }), person({ gross: 30_000_000 }), [dep()], 0, 0);
    expect(r.marginalA).toBeGreaterThan(r.marginalB);
    expect(r.best.maskB).toBe(0); // 자녀는 A
    expect(r.moves[0]!.owner).toBe("A");
    expect(r.moves[0]!.costIfMoved).toBeGreaterThanOrEqual(100_000); // 옮기면 약 13.5만원 손해
    // 추천안이 곧 "모두 A" 이므로 단순안 대비 절감액(saving)은 0, 대신 "모두 B" 안은 세금이 더 나온다
    expect(r.saving).toBe(0);
    expect(r.allB.total - r.best.total).toBeGreaterThanOrEqual(100_000);
  });

  it("UT-C2 반대로 B 의 세율이 높으면 B 가 공제받는다", () => {
    const r = optimizeCouple(ctx, person({ gross: 30_000_000 }), person({ gross: 90_000_000 }), [dep()], 0, 0);
    expect(r.best.maskB).toBe(1);
    expect(r.moves[0]!.owner).toBe("B");
  });

  it("UT-C3 공동 카드 지출은 한쪽으로 몰아야 한다 (각자 최저사용금액 미달이면 나눌수록 손해)", () => {
    // 각자 총급여 5,000만(최저사용금액 1,250만). 공동 신용카드 2,000만을 반씩(1,000만) 나누면 둘 다 공제 0.
    // 한쪽에 몰면 (2,000만−1,250만)×15% = 1,125,000
    const r = optimizeCouple(ctx, person(), person(), [], 20_000_000, 0);
    expect(r.best.shareB === 0 || r.best.shareB === SPLIT_STEPS).toBe(true);
    expect(r.best.a.card.deduction + r.best.b.card.deduction).toBe(1_125_000);
    expect(r.cardIfAllA + r.cardIfAllB).toBeGreaterThanOrEqual(0);
  });

  it("UT-C4 나눌 항목이 없으면 계산은 한 번이고 절세액은 0", () => {
    const r = optimizeCouple(ctx, person(), person(), [], 0, 0);
    expect(r.evaluated).toBe(1);
    expect(r.saving).toBe(0);
    expect(r.best.maskB).toBe(0);
  });

  it("UT-C5 부양가족 6명 + 공동 지출: 경우의 수 64 × 11 = 704, 시간은 충분히 짧다", () => {
    const deps = [dep({ year: 2016 }), dep({ year: 2018 }), dep({ year: 2021, medical: 2_000_000 }), dep({ rel: "parent", year: 1950, medical: 3_000_000 }), dep({ rel: "parent", year: 1955 }), dep({ year: 2012, education: 4_000_000 })];
    const t0 = performance.now();
    const r = optimizeCouple(ctx, person({ gross: 80_000_000 }), person({ gross: 35_000_000 }), deps, 15_000_000, 5_000_000);
    const ms = performance.now() - t0;
    expect(r.evaluated).toBe(704);
    expect(ms).toBeLessThan(1500); // CI 여유. 실제로는 수십 ms
  });

  it("UT-C6 추천안은 모든 조합을 직접 계산한 최소값과 같다 (무작위 사례 25개 교차 검증)", () => {
    let seed = 20261011;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    for (let t = 0; t < 25; t++) {
      const a = person({ gross: 20_000_000 + rnd(120) * 1_000_000, credit: rnd(30) * 1_000_000, debit: rnd(10) * 1_000_000, medical: rnd(5) * 1_000_000, pensionSavings: rnd(8) * 1_000_000 });
      const b = person({ gross: 20_000_000 + rnd(120) * 1_000_000, credit: rnd(30) * 1_000_000, debit: rnd(10) * 1_000_000, medical: rnd(5) * 1_000_000, premium: rnd(3) * 1_000_000 });
      const deps: Dep[] = Array.from({ length: 1 + rnd(4) }, () =>
        dep({ rel: rnd(3) === 0 ? "parent" : "child", year: rnd(3) === 0 ? 1945 + rnd(20) : 2008 + rnd(16), medical: rnd(6) * 1_000_000, education: rnd(5) * 1_000_000, credit: rnd(8) * 1_000_000, premium: rnd(2) * 1_000_000 }),
      );
      const sc = rnd(20) * 1_000_000;
      const sd = rnd(8) * 1_000_000;
      const r = optimizeCouple(ctx, a, b, deps, sc, sd);

      // 독립적인 전수 계산
      const baseA = prepare(ctx, a);
      const baseB = prepare(ctx, b);
      let min = Number.POSITIVE_INFINITY;
      for (let mask = 0; mask < 1 << deps.length; mask++) {
        for (let s = 0; s <= SPLIT_STEPS; s++) {
          const dA = deps.filter((_, i) => !((mask >> i) & 1));
          const dB = deps.filter((_, i) => (mask >> i) & 1);
          const bc = Math.floor((sc * s) / SPLIT_STEPS);
          const bd = Math.floor((sd * s) / SPLIT_STEPS);
          const ra = evaluate(ctx, baseA, a, dA, { credit: sc - bc, debit: sd - bd });
          const rb = evaluate(ctx, baseB, b, dB, { credit: bc, debit: bd });
          min = Math.min(min, tax(ra) + tax(rb));
        }
      }
      expect(r.best.total).toBe(min);
      expect(r.best.total).toBeLessThanOrEqual(r.allA.total);
      expect(r.best.total).toBeLessThanOrEqual(r.allB.total);
      for (const m of r.moves) expect(m.costIfMoved).toBeGreaterThanOrEqual(0); // 어떤 가족도 옮겨서 더 싸지지 않는다
    }
  });
});
