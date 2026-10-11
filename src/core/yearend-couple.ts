// 부부 중 누가 공제받아야 유리한지: 부양가족 배분(모든 조합)과 공동 카드 지출 분할을 전부 계산해 세금 합계가 가장 낮은 안을 찾는다.
// 식·가정은 docs/FORMULAS.md §10.8
import type { Dep, PersonBase, PersonInput, PersonResult, YearCtx } from "./yearend.ts";
import { baseEligible, evaluate, prepare } from "./yearend.ts";

/** 공동 지출을 나누는 단위 (10% 씩) */
export const SPLIT_STEPS = 10;

export interface Plan {
  /** 비트 i = 1 → i 번째 부양가족을 배우자(B)가 공제받는다 */
  maskB: number;
  /** 공동 카드 지출 중 B 몫 (0~SPLIT_STEPS) */
  shareB: number;
  a: PersonResult;
  b: PersonResult;
  /** 두 사람의 결정세액 + 지방소득세 합계 (적을수록 유리) */
  total: number;
}

export interface DepMove {
  index: number;
  dep: Dep;
  owner: "A" | "B";
  /** 이 가족을 반대편으로 옮기면 세금이 늘어나는 금액 (0 이면 어느 쪽이든 같음) */
  costIfMoved: number;
  /** 기본공제 대상인가 (아니어도 의료비 등은 공제받는 쪽에서 쓰인다) */
  eligible: boolean;
}

export interface CoupleResult {
  baseA: PersonBase;
  baseB: PersonBase;
  best: Plan;
  allA: Plan;
  allB: Plan;
  /** 추천안이 두 단순안 중 더 싼 쪽보다 아끼는 금액 */
  saving: number;
  moves: DepMove[];
  /** 공동 카드 지출을 모두 한쪽으로 몰았을 때 추천안 대비 늘어나는 세금 */
  cardIfAllA: number;
  cardIfAllB: number;
  marginalA: number;
  marginalB: number;
  /** 평가한 경우의 수 */
  evaluated: number;
}

const taxOf = (r: PersonResult): number => r.determinedTax + r.localTax;

function plan(ctx: YearCtx, baseA: PersonBase, baseB: PersonBase, a: PersonInput, b: PersonInput, deps: readonly Dep[], sc: number, sd: number, maskB: number, shareB: number): Plan {
  const depsA: Dep[] = [];
  const depsB: Dep[] = [];
  deps.forEach((d, i) => ((maskB >> i) & 1 ? depsB : depsA).push(d));
  const bCredit = Math.floor((sc * shareB) / SPLIT_STEPS);
  const bDebit = Math.floor((sd * shareB) / SPLIT_STEPS);
  const ra = evaluate(ctx, baseA, a, depsA, { credit: sc - bCredit, debit: sd - bDebit });
  const rb = evaluate(ctx, baseB, b, depsB, { credit: bCredit, debit: bDebit });
  return { maskB, shareB, a: ra, b: rb, total: taxOf(ra) + taxOf(rb) };
}

export function optimizeCouple(ctx: YearCtx, a: PersonInput, b: PersonInput, deps: readonly Dep[], sharedCredit: number, sharedDebit: number): CoupleResult {
  const baseA = prepare(ctx, a);
  const baseB = prepare(ctx, b);
  const n = deps.length;
  const hasShared = sharedCredit > 0 || sharedDebit > 0;
  const full = (1 << n) - 1;
  const p = (mask: number, share: number) => plan(ctx, baseA, baseB, a, b, deps, sharedCredit, sharedDebit, mask, share);

  let best = p(0, 0);
  let evaluated = 1;
  for (let mask = 0; mask <= full; mask++) {
    for (let s = 0; s <= (hasShared ? SPLIT_STEPS : 0); s++) {
      if (mask === 0 && s === 0) continue;
      const q = p(mask, s);
      evaluated++;
      if (q.total < best.total) best = q;
    }
  }

  const allA = p(0, 0);
  const allB = p(full, hasShared ? SPLIT_STEPS : 0);
  const baseline = Math.min(allA.total, allB.total);

  const moves: DepMove[] = deps.map((dep, index) => {
    const flipped = p(best.maskB ^ (1 << index), best.shareB);
    return {
      index,
      dep,
      owner: (best.maskB >> index) & 1 ? "B" : "A",
      costIfMoved: Math.max(0, flipped.total - best.total),
      eligible: baseEligible(ctx.rates.yearend, ctx.year, dep),
    };
  });
  const cardIfAllA = hasShared ? Math.max(0, p(best.maskB, 0).total - best.total) : 0;
  const cardIfAllB = hasShared ? Math.max(0, p(best.maskB, SPLIT_STEPS).total - best.total) : 0;

  return {
    baseA, baseB, best, allA, allB,
    saving: Math.max(0, baseline - best.total),
    moves, cardIfAllA, cardIfAllB,
    marginalA: best.a.marginalRate,
    marginalB: best.b.marginalRate,
    evaluated,
  };
}
