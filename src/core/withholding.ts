// 근로소득 간이세액표(소득세법 시행령 별표2) 조회. 원문 표 그대로 사용한다.
import type { Withholding } from "./rates.ts";
import { floor10 } from "./money.ts";

type Row = readonly number[]; // [이상(천원), 미만(천원), 가족1..11]

/** 구간 이진 탐색: 이상 ≤ k < 미만 */
function findBand(bands: readonly Row[], kWon: number): Row | undefined {
  const k = kWon / 1000;
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = bands[mid]!;
    if (k < row[0]!) hi = mid - 1;
    else if (k >= row[1]!) lo = mid + 1;
    else return row;
  }
  return undefined;
}

/** 공제대상가족 1~11명 기준 세액 (자녀 공제 전). */
function baseTax(w: Withholding, taxableMonthly: number, family: number): number {
  const col = family - 1; // 0..10
  if (taxableMonthly < 770_000) return 0;
  const k = taxableMonthly / 1000;
  if (k < 10_000) {
    const row = findBand(w.bands as unknown as Row[], taxableMonthly);
    return row ? row[2 + col]! : 0;
  }
  const at = w.at10000[col]!;
  if (k === 10_000) return at;
  const seg = w.over10000.find((s) => s.upTo === null || k <= s.upTo)!;
  const excessWon = taxableMonthly - seg.threshold * 1000;
  const factorPct = Math.round(seg.factor * 100);
  const ratePct = Math.round(seg.rate * 100);
  const variable = (excessWon * factorPct * ratePct) / 10_000;
  return floor10(at + seg.add + seg.plus + variable);
}

export function childCredit(w: Withholding, children: number): number {
  if (children <= 0) return 0;
  const c = w.childCredit;
  if (children === 1) return c.one;
  if (children === 2) return c.two;
  return c.two + c.perExtraChild * (children - 2);
}

export interface WithholdingResult {
  /** 소득세 (월, 원) */
  tax: number;
  /** 자녀공제 전 세액 */
  before: number;
  /** 자녀공제액 (실제 차감된 금액) */
  childReduction: number;
  /** 지방소득세 */
  localTax: number;
  zeroBand: boolean;
}

/**
 * @param taxableMonthly 월 과세급여(비과세·학자금 제외, 원)
 * @param family 공제대상가족 수 (본인·배우자 포함, 1 이상)
 * @param children 8세 이상 20세 이하 자녀 수
 */
export function withholdingTax(w: Withholding, taxableMonthly: number, family: number, children: number): WithholdingResult {
  const fam = Math.max(1, Math.floor(family));
  let before: number;
  if (fam <= 11) {
    before = baseTax(w, taxableMonthly, fam);
  } else {
    const t10 = baseTax(w, taxableMonthly, 10);
    const t11 = baseTax(w, taxableMonthly, 11);
    before = Math.max(0, t11 - (t10 - t11) * (fam - 11));
  }
  const credit = childCredit(w, Math.max(0, Math.floor(children)));
  const tax = Math.max(0, before - credit);
  return {
    tax,
    before,
    childReduction: before - tax,
    localTax: floor10(tax * 0.1),
    zeroBand: taxableMonthly < 770_000,
  };
}
