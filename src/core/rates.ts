import rates2026 from "../../data/rates/2026/rates.json";
import withholding2026 from "../../data/rates/2026/withholding.json";
import { isIsoDate } from "./money.ts";

export type Rates = typeof rates2026;
export type Withholding = typeof withholding2026;

export interface RateSet {
  year: number;
  rates: Rates;
  withholding: Withholding;
}

const SETS: Record<number, RateSet> = {
  2026: { year: 2026, rates: rates2026, withholding: withholding2026 },
};

export const SUPPORTED_YEARS = Object.keys(SETS).map(Number);
export const CURRENT_YEAR = 2026;

/** 오늘 날짜(Asia/Seoul) YYYY-MM-DD */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface Resolved {
  set: RateSet;
  asOf: string;
  /** 요청한 기준일의 연도 요율이 없어 가까운 연도로 대체했을 때 */
  fallback?: { requestedYear: number; usedYear: number };
}

/** 기준일에 맞는 요율 세트. 지원하지 않는 연도면 2026 으로 계산하고 fallback 을 알린다. */
export function resolveRates(asOf?: string): Resolved {
  const date = asOf && isIsoDate(asOf) ? asOf : todayKst();
  const year = Number(date.slice(0, 4));
  const exact = SETS[year];
  if (exact) return { set: exact, asOf: date };
  return { set: SETS[CURRENT_YEAR]!, asOf: date, fallback: { requestedYear: year, usedYear: CURRENT_YEAR } };
}

/** 기준일에 적용되는 국민연금 기준소득월액 상·하한 (시행일이 가장 늦은 항목). */
export function npsLimitsAt(rates: Rates, asOf: string): { min: number; max: number; from: string } {
  const list = [...rates.nps.limits].sort((a, b) => a.from.localeCompare(b.from));
  let pick = list[0]!;
  for (const l of list) if (l.from <= asOf) pick = l;
  return pick;
}
